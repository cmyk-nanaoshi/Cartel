import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Cartel',
        short_name: 'Cartel',
        description: 'Photographier une œuvre, comprendre son histoire, garder ses découvertes.',
        lang: 'fr',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#2C3B38',
        theme_color: '#2C3B38',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // Images de musées relayées par le serveur (/api/img) : gardées pour la consultation hors ligne.
            urlPattern: ({ url }) => url.pathname === '/api/img',
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-oeuvres-v2',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 60 }
            }
          }
        ]
      }
    })
  ],
  server: {
    proxy: { '/api': 'http://localhost:8787' }
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts']
  }
} as any);
