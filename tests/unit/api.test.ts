// Tests d'intégration de l'API HTTP avec un fournisseur d'IA simulé et les notices hors ligne.
import { beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createApp } from '../../server/app';
import { loadConfig } from '../../server/config';
import { Cache } from '../../server/lib/cache';
import type { AIProvider, JsonRequest } from '../../server/ai/types';
import { AIError } from '../../server/ai/types';
import type { ArtworkEntry, IdentifyResponse } from '../../shared/types';

class FakeProvider implements AIProvider {
  name = 'fake';
  demo = false;
  models = { vision: 'claude-sonnet-5-5', text: 'claude-sonnet-5-5', chat: 'claude-haiku-5-5', label: 'claude-haiku-5-5' };
  calls: JsonRequest[] = [];
  vision: any = {
    isArtwork: true,
    imageQualityIssue: null,
    objectKind: 'peinture',
    description: 'Scène de bord de Seine peinte par petites touches.',
    visibleText: [],
    inscriptions: ['Seurat (signature en bas à droite)'],
    hypotheses: [{ title: 'A Sunday on La Grande Jatte', artist: 'Georges Seurat', date: '1884-1886', confidence: 0.9, reasoning: 'Touches divisées, promeneurs de profil', distinguishing: 'Étude préparatoire plus petite au Met' }],
    searchQueries: ['A Sunday on La Grande Jatte']
  };
  async json<T>(req: JsonRequest) {
    this.calls.push(req);
    const usage = { model: 'claude-sonnet-5-5', inputTokens: 3000, outputTokens: 1000, estimatedCostUsd: 0.016 };
    if (req.task === 'identify') return { data: this.vision as T, usage };
    if (req.task === 'label') return { data: { title: 'T', artist: 'A', artistDates: null, date: null, medium: null, dimensions: null, inventory: 'X1', institution: null, creditLine: null, description: null, rawText: 'A\nT' } as T, usage };
    return {
      data: {
        objectKind: 'peinture',
        movement: 'Néo-impressionnisme',
        sections: [
          { id: 'technique', claims: [{ text: 'Huile sur toile de 207,5 × 308,1 cm.', kind: 'fait', sources: ['S1'] }] },
          { id: 'resume', claims: [{ text: 'Œuvre majeure du pointillisme.', kind: 'fait', sources: [] }] }
        ]
      } as T,
      usage
    };
  }
  async stream(_r: any, onDelta: (t: string) => void) {
    onDelta('Bonjour ');
    onDelta('[S1].');
    return { model: 'claude-haiku-5-5', inputTokens: 10, outputTokens: 2, estimatedCostUsd: 0 };
  }
}

async function jpeg(w = 600, h = 400) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 140, b: 90 } } }).jpeg().toBuffer();
}

function form(buf: Buffer, type = 'image/jpeg') {
  const fd = new FormData();
  fd.append('image', new Blob([new Uint8Array(buf)], { type }), 'p.jpg');
  return fd;
}

let provider: FakeProvider;
let app: ReturnType<typeof createApp>['app'];

function setup(env: Record<string, string> = {}) {
  const prev = { ...process.env };
  Object.assign(process.env, { SOURCES_OFFLINE: '1', AI_PROVIDER: 'demo', RATE_LIMIT_PER_MINUTE: '100', ...env });
  const cfg = loadConfig();
  process.env = prev;
  provider = new FakeProvider();
  app = createApp({ cfg, provider, cache: new Cache(null) }).app;
}

beforeEach(() => setup());

describe('API /api/identify', () => {
  it('identifie, vérifie dans les notices et met en cache', async () => {
    const img = await jpeg();
    const res = await app.request('/api/identify', { method: 'POST', body: form(img) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as IdentifyResponse;
    expect(body.status).toBe('identified');
    expect(body.candidates[0].verified).toBe(true);
    expect(body.candidates[0].records[0].inventory).toBe('1926.224');
    expect(body.usage?.estimatedCostUsd).toBeGreaterThan(0);
    // L'image envoyée au modèle est en JPEG base64
    const imgPart = provider.calls[0].content.find((c) => c.type === 'image') as any;
    expect(imgPart.mediaType).toBe('image/jpeg');

    const again = (await (await app.request('/api/identify', { method: 'POST', body: form(img) })).json()) as IdentifyResponse;
    expect(again.cached).toBe(true);
    expect(provider.calls.filter((c) => c.task === 'identify')).toHaveLength(1);
  });

  it('plafonne la confiance quand aucune notice ne concorde', async () => {
    provider.vision = { ...provider.vision, hypotheses: [{ ...provider.vision.hypotheses[0], title: 'Œuvre imaginaire', artist: 'Personne', confidence: 0.95 }] };
    const body = (await (await app.request('/api/identify', { method: 'POST', body: form(await jpeg(700, 500)) })).json()) as IdentifyResponse;
    expect(body.candidates[0].verified).toBe(false);
    expect(body.candidates[0].confidence).toBeLessThanOrEqual(0.55);
    expect(body.status).toBe('uncertain');
    expect(body.warnings.join(' ')).toMatch(/pas vérifiée/);
  });

  it('signale une photo inexploitable', async () => {
    provider.vision = { ...provider.vision, imageQualityIssue: 'Reflet sur le verre', hypotheses: [] };
    const body = (await (await app.request('/api/identify', { method: 'POST', body: form(await jpeg(640, 480)) })).json()) as IdentifyResponse;
    expect(body.status).toBe('unusable_image');
  });

  it('refuse une image trop petite, un format inconnu ou un fichier absent', async () => {
    expect((await app.request('/api/identify', { method: 'POST', body: form(await jpeg(100, 100)) })).status).toBe(422);
    expect((await app.request('/api/identify', { method: 'POST', body: form(Buffer.from('abc'), 'application/pdf') })).status).toBe(415);
    expect((await app.request('/api/identify', { method: 'POST', body: new FormData() })).status).toBe(400);
    expect((await app.request('/api/identify', { method: 'POST', body: form(Buffer.from('pas une image')) })).status).toBe(422);
  });

  it('transmet une erreur du fournisseur de manière lisible', async () => {
    provider.json = async () => {
      throw new AIError('Crédit API épuisé sur le compte Anthropic.', 402, 'quota');
    };
    const res = await app.request('/api/identify', { method: 'POST', body: form(await jpeg(610, 400)) });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: 'quota' });
  });
});

