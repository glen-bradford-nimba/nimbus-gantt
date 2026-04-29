import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'src'),
  resolve: {
    alias: {
      '@nimbus-gantt/core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        gantt3d: resolve(__dirname, 'src/gantt3d.html'),
        temporalCanvas: resolve(__dirname, 'src/temporal-canvas.html'),
      },
    },
  },
});
