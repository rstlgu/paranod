const test = require('node:test');
const assert = require('node:assert/strict');
const createLoader = require('../scripts/test-support/load-typescript.cjs');

function hooks() {
  const cells = [];
  let cursor = 0;
  return {
    render(callback) {
      cursor = 0;
      return callback();
    },
    react: {
      useRef(value) {
        const index = cursor++;
        return (cells[index] ??= { current: value });
      },
      useState(initial) {
        const index = cursor++;
        const cell = (cells[index] ??= { value: initial });
        return [
          cell.value,
          (value) => {
            cell.value =
              typeof value === 'function' ? value(cell.value) : value;
          }
        ];
      },
      useCallback: (callback) => callback,
      useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
      useEffect: () => {}
    }
  };
}

function setup(t) {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const calls = [];
  global.fetch = (_url, options) =>
    new Promise((resolve, reject) => {
      calls.push({ body: JSON.parse(options.body), resolve, reject });
    });
  const harness = hooks();
  const load = createLoader({
    react: harness.react,
    '@/contexts/save-status-context': { useRegisterManualSave: () => {} }
  });
  const { useGraphAutosave } = load(
    'src/features/graph/components/graph-editor/hooks/use-graph-autosave.ts'
  );
  let current = true;
  const savedTimes = [];
  const args = {
    graphId: 'graph',
    mounted: true,
    nodes: [],
    edges: [],
    isUndoRedoRef: { current: false },
    isLoadingFromStorageRef: { current: false },
    writeVersionRef: { current: 0 },
    createStateHash: (nodes, edges) => JSON.stringify({ nodes, edges }),
    saveStatus: {
      setSaving: () => {},
      setLastSaved: (date) => savedTimes.push(date)
    },
    canEditSnapshot: () => current
  };
  const render = () => harness.render(() => useGraphAutosave(args));
  return {
    args,
    calls,
    savedTimes,
    render,
    invalidate: () => {
      current = false;
    }
  };
}

const node = (id) => [{ id, data: { label: id } }];
const tick = () => new Promise((done) => setImmediate(done));
const ok = () => new Response('{}', { status: 200 });

test('graph saves serialize snapshots and confirm the latest save', async (t) => {
  const { render, calls } = setup(t);
  const hook = render();
  const first = hook.saveToDatabase(node('first'), []);
  const last = hook.saveToDatabase(node('last'), []);
  await tick();
  assert.equal(calls.length, 1);
  calls[0].resolve(ok());
  assert.equal(await first, true);
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.nodes[0].id, 'last');
  calls[1].resolve(ok());
  assert.equal(await last, true);
  assert.equal(await hook.saveToDatabase(node('last'), []), true);
  assert.equal(calls.length, 2);
});

test('reverting to the previously saved graph still waits for an in-flight save', async (t) => {
  const { render, calls } = setup(t);
  const hook = render();
  hook.markSavedState(node('original'), []);
  const edited = hook.saveToDatabase(node('edit'), []);
  const reverted = hook.saveToDatabase(node('original'), []);
  await tick();
  calls[0].resolve(ok());
  await edited;
  await tick();
  assert.equal(calls[1].body.nodes[0].id, 'original');
  calls[1].resolve(ok());
  assert.equal(await reverted, true);
});

test('failed saves are not confirmed or deduplicated as successful', async (t) => {
  const { render, calls } = setup(t);
  const hook = render();
  const failed = hook.saveToDatabase(node('draft'), []);
  await tick();
  calls[0].resolve(new Response('{}', { status: 500 }));
  assert.equal(await failed, false);
  const retried = hook.saveToDatabase(node('draft'), []);
  await tick();
  assert.equal(calls.length, 2);
  calls[1].reject(new Error('network'));
  assert.equal(await retried, false);
});

test('lease changes drop queued writes and ignore late acknowledgements', async (t) => {
  const { render, calls, args, savedTimes } = setup(t);
  const hook = render();
  const inFlight = hook.saveToDatabase(node('first'), []);
  const queued = hook.saveToDatabase(node('old-draft'), []);
  await tick();
  args.writeVersionRef.current = 2;
  hook.markSavedState(node('agent-result'), []);
  calls[0].resolve(ok());
  assert.equal(await inFlight, false);
  assert.equal(await queued, false);
  assert.equal(calls.length, 1);
  assert.equal(savedTimes.length, 0);
});

test('reload of the same lease epoch also invalidates old writes', async (t) => {
  const { render, calls, invalidate } = setup(t);
  const hook = render();
  const save = hook.saveToDatabase(node('old'), []);
  await tick();
  invalidate();
  calls[0].resolve(ok());
  assert.equal(await save, false);
  assert.equal(await hook.saveToDatabase(node('old'), []), false);
  assert.equal(calls.length, 1);
});

