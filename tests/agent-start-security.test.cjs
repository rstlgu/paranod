const test = require('node:test');
const assert = require('node:assert/strict');
const createLoader = require('../scripts/test-support/load-typescript.cjs');

const body = {
  runId: 'ee423bc3-7c44-4b4c-8a87-f3e106f65b8d',
  graphId: 'graph',
  goal: 'Inspect example.test',
  model: 'gpt-6-astra',
  reasoning: 'low',
  expectedWriteVersion: 0,
  expectedRevision: 'a'.repeat(64)
};
const scope = { userId: 'user', workspaceId: 'workspace' };
const input = { ...body, approvalMode: 'guarded', ...scope };

function queueFixture(options = {}) {
  const order = [];
  const load = createLoader({
    './snapshot': {
      readAgentStartSnapshot: async () => {
        order.push('snapshot');
        return { revision: body.expectedRevision, writeState: { version: 0 } };
      }
    },
    './readiness': {
      assertAgentWorkerCapacity: async () => {
        order.push('capacity');
        if (options.capacityError) throw options.capacityError;
      }
    },
    './runs': {
      beginAgentRun: async (_tx, received) => {
        order.push('lease');
        assert.equal(received.runId, body.runId);
        assert.match(received.startRequestHash, /^[a-f0-9]{64}$/);
        return { runId: received.runId };
      }
    }
  });
  const module = load('src/features/agent/server/queue.ts');
  const tx = {
    agentRun: {
      findUnique: async () => options.existing ?? null,
      findFirst: async ({ where }) => {
        assert.equal(where.graphId, input.graphId);
        assert.equal(where.userId, input.userId);
        return options.parent ?? null;
      }
    },
    transformJob: { count: async () => options.manualJobs ?? 0 },
    $queryRawUnsafe: async () => []
  };
  return {
    module,
    load,
    tx,
    order,
    db: { $transaction: async (fn) => fn(tx) }
  };
}

test('a producer sends metadata and insertion on the same transaction without starting pg-boss', async () => {
  const { module } = queueFixture();
  const calls = [];
  const producer = module.createAgentProducer();
  assert.deepEqual(
    calls,
    [],
    'construction must not connect, migrate or start maintenance'
  );
  const tx = {
    $queryRawUnsafe: async (sql, ...values) => {
      calls.push({ client: 'transaction', sql, values });
      return /INSERT INTO/i.test(sql)
        ? [{ id: body.runId }]
        : [
            {
              name: module.AGENT_QUEUE,
              table: 'job',
              policy: 'standard',
              notify: false
            }
          ];
    }
  };
  assert.equal(
    await producer.send(
      module.AGENT_QUEUE,
      { runId: body.runId },
      {
        id: body.runId,
        db: module.transactionDatabase(tx)
      }
    ),
    body.runId
  );
  assert.deepEqual(
    calls.map((call) => call.client),
    ['transaction', 'transaction']
  );
  assert.doesNotMatch(calls[0].sql, /\b(?:CREATE|ALTER|INSERT)\b/i);
  assert.match(calls[1].sql, /INSERT INTO/i);
  assert.deepEqual(JSON.parse(calls[1].values[0])[0].data, {
    runId: body.runId
  });
  assert.ok(
    calls.every(
      (call) => !/CREATE TABLE|CREATE SCHEMA|ALTER TABLE/i.test(call.sql)
    )
  );
});

test('cold producer does not acquire an outer connection and requires a transaction adapter', async () => {
  const { module } = queueFixture();
  let inserted = false;
  const producer = module.createAgentProducer();
  const tx = {
    $queryRawUnsafe: async (sql) => {
      if (/INSERT INTO/i.test(sql)) {
        inserted = true;
        return [{ id: body.runId }];
      }
      return [
        {
          name: module.AGENT_QUEUE,
          table: 'job',
          policy: 'standard',
          notify: false
        }
      ];
    }
  };
  assert.equal(
    await producer.send(
      module.AGENT_QUEUE,
      { runId: body.runId },
      {
        id: body.runId,
        db: module.transactionDatabase(tx)
      }
    ),
    body.runId
  );
  assert.equal(inserted, true);
  await assert.rejects(
    producer.send(module.AGENT_QUEUE, {}, {}),
    /agent_queue_transaction_required/
  );
});

test('enqueue checks capacity before acquiring a new lease and binds insertion to that transaction', async () => {
  const f = queueFixture();
  const queue = {
    send: async (name, data, options) => {
      f.order.push('send');
      assert.equal(name, f.module.AGENT_QUEUE);
      assert.deepEqual(data, { runId: body.runId });
      assert.equal(options.id, body.runId);
      f.tx.$queryRawUnsafe = async (sql, parameter) => {
        assert.equal(sql, 'synthetic SQL');
        assert.equal(parameter, 'synthetic parameter');
        return [{ inserted: true }];
      };
      assert.deepEqual(
        await options.db.executeSql('synthetic SQL', ['synthetic parameter']),
        { rows: [{ inserted: true }] }
      );
      return body.runId;
    }
  };
  assert.deepEqual(await f.module.enqueueAgentRun(f.db, queue, input), {
    runId: body.runId
  });
  assert.deepEqual(f.order, ['snapshot', 'capacity', 'lease', 'send']);
});

