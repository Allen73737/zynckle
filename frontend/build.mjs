import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname);

await build({
  root,
  configFile: false,
  plugins: [react()],
  build: {
    target: 'es2020',
    outDir: resolve(root, 'dist'),
    emptyOutDir: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/@tiptap|prosemirror|node_modules[/](yjs|y-protocols|y-websocket|lib0)[/]/.test(id)) return 'editor';
          if (id.includes('@codemirror') || id.includes('@lezer') || id.includes('codemirror')) return 'codemirror';
          if (id.includes('@xyflow')) return 'flow';
          if (id.includes('highlight.js')) return 'highlight';
          if (id.includes('react-dom') || id.includes('react-router') || id.match(/node_modules[\\/]react[\\/]/)) return 'react';
        },
      },
    },
  },
});
console.log('Build completed successfully.');
