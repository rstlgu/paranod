const test = require('node:test');
const assert = require('node:assert/strict');
const createLoader = require('../scripts/test-support/load-typescript.cjs');

function app(userId = 'user', events = [], available = false) {
  const calls = [];
  const run = {
    id: 'run',
    graphId: 'graph',
    graph: { name: 'Graph' },
    goal: 'Inspect example.org',
    model: 'test-model',
    reasoning: 'high',
    approvalMode: 'guarded',
    status: 'running',
    createdAt: new Date(0),
    endedAt: null,
    token: 'private-token'
  };
  const service = createLoader()('src/features/agent/server/runs.ts');
  const db = {
    $transaction: async (fn) => {
      calls.push('transaction');
      return fn(db);
    },
    agentRun: {
      findMany: async (args) => {
        calls.push(args);
        return [run];
      }
    },
    agentEvent: {
      findMany: async (args) => {
        calls.push(args);
        return events;
      }
    }
  };
  const load = createLoader({
    '@/features/agent/server/context-actions': {
      changeAgentContext: async (input) => { calls.push(['context', input.runId, input.userId, input.action]); return { id: input.runId }; }
    },
    '@/lib/auth-session': { auth: async () => ({ userId }) },
    '@/lib/auth-utils': {
      getActiveWorkspaceAccess: async () =>
        userId ? { userId, workspaceId: 'workspace' } : null
    },
    '@/lib/db': { db },
    '@/features/agent/server/credential': {
      getAgentModelAccess: async () => ({
        providers: ['openai'],
        openrouterModels: []
      })
    },
    '@/features/agent/server/provider': {
      getWorkspaceAgentAvailability: async () => ({
        available,
        reason: available ? null : 'agent_worker_disabled'
      })
    },
    '@/features/agent/server/readiness': {
      getAgentWorkerCapacity: async () => ({
        readyWorkers: 1,
        activeRuns: 0,
        availableSlots: 1
      })
    },
    '@/features/agent/server/queue': {
      createAgentProducer: () => ({}),
      findStartedAgentRun: async () => null,
      enqueueAgentRun: async (_db, _queue, input) => {
        calls.push(input);
        return { runId: input.runId };
      }
    },
    '@/features/agent/server/runs': {
      ...service,
      readOwnedAgentRun: async () => run,
      cancelAgentRun: async () => run,
      decideAgentApproval: async (...args) => calls.push(args.slice(1))
    }
  });
  return { calls, load };
}
const context = { params: Promise.resolve({ runId: 'run' }) };
const request = (method, body, query = '') =>
  new Request(`http://localhost/api/agent/runs/run${query}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
const startBody = {
  runId: '7b2b0c70-5d33-435a-af17-8a4a13c6593f',
  graphId: 'graph',
  goal: 'Inspect example.org',
  model: 'gpt-6-astra',
  reasoning: 'low',
  expectedWriteVersion: 0,
  expectedRevision: 'a'.repeat(64)
};

test('context mutation accepts only bounded, authenticated clear or compact actions', async () => {
  const f = app();
  const api = f.load('src/app/api/agent/runs/[runId]/context/route.ts');
  for (const action of ['clear', 'compact']) {
    assert.equal((await api.POST(request('POST', { action }), context)).status, 200);
  }
  assert.deepEqual(f.calls, [['context', 'run', 'user', 'clear'], ['context', 'run', 'user', 'compact']]);
  for (const body of [{ action: 'delete' }, { action: 'clear', graphId: 'other' }, { action: 'x'.repeat(2048) }]) {
    assert.equal((await api.POST(request('POST', body), context)).status, 400);
  }
  assert.equal(f.calls.length, 2);
});

test('all agent endpoints require authentication before database access', async () => {
  for (const [file, method] of [
    ['route.ts', 'GET'],
    ['[runId]/context/route.ts', 'POST'],
    ['route.ts', 'POST'],
    ['[runId]/route.ts', 'GET'],
    ['[runId]/route.ts', 'DELETE'],
    ['[runId]/approvals/route.ts', 'POST']
  ]) {
    const { load, calls } = app(null);
    assert.equal(
      (
        await load(`src/app/api/agent/runs/${file}`)[method](
          request(method),
          context
        )
      ).status,
      401
    );
    assert.equal(calls.length, 0);
  }
});
test('an unconfigured runtime cannot create a fake job or lock', async () => {
  const { load, calls } = app();
  const response = await load('src/app/api/agent/runs/route.ts').POST(
    request('POST', startBody)
  );
  assert.equal(response.status, 503);
  assert.equal(calls.length, 0);
});
test('start validates the full barrier contract and scopes it to the session', async () => {
  const { load, calls } = app('user', [], true);
  const api = load('src/app/api/agent/runs/route.ts');
  for (const body of [
    { ...startBody, expectedRevision: undefined },
    { ...startBody, runId: 'invalid' },
    { ...startBody, expectedWriteVersion: -1 },
    { ...startBody, userId: 'forged' },
    { ...startBody, model: 'unapproved-model' },
    { ...startBody, reasoning: 'none' },
    { ...startBody, approvalMode: 'bypass' }
  ])
    assert.equal((await api.POST(request('POST', body))).status, 400);
  assert.equal(calls.length, 0);
  const response = await api.POST(request('POST', startBody));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { runId: startBody.runId });
  assert.deepEqual(calls[0], {
    ...startBody,
    approvalMode: 'guarded',
    userId: 'user',
    workspaceId: 'workspace'
  });
  assert.match(response.headers.get('cache-control'), /no-store/);
});
test('catalog is scoped to both owner and active workspace and excludes private fields', async () => {
  const { load, calls } = app();
  const response = await load('src/app/api/agent/runs/route.ts').GET();
  const data = await response.json();
  assert.equal(data.available, false);
  assert.equal(JSON.stringify(data).includes('private-token'), false);
  assert.deepEqual(calls[0].where, {
    userId: 'user',
    archivedAt: null,
    graph: { userId: 'user', workspaceId: 'workspace' }
  });
  assert.match(response.headers.get('cache-control'), /no-store/);
});
test('feed validates cursors and bounds replay pages', async () => {
  const events = Array.from({ length: 101 }, (_, i) => ({
    sequence: i + 1,
    createdAt: new Date(0),
    data: { type: 'phase', phase: 'thinking', summary: 'Test' }
  }));
  const { load, calls } = app('user', events);
  const api = load('src/app/api/agent/runs/[runId]/route.ts');
  for (const cursor of ['-1', '1.5', 'NaN', '9007199254740993']) {
    assert.equal(
      (await api.GET(request('GET', undefined, `?after=${cursor}`), context))
        .status,
      400
    );
  }
  assert.equal(calls.length, 0);
  const response = await api.GET(
    request('GET', undefined, '?after=0'),
    context
  );
  const data = await response.json();
  assert.equal(data.events.length, 100);
  assert.equal(data.hasMore, true);
  assert.equal(JSON.stringify(data).includes('private-token'), false);
  assert.match(response.headers.get('cache-control'), /no-store/);
});
test('feed rejects malformed stored public events instead of exposing arbitrary payloads', async () => {
  const { load } = app('user', [
    {
      sequence: 1,
      createdAt: new Date(0),
      data: {
        type: 'phase',
        phase: 'thinking',
        summary: 'Test',
        apiKey: 'private-token'
      }
    }
  ]);
  const response = await load('src/app/api/agent/runs/[runId]/route.ts').GET(
    request('GET'),
    context
  );
  assert.equal(response.status, 500);
  assert.equal((await response.text()).includes('private-token'), false);
});
test('approval requests require explicit boolean decisions and bounded bodies', async () => {
  const { load, calls } = app();
  const api = load('src/app/api/agent/runs/[runId]/approvals/route.ts');
  for (const body of [
    { approvalId: '', approved: true },
    { approvalId: 'a', approved: 'true' },
    { approved: false }
  ]) {
    assert.equal((await api.POST(request('POST', body), context)).status, 400);
  }
  assert.equal(
    (
      await api.POST(
        request('POST', {
          approvalId: 'a',
          approved: true,
          extra: 'x'.repeat(3000)
        }),
        context
      )
    ).status,
    413
  );
  assert.equal(calls.length, 0);
  assert.equal(
    (
      await api.POST(
        request('POST', { approvalId: 'approval', approved: false }),
        context
      )
    ).status,
    200
  );
  assert.deepEqual(calls[1], ['run', 'user', 'approval', false]);
});