test('unavailable capacity and pending manual jobs cannot acquire a lease or enqueue', async () => {
  for (const options of [
    { capacityError: new Error('agent_worker_busy') },
    { manualJobs: 1 }
  ]) {
    const f = queueFixture(options);
    await assert.rejects(
      f.module.enqueueAgentRun(
        f.db,
        { send: () => assert.fail('unexpected enqueue') },
        input
      )
    );
    assert.deepEqual(f.order, ['snapshot', 'capacity']);
  }
});

test('follow-ups require an owned terminal parent on the same graph', async () => {
  const parentRunId = 'c551568b-b575-49e3-a4e1-2047168d3ba2';
  const f = queueFixture();
  await assert.rejects(
    f.module.enqueueAgentRun(
      f.db,
      { send: () => assert.fail('unexpected enqueue') },
      { ...input, parentRunId }
    ),
    { code: 'agent_conversation_unavailable', status: 409 }
  );
  assert.deepEqual(f.order, ['snapshot']);
  const running = queueFixture({ parent: { status: 'running' } });
  await assert.rejects(
    running.module.enqueueAgentRun(
      running.db,
      { send: () => assert.fail('unexpected enqueue') },
      { ...input, parentRunId }
    ),
    { code: 'agent_conversation_unavailable', status: 409 }
  );
  const valid = queueFixture({ parent: { status: 'completed' } });
  assert.deepEqual(
    await valid.module.enqueueAgentRun(
      valid.db,
      { send: async () => body.runId },
      { ...input, parentRunId }
    ),
    { runId: body.runId }
  );
});

test('exact retries return the original run without capacity checks or a second enqueue', async () => {
  const f = queueFixture();
  const { agentStartRequestHash } = f.load(
    'src/features/agent/server/start-contract.ts'
  );
  f.tx.agentRun.findUnique = async () => ({
    id: body.runId,
    ...scope,
    graphId: body.graphId,
    startRequestHash: agentStartRequestHash(input),
    graph: { ...scope }
  });
  assert.deepEqual(
    await f.module.enqueueAgentRun(
      f.db,
      { send: () => assert.fail('unexpected enqueue') },
      input
    ),
    { runId: body.runId }
  );
  assert.deepEqual(f.order, ['snapshot']);
  for (const patch of [
    { goal: 'Different goal' },
    { userId: 'other' },
    { workspaceId: 'other' },
    { graphId: 'other' },
    { expectedWriteVersion: 1 }
  ]) {
    await assert.rejects(
      f.module.findStartedAgentRun(f.tx, { ...input, ...patch }),
      { code: 'agent_start_conflict', status: 409 }
    );
  }
});

function apiFixture(options = {}) {
  const calls = [];
  const load = createLoader({
    '@/lib/auth-utils': {
      getActiveWorkspaceAccess: async () => (options.anonymous ? null : scope)
    },
    '@/lib/db': { db: {} },
    '@/features/agent/server/credential': {
      getAgentModelAccess: async () =>
        options.modelAccess ?? { providers: ['openai'], openrouterModels: [] }
    },
    '@/features/agent/server/provider': {
      getWorkspaceAgentAvailability: async () => {
        calls.push('availability');
        return options.availability ?? { available: true, reason: null };
      }
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
      findStartedAgentRun: async () => options.previous ?? null,
      enqueueAgentRun: async (_db, _queue, received) => {
        calls.push('enqueue');
        assert.deepEqual(received, input);
        if (options.error) throw options.error;
        return { runId: received.runId };
      }
    }
  });
  const { POST } = load('src/app/api/agent/runs/route.ts');
  return {
    calls,
    post: (payload = body) =>
      POST(
        new Request('http://localhost/api/agent/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
      )
  };
}

test('public start rejects anonymous, client-supplied scope and oversized requests', async () => {
  assert.equal((await apiFixture({ anonymous: true }).post()).status, 401);
  for (const patch of [
    { userId: 'attacker' },
    { workspaceId: 'other' },
    { expectedWriteVersion: Number.MAX_SAFE_INTEGER + 1 }
  ]) {
    const f = apiFixture();
    assert.equal((await f.post({ ...body, ...patch })).status, 400);
    assert.deepEqual(f.calls, []);
  }
  assert.equal(
    (await apiFixture().post({ ...body, goal: 'x'.repeat(40_001) })).status,
    413
  );
});

test('public retry remains idempotent even when configuration or workers become unavailable', async () => {
  const f = apiFixture({
    previous: { runId: body.runId },
    availability: { available: false, reason: 'agent_worker_unavailable' }
  });
  const response = await f.post();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { runId: body.runId });
  assert.deepEqual(f.calls, []);
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('public start injects trusted scope and redacts unexpected queue failures', async () => {
  assert.equal((await apiFixture().post()).status, 201);
  const response = await apiFixture({
    error: new Error('synthetic-private-provider-credential')
  }).post();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'agent_start_unavailable' });
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('public start refuses models whose provider has no workspace key', async () => {
  const f = apiFixture({
    modelAccess: { providers: ['anthropic'], openrouterModels: [] }
  });
  const response = await f.post();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'agent_provider_key_not_configured'
  });
  assert.deepEqual(f.calls, ['availability']);
});
