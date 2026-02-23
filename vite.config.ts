import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/corvid-agent-chat/',
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    target: 'esnext',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          algosdk: ['algosdk'],
          algochat: ['@corvidlabs/ts-algochat'],
          qrscanner: ['html5-qrcode'],
        },
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['fonts/*.ttf', 'icons/*.png'],
      manifest: {
        name: 'CorvidAgent Chat',
        short_name: 'CorvidChat',
        description: 'Decentralized encrypted messaging powered by Algorand blockchain',
        theme_color: '#0a0a12',
        background_color: '#0a0a12',
        display: 'standalone',
        scope: '/corvid-agent-chat/',
        start_url: '/corvid-agent-chat/',
        orientation: 'portrait-primary',
        categories: ['social', 'communication'],
        icons: [
          {
            src: 'icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,ttf,woff,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.algonode\.cloud\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'algorand-api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 5, // 5 minutes
              },
              networkTimeoutSeconds: 10,
            },
          },
          {
            urlPattern: /^https:\/\/.*\.nodely\.dev\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'nodely-api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 5,
              },
              networkTimeoutSeconds: 10,
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    open: true,
  },
  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude],
    include: ['src/**/*.test.ts'],
  },
});
