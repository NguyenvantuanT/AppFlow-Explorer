import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// Workspace packages are TypeScript sources: bundle them instead of requiring them at runtime.
const workspacePackages = ['@appflow/agent', '@appflow/analyzer', '@appflow/model'];

export default defineConfig({
  main: {
    build: {
      // Parser runtimes load .wasm files next to their own modules, so they must stay in node_modules.
      externalizeDeps: { exclude: workspacePackages, include: ['web-tree-sitter', 'tree-sitter-wasms', 'yaml', 'zod'] },
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // The local agent runs in its own utility process (see src/main/agentHost.ts).
          agent: resolve(__dirname, 'src/main/agent.ts'),
        },
      },
    },
  },
  preload: {},
  renderer: {
    resolve: {
      alias: { '@renderer': resolve(__dirname, 'src/renderer/src') },
    },
    plugins: [react(), tailwindcss()],
  },
});
