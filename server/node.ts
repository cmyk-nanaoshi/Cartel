import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createApp } from './app.js';

// Charge un fichier .env local s'il existe (sans dépendance supplémentaire).
async function loadDotEnv() {
  if (!existsSync('.env')) return;
  const txt = await readFile('.env', 'utf8');
  for (const line of txt.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

await loadDotEnv();
const { app, cfg, svc } = createApp();

// En production, le même serveur distribue la PWA compilée (dossier dist/).
if (existsSync('dist')) {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ path: './dist/index.html' }));
}

// Bilan des sources au démarrage, visible dans les journaux de Render.
setTimeout(async () => {
  for (const a of svc.sources.adapters.filter((x) => x.enabled)) {
    const t = Date.now();
    try {
      const r = await a.search({ title: 'Les Nymphéas', artist: 'Claude Monet', limit: 3 }, svc.sources.http);
      console.log(`[sources] ${a.id} : ${r.length} notice(s) en ${Date.now() - t} ms`);
    } catch (e: any) {
      console.log(`[sources] ${a.id} : ÉCHEC ${e?.message ?? e}`);
    }
  }
  // Diagnostic Joconde : temps de réponse de l'API tabulaire selon le filtre.
  const T = 'https://tabular-api.data.gouv.fr/api/resources/7e3307c2-f2ff-455c-bbca-bb6f11aec7bb/data/?page_size=5&';
  for (const q of ['Auteur__exact=MONET%20Claude', 'Reference__exact=000PE001234', 'Auteur__contains=MONET', 'Titre__contains=Nymph%C3%A9as']) {
    const t = Date.now();
    try {
      const r = await fetch(T + q, { signal: AbortSignal.timeout(30000) });
      const j: any = await r.json().catch(() => null);
      console.log(`[sources] tabulaire ${q} : HTTP ${r.status} ${Date.now() - t} ms, ${j?.data?.length ?? '?'} ligne(s) ${JSON.stringify(j?.data?.[0] ? { a: j.data[0].Auteur, t: j.data[0].Titre } : j).slice(0, 300)}`);
    } catch (e: any) {
      console.log(`[sources] tabulaire ${q} : ÉCHEC après ${Date.now() - t} ms ${e?.message}`);
    }
  }
}, 3000);

serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`Cartel API sur http://localhost:${info.port}  (fournisseur IA : ${svc.ai.name}${svc.ai.demo ? ', mode démonstration' : ''})`);
});