test('flush waits for previous requests and saves the latest rendered draft', async (t) => {
  const { render, calls, args } = setup(t);
  let hook = render();
  const first = hook.saveToDatabase(node('first'), []);
  await tick();
  args.nodes = node('latest');
  hook = render();
  let flushed = false;
  const flush = hook.flush().then((result) => {
    flushed = true;
    return result;
  });
  await tick();
  assert.equal(flushed, false);
  assert.equal(calls.length, 1);
  calls[0].resolve(ok());
  await first;
  await tick();
  assert.equal(calls[1].body.nodes[0].id, 'latest');
  calls[1].resolve(ok());
  assert.equal(await flush, true);
});

test('flush reports false if the draft changes before its acknowledgement', async (t) => {
  const { render, calls, args } = setup(t);
  args.nodes = node('before');
  const hook = render();
  const flush = hook.flush();
  await tick();
  args.nodes = node('after');
  render();
  calls[0].resolve(ok());
  assert.equal(await flush, false);
});

test('queued request bodies retain their original snapshot', async (t) => {
  const { render, calls } = setup(t);
  const hook = render();
  const nodes = node('captured');
  const save = hook.saveToDatabase(nodes, []);
  nodes[0].id = 'mutated';
  await tick();
  assert.equal(calls[0].body.nodes[0].id, 'captured');
  calls[0].resolve(ok());
  assert.equal(await save, true);
});

test('write guards invalidate old callbacks before a reload has rendered', () => {
  const harness = hooks();
  let state = { version: 0, locked: false, expiresAt: null };
  const mutate = () => Promise.resolve();
  const load = createLoader({
    react: harness.react,
    swr: {
      __esModule: true,
      default: () => ({ data: state, mutate }),
      useSWRConfig: () => ({ mutate })
    }
  });
  const { useGraphWriteGuard } = load(
    'src/features/graph/components/graph-editor/hooks/use-graph-write-guard.ts'
  );
  const render = () => harness.render(() => useGraphWriteGuard('graph'));
  let guard = render();
  assert.equal(guard.canEditSnapshot(), false);
  guard.acceptSnapshot('graph', state);
  guard = render();
  const oldCallback = guard.canEditSnapshot;
  assert.equal(oldCallback(), true);
  guard.acceptSnapshot('graph', state);
  assert.equal(oldCallback(), false);
  guard = render();
  assert.equal(guard.canEditSnapshot(), true);
  guard.reject();
  assert.equal(guard.canEditSnapshot(), false);
  guard = render();
  assert.equal(guard.canEditSnapshot(), false);
  state = { ...state, version: 2 };
  guard.acceptSnapshot('graph', state);
  guard = render();
  assert.equal(guard.canEditSnapshot(), true);
  assert.equal(oldCallback(), false);
});

test('metadata and connection edits are saved even when the layout hash is unchanged', async (t) => {
  const { render, calls, args } = setup(t);
  args.createStateHash = () => 'same-layout';
  args.nodes = node('seed');
  const hook = render();
  hook.markSavedState(args.nodes, []);
  const changed = [
    { ...args.nodes[0], data: { label: 'seed', metadata: { verified: true } } }
  ];
  const edges = [
    { id: 'edge', source: 'seed', target: 'other', label: 'New relation' }
  ];
  const saved = hook.saveToDatabase(changed, edges);
  await tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.nodes, changed);
  assert.deepEqual(calls[0].body.edges, edges);
  calls[0].resolve(ok());
  assert.equal(await saved, true);
});

test('a start barrier persists the captured draft and does not deduplicate a previous acknowledgement', async (t) => {
  const { render, calls, args } = setup(t);
  args.nodes = node('captured');
  const hook = render();
  hook.markSavedState(args.nodes, []);
  const captured = structuredClone({ nodes: args.nodes, edges: [] });
  const saved = hook.flush(true, captured);
  await tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.nodes, captured.nodes);
  calls[0].resolve(ok());
  assert.equal(await saved, true);
});

test('start saves the frozen draft even if an intermediate render updates the autosave ref', async (t) => {
  const { render, calls, args } = setup(t);
  args.nodes = node('intermediate-render');
  const hook = render();
  const captured = { nodes: node('frozen-draft'), edges: [] };
  const saved = hook.flush(true, captured);
  await tick();
  assert.deepEqual(calls[0].body.nodes, captured.nodes);
  args.nodes = captured.nodes;
  render();
  calls[0].resolve(ok());
  assert.equal(await saved, true);
});
