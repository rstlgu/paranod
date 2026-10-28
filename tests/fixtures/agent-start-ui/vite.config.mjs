import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root,
  define: { 'process.env': '{}' },
  resolve: {
    alias: {
      'next/navigation': path.join(root, 'navigation.ts'),
      'next/dynamic': path.join(root, 'dynamic.tsx'),
      'next/link': path.join(root, 'link.tsx'),
      'next/image': path.join(root, 'image.tsx'),
      '@': path.resolve(root, '../../../src')
    }
  },
  esbuild: { jsx: 'automatic' },
  server: {
    host: '127.0.0.1',
    port: 4179,
    strictPort: true,
    fs: { allow: [path.resolve(root, '../../..')] }
  }
});
