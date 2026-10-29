import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ArtworkEntry, ChatRequest, EntryRequest, ServerConfig } from '../shared/types.js';
import { loadConfig, type AppConfig } from './config.js';
import { createProvider } from './ai/index.js';
import { AIError, type AIProvider } from './ai/types.js';
import { Cache } from './lib/cache.js';
import { Limiter } from './lib/limits.js';
import { scanCostRange } from './lib/cost.js';
import { SourceRegistry } from './sources/index.js';
import { InputError, Services } from './pipeline/services.js';
import { aicRandom } from './sources/aic.js';
import { wikidataPlacesAround } from './sources/wikidata.js';
import { FIXTURE_RECORDS } from './sources/fixtures.js';
import { allowedImageUrl, fetchImage } from './pipeline/visual.js';
import { createStore, type WorkStore } from './lib/store.js';
import { timingSafeEqual } from 'node:crypto';
import type { WorkStatus } from '../shared/types.js';

export interface AppDeps {
  cfg?: AppConfig;
  provider?: AIProvider;
  cache?: Cache;
  store?: WorkStore;
}

export function createApp(deps: AppDeps = {}) {
  const cfg = deps.cfg ?? loadConfig();
  const cache = deps.cache ?? new Cache(cfg.cacheDir || null);
  const limiter = new Limiter(cfg.limits.perMinute, cfg.limits.dailyBudgetUsd);
  const provider = deps.provider ?? createProvider(cfg);
  const sources = new SourceRegistry(cfg, cache);
  const store = deps.store ?? createStore(cfg.databaseUrl);
  const svc = new Services(provider, sources, cache, limiter, cfg.limits.maxImageBytes, store);
  // Prépare la base dès le démarrage, sans bloquer : la première requête attendra si besoin.
  void store.counts().catch((e) => console.error('Base des fiches : initialisation impossible.', e?.message ?? e));

  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof InputError) return c.json({ error: err.message }, err.status as any);
    if (err instanceof AIError) return c.json({ error: err.message, code: err.code }, err.status as any);
    console.error(err);
    return c.json({ error: 'Erreur interne du serveur.' }, 500);
  });

  const ip = (c: any) =>
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'local';

  // Code d'accès facultatif : empêche des inconnus de consommer votre crédit API si l'URL circule.
  // Le relais d'images en est exempté : une balise <img> ne peut pas envoyer d'en-tête, et il ne sert
  // que des images de musées (liste fermée d'hôtes), sans coût d'API.
  app.use('/api/*', async (c, next) => {
    if (cfg.accessCode && c.req.path !== '/api/config' && c.req.path !== '/api/health' && c.req.path !== '/api/img') {
      if (c.req.header('x-access-code') !== cfg.accessCode) return c.json({ error: 'Code d’accès requis ou incorrect.', code: 'access' }, 401);
    }
    await next();
  });

  const limited = async (c: any, next: any) => {
    const r = limiter.checkRate(ip(c));
    if (!r.ok) {
      c.header('Retry-After', String(r.retryAfter));
      return c.json({ error: `Trop de requêtes. Réessayez dans ${r.retryAfter} s.`, code: 'rate' }, 429);
    }
    await next();
  };

  app.get('/api/health', (c) => c.json({ ok: true }));

  // Relais des images de musées. Certains serveurs (IIIF de l'AIC notamment) refusent ou bloquent
  // l'affichage direct depuis un téléphone ; le serveur les télécharge avec un en-tête identifiable.
  const imgMem = new Map<string, { body: Buffer; type: string; at: number }>();
  app.get('/api/img', async (c) => {
    const u = allowedImageUrl(c.req.query('u') ?? '');
    if (!u) return c.json({ error: 'Image non autorisée.' }, 400);
    const key = u.toString();
    let hit = imgMem.get(key);
    if (!hit || Date.now() - hit.at > 6 * 3600_000) {
      const body = await fetchImage(key, 8000, sources.http.userAgent);
      if (!body) return c.json({ error: 'Image indisponible à la source.' }, 502);
      const head = body.subarray(0, 4).toString('hex');
      const type = head.startsWith('89504e47') ? 'image/png' : head.startsWith('52494646') ? 'image/webp' : head.startsWith('47494638') ? 'image/gif' : 'image/jpeg';
      hit = { body, type, at: Date.now() };
      imgMem.set(key, hit);
      // Petite mémoire : 120 images au plus.
      if (imgMem.size > 120) imgMem.delete(imgMem.keys().next().value!);
    }
    return new Response(new Uint8Array(hit.body), {
      headers: { 'Content-Type': hit.type, 'Cache-Control': 'public, max-age=604800, immutable' }
    });
  });

  app.get('/api/config', (c) => {
    const body: ServerConfig = {
      provider: provider.name,
      demo: provider.demo,
      models: provider.demo
        ? { vision: null, text: null, chat: null }
        : { vision: provider.models.vision, text: provider.models.text, chat: provider.models.chat },
      sources: sources.describe(),
      accessCodeRequired: !!cfg.accessCode,
      storage: store.kind,
      limits: { perMinute: cfg.limits.perMinute, dailyBudgetUsd: cfg.limits.dailyBudgetUsd, spentTodayUsd: limiter.spentToday() },
      costPerScanUsd: provider.demo ? null : scanCostRange(provider.models.vision, provider.models.text)
    };
    return c.json(body);
  });

  async function readImage(c: any) {
    const form = await c.req.parseBody().catch(() => null);
    const file = form?.image;
    if (!file || typeof file === 'string') throw new InputError('Aucune image reçue (champ « image »).');
    return { buf: Buffer.from(await file.arrayBuffer()), mime: file.type as string };
  }

  app.post('/api/identify', limited, async (c) => {
    const { buf, mime } = await readImage(c);
    return c.json(await svc.identify(buf, mime));
  });

  app.post('/api/label', limited, async (c) => {
    const { buf, mime } = await readImage(c);
    return c.json(await svc.readLabel(buf, mime));
  });

  app.post('/api/entry', limited, async (c) => {
    const body = (await c.req.json().catch(() => null)) as EntryRequest | null;
    if (!body?.candidate) throw new InputError('Requête invalide.');
    return c.json(await svc.entry(body));
  });

  app.post('/api/chat', limited, async (c) => {
    const body = (await c.req.json().catch(() => null)) as ChatRequest | null;
    if (!body?.entry || !Array.isArray(body.messages)) throw new InputError('Requête invalide.');
    const entry = body.entry as ArtworkEntry;
    return streamSSE(c, async (stream) => {
      try {
        const usage = await svc.chat(entry, body.messages, (t) => void stream.writeSSE({ event: 'delta', data: JSON.stringify(t) }), c.req.raw.signal);
        await stream.writeSSE({ event: 'done', data: JSON.stringify({ usage }) });
      } catch (e: any) {
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: e?.message ?? 'Erreur' }) });
      }
    });
  });

  // Signalement d'une erreur sur une fiche partagée, par n'importe quel visiteur.
  app.post('/api/report', limited, async (c) => {
    const body = (await c.req.json().catch(() => null)) as { workId?: string; reason?: string } | null;
    const reason = String(body?.reason ?? '').trim().slice(0, 1000);
    if (!body?.workId || !reason) throw new InputError('Précisez ce qui ne va pas.');
    const ok = await store.report(String(body.workId), reason);
    if (!ok) throw new InputError('Fiche introuvable.', 404);
    return c.json({ ok: true });
  });

  // ---------- Administration (validation des fiches) ----------
  const isAdmin = (c: any) => {
    if (!cfg.adminCode) return false;
    const given = Buffer.from(String(c.req.header('x-admin-code') ?? ''));
    const want = Buffer.from(cfg.adminCode);
    return given.length === want.length && timingSafeEqual(given, want);
  };
  app.use('/api/admin/*', async (c, next) => {
    if (!cfg.adminCode) return c.json({ error: 'Administration non configurée (ADMIN_CODE manquant).' }, 503);
    if (!isAdmin(c)) {
      await new Promise((r) => setTimeout(r, 400)); // freine les essais au hasard
      return c.json({ error: 'Code d’administration incorrect.', code: 'admin' }, 401);
    }
    await next();
  });
  const STATUSES = ['provisoire', 'validee', 'rejetee'] as const;
  app.get('/api/admin/works', async (c) => {
    const q = c.req.query('status');
    const status = q === 'signalees' || (STATUSES as readonly string[]).includes(q ?? '') ? (q as WorkStatus | 'signalees') : undefined;
    const [works, counts] = await Promise.all([
      store.list({ status, limit: Number(c.req.query('limit') ?? 50), offset: Number(c.req.query('offset') ?? 0) }),
      store.counts()
    ]);
    return c.json({ works, counts, storage: store.kind });
  });
  app.get('/api/admin/works/:id', async (c) => {
    const w = await store.get(c.req.param('id'));
    return w ? c.json(w) : c.json({ error: 'Fiche introuvable.' }, 404);
  });
  app.post('/api/admin/works/:id/status', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { status?: string } | null;
    if (!(STATUSES as readonly string[]).includes(body?.status ?? '')) throw new InputError('Statut invalide.');
    const ok = await store.setStatus(c.req.param('id'), body!.status as WorkStatus);
    return ok ? c.json({ ok: true }) : c.json({ error: 'Fiche introuvable.' }, 404);
  });
  app.delete('/api/admin/works/:id', async (c) => {
    const ok = await store.remove(c.req.param('id'));
    return ok ? c.json({ ok: true }) : c.json({ error: 'Fiche introuvable.' }, 404);
  });

  app.get('/api/search', async (c) => {
    const title = c.req.query('title') || undefined;
    const artist = c.req.query('artist') || undefined;
    const text = c.req.query('q') || undefined;
    if (!title && !artist && !text) throw new InputError('Indiquez un titre, un artiste ou un terme.');
    return c.json(await svc.searchSources({ title, artist, text }));
  });

  app.get('/api/discover', async (c) => {
    if (cfg.sources.offline) return c.json({ records: FIXTURE_RECORDS, offline: true });
    try {
      return c.json({ records: await aicRandom(sources.http, 12) });
    } catch (e: any) {
      return c.json({ records: [], error: 'Découverte indisponible : ' + (e?.message ?? e) }, 502);
    }
  });

  app.get('/api/places', async (c) => {
    const lat = Number(c.req.query('lat'));
    const lon = Number(c.req.query('lon'));
    const radius = Math.min(25, Math.max(1, Number(c.req.query('radius') ?? 3)));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
      throw new InputError('Coordonnées invalides.');
    // Arrondi à ~1 km : améliore le cache et évite de conserver une position précise.
    const rl = Math.round(lat * 100) / 100;
    const ro = Math.round(lon * 100) / 100;
    const key = `places:${rl}:${ro}:${radius}`;
    const hit = await cache.get(key);
    if (hit) return c.json({ places: hit });
    if (cfg.sources.offline) return c.json({ places: [], offline: true });
    try {
      const places = await wikidataPlacesAround(rl, ro, radius, sources.http);
      await cache.set(key, places, 60 * 60 * 24 * 7);
      return c.json({ places });
    } catch (e: any) {
      return c.json({ places: [], error: 'Carte des lieux indisponible : ' + (e?.message ?? e) }, 502);
    }
  });

  return { app, svc, cfg, store };
}
