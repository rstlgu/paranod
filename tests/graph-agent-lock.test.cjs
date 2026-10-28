const test = require('node:test');
const assert = require('node:assert/strict');
const createLoader = require('../scripts/test-support/load-typescript.cjs');

function app({
  locked = false,
  version = 0,
  userId = 'user',
  owner = 'user'
} = {}) {
  const writes = [];
  const graph = {
    id: 'graph',
    userId: owner,
    caseId: 'case',
    name: 'Graph',
    notes: 'Note',
    nodes: [],
    edges: [],
    caseNote: null
  };
  const note = {
    id: 'note',
    caseId: 'case',
    graphId: 'graph',
    type: 'note',
    content: 'Note'
  };
  const db = {
    $queryRaw: async (strings) =>
      strings.join('').includes('clock_timestamp')
        ? [{ now: new Date('2026-09-27T12:00:00Z') }]
        : [{ id: 'graph' }],
    $transaction: async (callback) => callback(db),
    graphAgentLease: {
      findUnique: async () => ({
        generation: version,
        runId: locked ? 'run' : null,
        userId: locked ? 'user' : null,
        token: locked ? 'private-token' : null,
        expiresAt: locked ? new Date('2026-09-27T12:01:00Z') : null
      })
    },
    graph: {
      findFirst: async ({ where }) =>
        where.userId && where.userId !== owner ? null : graph,
      findUniqueOrThrow: async () => graph,
      update: async ({ data }) => {
        writes.push(data);
        return { ...graph, ...data };
      },
      delete: async () => {
        writes.push('delete');
        return graph;
      }
    },
    case: { findUnique: async () => ({ id: 'case', name: 'Case' }) },
    caseArtifact: {
      findFirst: async () => note,
      findUniqueOrThrow: async () => note,
      update: async ({ data }) => {
        writes.push(data);
        return { ...note, ...data };
      },
      deleteMany: async () => {
        writes.push('delete-note');
        return { count: 1 };
      }
    }
  };
  const load = createLoader({
    '@/lib/db': { db },
    '@/lib/auth-session': { auth: async () => ({ userId }) },
    '@/app/api/cases/_utils': {
      requireActiveWorkspaceMember: async () =>
        userId
          ? { ok: true, ctx: { userId, workspaceId: 'workspace' } }
          : { ok: false, status: 401, error: 'Unauthorized' },
      requireCaseInWorkspace: async () => ({ id: 'case' })
    }
  });
  return { writes, load };
}

const context = {
  params: Promise.resolve({ graphId: 'graph', caseId: 'case', noteId: 'note' })
};
const request = (method, body = {}) =>
  new Request('http://localhost/api/graphs/graph', {
    method,
    ...(method !== 'GET' && method !== 'DELETE'
      ? {
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' }
        }
      : {})
  });

test('linked case-note saves preserve whitespace and intentional empty content', async () => {
  for (const content of [' \n<p>Keep the exact draft</p>\n ', '']) {
    const f = app();
    const api = f.load('src/app/api/cases/[caseId]/notes/[noteId]/route.ts');
    const response = await api.PATCH(
      request('PATCH', { content, expectedWriteVersion: 0 }),
      context
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).note.content, content);
    assert.deepEqual(f.writes, [{ content }, { notes: content }]);
  }
});

test('graph APIs deny anonymous callers and do not expose another owner lock', async () => {
  for (const route of ['route.ts', 'write-state/route.ts', 'notes/route.ts']) {
    const anonymous = app({ userId: null });
    const api = anonymous.load(`src/app/api/graphs/[graphId]/${route}`);
    assert.equal((await api.GET(request('GET'), context)).status, 401);
    const other = app({ owner: 'other', locked: true });
    assert.equal(
      (
        await other
          .load(`src/app/api/graphs/[graphId]/${route}`)
          .GET(request('GET'), context)
      ).status,
      404
    );
  }
});

test('read-only graph state never includes the internal lease token', async () => {
  const { load } = app({ locked: true, version: 1 });
  const result = await load(
    'src/app/api/graphs/[graphId]/write-state/route.ts'
  ).GET(request('GET'), context);
  assert.equal(result.status, 200);
  assert.match(result.headers.get('cache-control'), /no-store/);
  assert.deepEqual(await result.json(), {
    writeState: {
      version: 1,
      locked: true,
      expiresAt: '2026-09-27T12:01:00.000Z'
    }
  });
});

