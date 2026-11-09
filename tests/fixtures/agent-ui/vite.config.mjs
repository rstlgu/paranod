import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root,
  resolve: { alias: { '@': path.resolve(root, '../../../src') } },
  esbuild: { jsx: 'automatic' },
  define: { 'process.env': {} },
  server: {
    host: '127.0.0.1',
    port: 4178,
    strictPort: true,
    proxy: { '/api/public/entity-icons': 'http://localhost:3002', '/api/logo': 'http://localhost:3002' },
    fs: { allow: [path.resolve(root, '../../..')] }
  }
});
