import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'src'),
  resolve: {
    alias: {
      '@nimbus-gantt/core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
});
