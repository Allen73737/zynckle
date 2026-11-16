import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.ZYNCKLE_API || 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      '/sites': api,
      '/ws': { target: api.replace(/^http/, 'ws'), ws: true },
      '/collab': { target: api.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    target: 'es2020',
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
