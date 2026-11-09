import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { build, createServer } from 'vite';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configFile = path.join(repo, 'tests/fixtures/graph-read-only/vite.config.mjs');
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--build' && !/^--port=\d+$/.test(arg)))
  throw new Error('Usage: node scripts/preview-graph-read-only.mjs [--build] [--port=4183]');
const port = Number(args.find((arg) => arg.startsWith('--port='))?.slice(7) ?? 4183);
if (port < 1024 || port > 65535) throw new Error('Port must be between 1024 and 65535.');

if (args.includes('--build')) {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'graph-read-only-build-'));
  try {
    await build({ configFile, envDir: false, build: { outDir, emptyOutDir: true, minify: false } });
    console.log('Full graph fixture build verified; no server was started.');
  } finally { await rm(outDir, { recursive: true, force: true }); }
} else {
  const server = await createServer({ configFile, envDir: false, server: { port } });
  const close = async () => { await server.close(); process.exit(0); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await server.listen();
  console.log('Synthetic fixture only. No app server, credentials, provider calls, or database.');
  server.printUrls();
}
