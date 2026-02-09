import { defineConfig } from 'vite';

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
});
