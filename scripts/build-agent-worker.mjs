import { build } from 'esbuild';

await build({
  entryPoints: {
    'agent-worker': 'src/features/agent/server/worker-entry.ts',
    'agent-configure': 'src/features/agent/server/configure-entry.ts'
  },
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node22.12',
  format: 'cjs',
  packages: 'external',
  tsconfig: 'tsconfig.json',
  logLevel: 'info'
});