test('agent lock blocks graph snapshots, metadata and deletion', async () => {
  for (const [method, body] of [
    ['PUT', { nodes: [] }],
    ['PUT', { name: 'Rename' }],
    ['DELETE', {}]
  ]) {
    const { load, writes } = app({ locked: true, version: 1 });
    const result = await load('src/app/api/graphs/[graphId]/route.ts')[method](
      request(method, body),
      context
    );
    assert.equal(result.status, 423);
    assert.equal((await result.json()).error, 'graph_agent_running');
    assert.deepEqual(writes, []);
  }
});

test('snapshot saves need the current version after an agent run', async () => {
  for (const [expectedWriteVersion, status] of [
    [undefined, 428],
    [0, 409],
    ['2', 400],
    [2, 200]
  ]) {
    const { load, writes } = app({ version: 2 });
    const result = await load('src/app/api/graphs/[graphId]/route.ts').PUT(
      request('PUT', { nodes: [], edges: [], expectedWriteVersion }),
      context
    );
    assert.equal(result.status, status);
    assert.equal(writes.length, status === 200 ? 1 : 0);
  }
});

test('graph notes and linked case notes cannot bypass the agent lock', async () => {
  for (const [filename, methods] of [
    ['src/app/api/graphs/[graphId]/notes/route.ts', ['PATCH', 'POST']],
    ['src/app/api/cases/[caseId]/notes/[noteId]/route.ts', ['PATCH', 'DELETE']]
  ]) {
    for (const method of methods) {
      const { load, writes } = app({ locked: true, version: 1 });
      const response = await load(filename)[method](
        request(method, { content: 'Changed' }),
        context
      );
      assert.equal(response.status, 423, `${filename} ${method}`);
      assert.deepEqual(writes, []);
    }
  }
});

test('late note saves are rejected after the agent releases the graph', async () => {
  for (const filename of [
    'src/app/api/graphs/[graphId]/notes/route.ts',
    'src/app/api/cases/[caseId]/notes/[noteId]/route.ts'
  ]) {
    const { load, writes } = app({ version: 2 });
    const response = await load(filename).PATCH(
      request('PATCH', { content: 'Old snapshot', expectedWriteVersion: 0 }),
      context
    );
    assert.equal(response.status, 409);
    assert.deepEqual(writes, []);
  }
});

for (const status of [409, 423, 428]) {
  test(`autosave preserves local data and stops retrying after ${status}`, async (t) => {
    const original = {
      fetch: global.fetch,
      window: global.window,
      localStorage: Object.getOwnPropertyDescriptor(global, 'localStorage')
    };
    t.after(() => {
      global.fetch = original.fetch;
      global.window = original.window;
      if (original.localStorage) {
        Object.defineProperty(global, 'localStorage', original.localStorage);
      } else {
        delete global.localStorage;
      }
    });
    const sent = [];
    const events = [];
    global.window = { dispatchEvent: (event) => events.push(event.detail) };
    Object.defineProperty(global, 'localStorage', {
      value: { setItem: () => {} },
      configurable: true
    });
    global.fetch = async (_url, options) => {
      sent.push(JSON.parse(options.body));
      return new Response('{}', { status });
    };
    const load = createLoader({
      react: {
        useRef: (current) => ({ current }),
        useCallback: (callback) => callback,
        useEffect: () => {}
      },
      '@/contexts/save-status-context': { useRegisterManualSave: () => {} }
    });
    const writeVersionRef = { current: 0 };
    const nodes = [{ id: 'local-draft', data: { label: 'Keep me' } }];
    const { useGraphAutosave } = load(
      'src/features/graph/components/graph-editor/hooks/use-graph-autosave.ts'
    );
    const hook = useGraphAutosave({
      graphId: 'graph',
      mounted: true,
      nodes,
      edges: [],
      isUndoRedoRef: { current: false },
      isLoadingFromStorageRef: { current: false },
      createStateHash: JSON.stringify,
      saveStatus: { setSaving: () => {} },
      writeVersionRef
    });
    await hook.saveToDatabase(nodes, []);
    assert.equal(sent[0].expectedWriteVersion, 0);
    assert.equal(writeVersionRef.current, undefined);
    assert.deepEqual(nodes, [
      { id: 'local-draft', data: { label: 'Keep me' } }
    ]);
    assert.deepEqual(events, [{ graphId: 'graph', status }]);
    await hook.saveToDatabase(nodes, []);
    assert.equal(sent.length, 1);
  });
}
