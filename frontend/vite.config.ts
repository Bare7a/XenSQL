import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // `@/` resolves to src/ - mirrors the tsconfig paths entry so editor,
      // type checker, vite dev server, and the production build all agree
      // on what `@/features/...` means.
      '@': path.resolve(__dirname, 'src'),
      // `@wails/` points at the Wails-generated bindings outside src/.
      '@wails': path.resolve(__dirname, 'wailsjs'),
    },
  },
  server: {
    port: 34115,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
