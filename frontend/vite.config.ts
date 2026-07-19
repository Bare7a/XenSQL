import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import wails from '@wailsio/runtime/plugins/vite';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [wails('./bindings'), react()],
  resolve: {
    alias: {
      // `@/` resolves to src/ - mirrors the tsconfig paths entry so editor,
      // type checker, vite dev server and the production build all agree
      // on what `@/features/...` means.
      '@': path.resolve(__dirname, 'src'),
      // `@bindings/` points at the Wails v3 generated bindings outside src/.
      '@bindings': path.resolve(__dirname, 'bindings'),
    },
  },
  server: {
    // wails3 dev passes the chosen port via WAILS_VITE_PORT; fall back for plain `vite`.
    host: '127.0.0.1',
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