describe('API /api/entry', () => {
  it('rédige une fiche sourcée et rétrograde les faits sans source', async () => {
    const id = (await (await app.request('/api/identify', { method: 'POST', body: form(await jpeg()) })).json()) as IdentifyResponse;
    const c = id.candidates[0];
    const res = await app.request('/api/entry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ candidate: c, vision: id.vision })
    });
    const e = (await res.json()) as ArtworkEntry;
    expect(e.aiWritten).toBe(true);
    expect(e.sections[0].id).toBe('resume');
    expect(e.sections[0].claims[0]).toMatchObject({ kind: 'interpretation', unsourced: true });
    const tech = e.sections.find((s) => s.id === 'technique')!;
    expect(tech.claims[0].sources).toEqual(['fixture:aic-27992']);
    expect(e.inventory).toBe('1926.224');
    expect(e.warnings.join(' ')).toMatch(/non sourcées/);
  });

  it('se replie sur une fiche documentaire si l’IA échoue', async () => {
    provider.json = async () => {
      throw new AIError('Surcharge', 503, 'overloaded');
    };
    const rec = { id: 'fixture:aic-20684', source: 'fixture', sourceLabel: 'Démo', url: 'u', title: 'Paris Street; Rainy Day', artist: 'Gustave Caillebotte', medium: 'Oil on canvas' };
    const res = await app.request('/api/entry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ candidate: { key: 'k', title: rec.title, artist: rec.artist, date: '1877', records: [rec] } })
    });
    const e = (await res.json()) as ArtworkEntry;
    expect(e.aiWritten).toBe(false);
    expect(e.technique).toBe('Oil on canvas');
    expect(e.warnings.join(' ')).toMatch(/Rédaction par IA indisponible/);
  });
});

describe('API /api/chat, /api/label, /api/search', () => {
  it('diffuse la réponse en Server-Sent Events', async () => {
    const entry = { title: 'T', artist: 'A', date: null, objectKind: 'peinture', sections: [], sources: [] };
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entry, messages: [{ role: 'user', content: 'Pourquoi ?' }] })
    });
    const text = await res.text();
    expect(text).toContain('event: delta');
    expect(text).toContain('"Bonjour "');
    expect(text).toContain('event: done');
  });
  it('lit un cartel', async () => {
    const res = await app.request('/api/label', { method: 'POST', body: form(await jpeg(500, 300)) });
    expect((await res.json()).fields.inventory).toBe('X1');
  });
  it('cherche dans les sources', async () => {
    const res = await app.request('/api/search?artist=Caillebotte&title=Paris%20Street');
    expect((await res.json()).records[0].artist).toBe('Gustave Caillebotte');
    expect((await app.request('/api/search')).status).toBe(400);
  });
});

describe('protection', () => {
  it('exige le code d’accès s’il est configuré', async () => {
    setup({ APP_ACCESS_CODE: 'secret' });
    expect((await app.request('/api/config')).status).toBe(200);
    expect((await app.request('/api/search?q=x')).status).toBe(401);
    expect((await app.request('/api/search?q=Impressionism', { headers: { 'x-access-code': 'secret' } })).status).toBe(200);
  });
  it('limite le débit', async () => {
    setup({ RATE_LIMIT_PER_MINUTE: '1' });
    const img = await jpeg();
    expect((await app.request('/api/identify', { method: 'POST', body: form(img) })).status).toBe(200);
    expect((await app.request('/api/identify', { method: 'POST', body: form(img) })).status).toBe(429);
  });
  it('coupe les appels payants une fois le budget quotidien atteint', async () => {
    setup({ DAILY_BUDGET_USD: '0.01' });
    expect((await app.request('/api/identify', { method: 'POST', body: form(await jpeg(600, 401)) })).status).toBe(200);
    const res = await app.request('/api/identify', { method: 'POST', body: form(await jpeg(600, 402)) });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/budget/);
  });
  it('n’expose jamais de clé dans /api/config', async () => {
    const txt = await (await app.request('/api/config')).text();
    expect(txt).not.toMatch(/sk-ant|api_key|apiKey/i);
  });
});
