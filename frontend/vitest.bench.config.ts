import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@bindings': path.resolve(__dirname, 'bindings'),
      '@wailsio/runtime': path.resolve(__dirname, 'src/test/wailsioRuntimeStub.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['bench/**/*.bench.test.ts'],
    pool: 'forks',
    maxWorkers: 1,
    execArgv: ['--expose-gc'],
    testTimeout: 900_000,
    hookTimeout: 900_000,
    globals: false,
  },
});
