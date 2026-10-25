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

serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`Cartel API sur http://localhost:${info.port}  (fournisseur IA : ${svc.ai.name}${svc.ai.demo ? ', mode démonstration' : ''})`);
});
