import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// L'administration est construite à part (dist-admin), sans PWA, et déployée à sa propre adresse.
// VITE_API_BASE pointe vers le serveur public, qui l'autorise via ADMIN_ORIGIN (CORS).
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist-admin', emptyOutDir: true, rollupOptions: { input: 'admin.html' } },
  server: { port: 5174, proxy: { '/api': 'http://localhost:8787' } }
});
