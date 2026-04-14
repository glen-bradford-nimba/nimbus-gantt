import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/iife-entry.ts'),
      name: 'NimbusGanttApp',
      formats: ['iife', 'es'],
      fileName: (format) => `nimbus-gantt-app.${format}.js`,
    },
    rollupOptions: {
      external: [],
      output: {
        globals: {},
        // NimbusGanttApp is the IIFE module namespace object {NimbusGanttApp:{mount,unmount}}.
        // Unwrap the named export so window.NimbusGanttApp = {mount, unmount} directly.
        // Salesforce Locker Service requires plain object methods, not static class methods.
        footer: 'typeof window !== "undefined" && (window.NimbusGanttApp = NimbusGanttApp.NimbusGanttApp || NimbusGanttApp);',
      },
    },
    outDir: 'dist',
    emptyOutDir: false,
    minify: false,
  },
});
