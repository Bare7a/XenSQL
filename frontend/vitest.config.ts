import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@wails': path.resolve(__dirname, 'wailsjs'),
    },
  },
  test: {
    // Pure-logic library tests live next to the modules they cover. We avoid
    // jsdom (and the React testing layer that needs it) here so the suite stays
    // fast and free of Wails runtime stubbing.
    environment: 'node',
    // Tests can live anywhere under src - co-located with the modules they
    // cover. Feature folders are about to hold their own *.test.ts files.
    include: ['src/**/*.test.ts'],
    globals: false,
  },
});
