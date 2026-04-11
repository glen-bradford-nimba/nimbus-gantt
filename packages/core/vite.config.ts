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
        // Vite's IIFE output is `var NimbusGantt=(function(){...})();`. In a
        // regular browser script context, top-level `var` attaches to window,
        // but Salesforce LWC's loadScript() runs in a context where that's not
        // guaranteed (module wrappers, strict mode, etc). Explicit assignment
        // via this footer eliminates the historical sed hand-edit on every
        // nimbusgantt.resource refresh. Only applies to the .iife.js bundle.
        footer: (chunk) =>
          chunk.fileName.endsWith('.iife.js')
            ? '\nif (typeof window !== "undefined") { window.NimbusGantt = NimbusGantt; }'
            : '',
      },
    },
    sourcemap: true,
    minify: 'esbuild',
  },
});
