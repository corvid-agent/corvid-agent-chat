import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

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
