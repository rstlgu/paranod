const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const yaml = require('yaml');

const root = path.resolve(__dirname, '..');
const entrypoint = fs.readFileSync(
  path.join(root, 'docker/agent-entrypoint.sh'),
  'utf8'
);

function runEntrypoint(t, options = {}) {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'paranod-worker-keys-'));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  if (options.persisted !== undefined)
    fs.writeFileSync(
      path.join(state, 'secrets-encryption-key'),
      options.persisted,
      { mode: 0o400 }
    );
  if (options.fileKey !== undefined)
    fs.writeFileSync(path.join(state, 'temp-file-key'), options.fileKey, {
      mode: 0o400
    });
  // Replace only the final process launch with a synthetic-key equality check.
  const script = entrypoint.replace(
    'exec node dist/agent-worker.cjs',
    '[ "$SECRETS_ENCRYPTION_KEY" = "$EXPECTED_TEST_KEY" ] && [ "$TEMP_FILE_ENCRYPTION_KEY" = "$EXPECTED_TEST_FILE_KEY" ]'
  );
  const result = spawnSync('/bin/sh', ['-c', script], {
    env: {
      PATH: '/usr/bin:/bin',
      AUTH_STATE_DIR: state,
      PARANOD_AGENT_WORKER_ENABLED: 'true',
      DATABASE_URL: 'postgresql://synthetic.invalid/test',
      EXPECTED_TEST_KEY: 'synthetic-persisted-key',
      EXPECTED_TEST_FILE_KEY: 'synthetic-file-key',
      ...options.env
    },
    encoding: 'utf8'
  });
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /synthetic-(?:persisted|explicit|file)-key/
  );
  return { result, state };
}

test('disabled worker does not need or create keys', (t) => {
  const { result, state } = runEntrypoint(t, {
    env: { PARANOD_AGENT_WORKER_ENABLED: 'false', DATABASE_URL: '' }
  });
  assert.equal(result.status, 0);
  assert.deepEqual(fs.readdirSync(state), []);
});

test('worker reuses the read-only persisted OSS key without changing it', (t) => {
  const { result, state } = runEntrypoint(t, {
    persisted: 'synthetic-persisted-key\n',
    fileKey: 'synthetic-file-key\n'
  });
  assert.equal(result.status, 0);
  assert.equal(
    fs.readFileSync(path.join(state, 'secrets-encryption-key'), 'utf8'),
    'synthetic-persisted-key\n'
  );
  assert.equal(
    fs.readFileSync(path.join(state, 'temp-file-key'), 'utf8'),
    'synthetic-file-key\n'
  );
  assert.deepEqual(fs.readdirSync(state), [
    'secrets-encryption-key',
    'temp-file-key'
  ]);
});

test('worker refuses a missing or empty shared key instead of generating one', (t) => {
  for (const persisted of [undefined, '', '\r\n']) {
    const { result, state } = runEntrypoint(t, { persisted });
    assert.equal(result.status, 1);
    assert.deepEqual(
      fs.readdirSync(state),
      persisted === undefined ? [] : ['secrets-encryption-key']
    );
  }
});

test('an explicitly configured key wins over the local key', (t) => {
  const { result } = runEntrypoint(t, {
    persisted: 'synthetic-persisted-key',
    env: {
      SECRETS_ENCRYPTION_KEY: 'synthetic-explicit-key',
      EXPECTED_TEST_KEY: 'synthetic-explicit-key',
      TEMP_FILE_ENCRYPTION_KEY: 'synthetic-file-key'
    }
  });
  assert.equal(result.status, 0);
});

test('worker refuses a missing or empty file key without exposing key material', (t) => {
  for (const fileKey of [undefined, '', '\r\n']) {
    const { result } = runEntrypoint(t, {
      persisted: 'synthetic-persisted-key',
      fileKey
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Shared file key/);
  }
});

test('worker entrypoint cannot migrate, run maintenance, or create keys', () => {
  assert.doesNotMatch(
    entrypoint,
    /prisma|db push|maintenance\.mjs|openssl|mkdir/
  );
  assert.match(entrypoint, /exec node dist\/agent-worker\.cjs/);
});

test('Compose keeps the worker opt-in with web health, shared config, read-only keys and no socket', () => {
  const compose = yaml.parse(
    fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8'),
    { merge: true }
  );
  const app = compose.services.app;
  const worker = compose.services['agent-worker'];
  assert.deepEqual(worker.profiles, ['agent']);
  assert.deepEqual(worker.command, ['./docker/agent-entrypoint.sh']);
  assert.equal(worker.image, app.image);
  assert.equal(worker.depends_on.app.condition, 'service_healthy');
  assert.deepEqual(worker.environment, app.environment);
  assert.match(worker.environment.PARANOD_AGENT_WORKER_ENABLED, /:-false/);
  assert.deepEqual(worker.volumes, ['paranod-app-data:/var/lib/paranod:ro']);
  assert.equal(worker.ports, undefined);
  assert.match(app.healthcheck.test.join(' '), /\/api\/health/);
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /RUN node scripts\/build-agent-worker\.mjs/);
  assert.match(dockerfile, /COPY --from=builder \/app\/dist \.\/dist/);
  const webEntrypoint = fs.readFileSync(
    path.join(root, 'docker/entrypoint.sh'),
    'utf8'
  );
  assert.match(webEntrypoint, /prisma migrate deploy/);
  assert.doesNotMatch(webEntrypoint, /prisma db push/);
  const migration = fs.readFileSync(
    path.join(root, 'prisma/migrations/20261028000000_initial/migration.sql'),
    'utf8'
  );
  assert.match(migration, /CHECK/);
  assert.match(migration, /AgentRun/);
  assert.match(migration, /GraphAgentLease/);
});
