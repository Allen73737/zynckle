import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.ZYNCKLE_API || 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      'lucide-react',
      'codemirror',
      '@codemirror/view',
      '@codemirror/state',
      '@codemirror/language',
      '@codemirror/commands',
      '@codemirror/legacy-modes/mode/stex',
      '@lezer/highlight',
      'dompurify',
      'marked',
    ],
  },
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
    emptyOutDir: false,
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Keep heavy, rarely-needed libraries out of the main bundle.
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
