import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/postcss';

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, '../../..');
const nextShims = path.join(root, '../agent-start-ui');
export default defineConfig({
  root,
  envDir: false,
  envPrefix: 'FIXTURE_PUBLIC_',
  publicDir: path.join(root, 'public'),
  define: { 'process.env': '{}' },
  resolve: { alias: [
    { find: 'next/navigation', replacement: path.join(nextShims, 'navigation.ts') },
    { find: 'next/link', replacement: path.join(nextShims, 'link.tsx') },
    { find: 'next/image', replacement: path.join(nextShims, 'image.tsx') },
    { find: 'next/dynamic', replacement: path.join(root, 'dynamic.tsx') },
    { find: '@', replacement: path.join(repo, 'src') }
  ] },
  esbuild: { jsx: 'automatic' },
  css: { postcss: { plugins: [tailwindcss({ base: repo })] } },
  server: {
    host: '127.0.0.1', port: 4183, strictPort: true,
    fs: { allow: [repo] }
  },
  plugins: [{
    name: 'fixture-isolation',
    enforce: 'pre',
    resolveId(source, importer) {
      if (['server-only', 'next/server', '@/lib/db', '@/lib/auth', '@prisma/client'].includes(source) || /\/src\/lib\/(db|auth)(\.ts)?$/.test(source))
        throw new Error(`Server dependency forbidden in graph fixture: ${source} from ${importer}`);
    },
    configureServer(server) {
      // No request can fall through to an app/API proxy, including XHR uploads.
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith('/api/')) return next();
        response.statusCode = 501;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ error: 'fixture_transport_not_mocked' }));
      });
    }
  }]
});
