import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({ rollupTypes: true, tsconfigPath: './tsconfig.json' }),
  ],
  build: {
    outDir: resolve(__dirname, 'dist'),
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'NimbusGantt',
      formats: ['es', 'umd', 'iife'],
      fileName: (format) => {
        if (format === 'es') return 'nimbus-gantt.es.js';
        if (format === 'umd') return 'nimbus-gantt.umd.js';
        return 'nimbus-gantt.iife.js';
      },
    },
    rollupOptions: {
      output: {
        assetFileNames: 'nimbus-gantt.[ext]',
      },
    },
    sourcemap: true,
    minify: 'esbuild',
  },
});
