import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
      includeAssets: [
        'images/icon/icon-192.png',
        'images/icon/icon-512.png',
        'images/icon/icon-512-maskable.png',
        'images/icon/apple-touch-icon.png',
        'fonts/*.woff2'
      ],
      manifest: {
        name: 'Doodle Guess',
        short_name: 'Doodle Guess',
        description: '실시간 멀티룸 그림 맞히기 파티게임',
        lang: 'ko',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#302852',
        background_color: '#211c38',
        start_url: '/',
        icons: [
          { src: '/images/icon/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/images/icon/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/images/icon/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webp,woff2}'],
        navigateFallbackDenylist: [/^\/api\//, /^\/health\//, /^\/ws/],
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: []
      }
    })
  ],
  resolve: {
    alias: {
      '@shared': new URL('../shared/src', import.meta.url).pathname
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      '/health': 'http://127.0.0.1:3001',
      '/ws': {
        target: 'ws://127.0.0.1:3001',
        ws: true
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
