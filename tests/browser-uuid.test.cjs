const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { buildSync } = require('esbuild');

// Use browser resolution: Node's uuid entrypoint would hide this regression.
const bundle = buildSync({
  entryPoints: ['src/features/graph/lib/graph-client-coordinator.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'coordinatorModule',
  write: false
}).outputFiles[0].text;

function fixture(crypto) {
  const context = vm.createContext({
    crypto,
    Response,
    structuredClone,
    AbortController
  });
  vm.runInContext(bundle, context);
  const posts = [];
  const coordinator = context.coordinatorModule.createGraphClientCoordinator(
    async (_url, options) => {
      if (options?.method === 'POST') {
        const body = JSON.parse(options.body);
        posts.push(body);
        return Response.json({ runId: body.runId });
      }
      return Response.json({
        graphId: 'graph',
        revision: 'a'.repeat(64),
        writeState: { version: 0, locked: false, expiresAt: null },
        nodes: [],
        edges: [],
        notes: ''
      });
    }
  );
  coordinator.register('graph', {
    kind: 'graph',
    capture: () => ({
      ready: true,
      version: 0,
      dirty: false,
      value: { nodes: [], edges: [] }
    }),
    idle: async () => {},
    flush: async () => true,
    adopt: () => {}
  });
  return { coordinator, posts };
}

const input = {
  graphId: 'graph',
  goal: 'Synthetic test',
  model: 'test',
  reasoning: 'low'
};
const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('agent starts over LAN HTTP without randomUUID and retries the same valid UUID', async () => {
  let randomCalls = 0;
  const f = fixture({
    getRandomValues(array) {
      randomCalls++;
      return webcrypto.getRandomValues(array);
    }
  });
  const runId = await f.coordinator.start(input);
  assert.match(runId, uuidV4);
  assert.equal(randomCalls, 1);
  assert.equal(await f.coordinator.retry('graph'), runId);
  assert.deepEqual(f.posts[0], f.posts[1]);
  assert.equal(randomCalls, 1);
});

test('secure contexts keep the native UUID path', async () => {
  const id = '09a720d8-39a4-407c-a9be-5d7495fe50bc';
  const f = fixture({ randomUUID: () => id });
  assert.equal(await f.coordinator.start(input), id);
});

test('missing secure randomness cannot freeze the graph or submit a run', async () => {
  const f = fixture({});
  await assert.rejects(f.coordinator.start(input));
  assert.equal(f.coordinator.frozen('graph'), false);
  assert.equal(f.posts.length, 0);
});
