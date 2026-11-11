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
  // Diagnostic Joconde : l'API tabulaire de data.gouv.fr sur le CSV de la base.
  try {
    const u = 'https://tabular-api.data.gouv.fr/api/resources/7e3307c2-f2ff-455c-bbca-bb6f11aec7bb/data/?page_size=1';
    const r = await fetch(u, { headers: { Accept: 'application/json', 'User-Agent': svc.sources.http.userAgent } });
    const txt = await r.text();
    console.log(`[sources] joconde-tabulaire : HTTP ${r.status} ${txt.slice(0, 1500)}`);
  } catch (e: any) {
    console.log(`[sources] joconde-tabulaire : ÉCHEC ${e?.message ?? e} ${e?.cause?.code ?? ''}`);
  }
  for (const u of ['https://data.culture.gouv.fr/', 'https://data.culturecommunication.gouv.fr/']) {
    try {
      const r = await fetch(u, { redirect: 'manual' });
      console.log(`[sources] ${u} : HTTP ${r.status} ${r.headers.get('location') ?? ''}`);
    } catch (e: any) {
      console.log(`[sources] ${u} : ÉCHEC ${e?.cause?.code ?? e?.message}`);
    }
  }
}, 3000);

serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`Cartel API sur http://localhost:${info.port}  (fournisseur IA : ${svc.ai.name}${svc.ai.demo ? ', mode démonstration' : ''})`);
});
