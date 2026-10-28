import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root,
  esbuild: { jsx: 'automatic' },
  server: {
    host: '127.0.0.1',
    port: 4181,
    strictPort: true,
    fs: { allow: [path.resolve(root, '../../..')] }
  }
});
