import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 4173, strictPort: true },
  build: { target: 'es2022', outDir: 'dist' },
});
