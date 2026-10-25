import { defineConfig, devices } from '@playwright/test';

// Parcours complet en mode démonstration hors ligne (aucune clé, aucun réseau requis).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:8790',
    ...devices['Pixel 7'],
    // Permet d'utiliser un Chromium déjà installé : PW_CHROMIUM=/chemin/vers/chrome
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}
  },
  webServer: {
    command: 'npm run build && PORT=8790 AI_PROVIDER=demo SOURCES_OFFLINE=1 CACHE_DIR= npx tsx server/node.ts',
    url: 'http://localhost:8790/api/health',
    timeout: 120_000,
    reuseExistingServer: false
  }
});
