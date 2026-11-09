import { describe, expect, it, vi } from 'vitest';
import {
  createGraphClientCoordinator,
  graphDraftFingerprint,
  type CanonicalGraphSnapshot,
  type EditorDraft,
  type GraphParticipant
} from './graph-client-coordinator';

const input = {
  graphId: 'graph',
  goal: 'Investigate example.org',
  model: 'test-model',
  reasoning: 'high'
};
const graph = {
  nodes: [
    {
      id: 'a',
      position: { x: 1, y: 2 },
      data: { label: 'example.org', metadata: { source: 'human' } }
    }
  ],
  edges: []
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function fixture() {
  let canonical: CanonicalGraphSnapshot = {
    graphId: 'graph',
    revision: 'a'.repeat(64),
    writeState: { version: 2, locked: false, expiresAt: null },
    ...structuredClone(graph),
    notes: 'note'
  };
  const posts: Record<string, unknown>[] = [];
  const request = vi.fn(
    async (_url: string | URL | Request, options?: RequestInit) => {
      if (options?.method === 'PUT') {
        const body = JSON.parse(String(options.body));
        canonical.nodes = body.nodes;
        canonical.edges = body.edges;
        return Response.json({ graph: canonical });
      }
      if (options?.method === 'POST') {
        const body = JSON.parse(String(options.body));
        posts.push(body);
        return Response.json({ runId: body.runId });
      }
      return Response.json(canonical);
    }
  );
  const coordinator = createGraphClientCoordinator(request);
  const draft: EditorDraft = {
    ready: true,
    version: 2,
    value: structuredClone(graph),
    dirty: true
  };
  const editor: GraphParticipant = {
    kind: 'graph',
    capture: () => draft,
    idle: vi.fn(async () => {}),
    flush: vi.fn(async () => true),
    adopt: vi.fn()
  };
  const unregister = coordinator.register('graph', editor);
  const note = (value = 'note', dirty = true) => {
    const draft: EditorDraft = { ready: true, version: 2, value, dirty };
    const editor: GraphParticipant = {
      kind: 'note',
      capture: () => draft,
      idle: vi.fn(async () => {}),
      flush: vi.fn(async () => {
        canonical.notes = String(draft.value);
        return true;
      }),
      adopt: vi.fn(),
      invalidate: vi.fn()
    };
    const unregister = coordinator.register('graph', editor);
    return { draft, editor, unregister };
  };
  return {
    coordinator,
    editor,
    draft,
    request,
    posts,
    canonical,
    note,
    unregister
  };
}

describe('frontend agent start barrier', () => {
  it('binds follow-ups to their parent through the barrier and exact uncertain retry', async () => {
    const f = fixture();
    const parentRunId = '6b29fc40-ca47-4067-b31d-00dd010662da';
    const gate = deferred();
    f.editor.idle = () => gate.promise;
    let lost = true;
    f.request.mockImplementation(async (_url, options) => {
      if (options?.method !== 'POST') return Response.json(f.canonical);
      const body = JSON.parse(String(options.body));
      f.posts.push(body);
      if (lost) {
        lost = false;
        throw new TypeError('Network lost');
      }
      return Response.json({ runId: body.runId });
    });
    const start = f.coordinator.start({ ...input, parentRunId });
    const rejected = expect(start).rejects.toThrow('Start not confirmed');
    expect(f.coordinator.frozen('graph')).toBe(true);
    expect(f.posts).toHaveLength(0);
    gate.resolve();
    await rejected;
    expect(f.coordinator.frozen('graph')).toBe(true);
    const runId = await f.coordinator.retry('graph');
    expect(f.posts).toHaveLength(2);
    expect(f.posts[0]).toEqual(f.posts[1]);
    expect(f.posts[1]).toEqual({
      ...input,
      parentRunId,
      runId,
      expectedWriteVersion: 2,
      expectedRevision: 'a'.repeat(64)
    });
  });

  it('waits a closed note editor queue before flushing its final draft', async () => {
    const f = fixture();
    const note = f.note('closing draft');
    const gate = deferred();
    note.editor.idle = () => gate.promise;
    note.unregister();
    const start = f.coordinator.start(input);
    expect(f.coordinator.frozen('graph')).toBe(true);
    expect(f.editor.flush).not.toHaveBeenCalled();
    gate.resolve();
    await start;
    expect(note.editor.flush).toHaveBeenCalledOnce();
    expect(f.canonical.notes).toBe('closing draft');
  });

  it('freezes synchronously, drains all queues, saves, then verifies before POST', async () => {
    const f = fixture();
    const note = f.note();
    const gate = deferred();
    f.editor.idle = vi.fn(() => gate.promise);
    const start = f.coordinator.start(input);
    expect(f.coordinator.frozen('graph')).toBe(true);
    expect(f.coordinator.canSave('graph')).toBe(false);
    expect(f.coordinator.canSave('graph', true)).toBe(true);
    expect(() => f.coordinator.beginManual('graph')).toThrow();
    expect(f.editor.flush).not.toHaveBeenCalled();
    expect(f.request).not.toHaveBeenCalled();
    gate.resolve();
    const runId = await start;
    expect(note.editor.idle).toHaveBeenCalledTimes(2);
    expect(note.editor.flush).toHaveBeenCalledOnce();
    expect(f.posts).toEqual([
      {
        ...input,
        runId,
        expectedWriteVersion: 2,
        expectedRevision: 'a'.repeat(64)
      }
    ]);
    expect(f.coordinator.attempt('graph')?.phase).toBe('running');
    expect(f.coordinator.canSave('graph', true)).toBe(false);
  });

  it('passes the frozen draft to the save barrier after clearing conversation context', async () => {
    const f = fixture();
    const original = structuredClone(f.draft);
    f.canonical.nodes = [];
    f.editor.flush = vi.fn(async (captured) => {
      expect(captured).toEqual(original);
      expect(captured).not.toBe(f.draft);
      const value = captured!.value as typeof graph;
      f.canonical.nodes = structuredClone(value.nodes);
      f.canonical.edges = structuredClone(value.edges);
      return true;
    });
    await f.coordinator.start({
      ...input,
      parentRunId: 'cleared-conversation'
    });
    expect(f.posts).toHaveLength(1);
    expect(f.posts[0].parentRunId).toBe('cleared-conversation');
  });

  it('does not start from history or an unloaded graph', async () => {
    const f = fixture();
    f.unregister();
    f.note();
    await expect(f.coordinator.start(input)).rejects.toThrow('load the graph');
    expect(f.request).not.toHaveBeenCalled();
  });

  it('rejects concurrent starts before a second UUID or write can be used', async () => {
    const f = fixture();
    const gate = deferred();
    f.editor.idle = () => gate.promise;
    const start = f.coordinator.start(input);
    await expect(f.coordinator.start(input)).rejects.toThrow(
      'already in progress'
    );
    gate.resolve();
    await start;
    expect(f.posts).toHaveLength(1);
  });

  it('cancels a preparing start without posting', async () => {
    const f = fixture();
    const gate = deferred();
    f.editor.idle = () => gate.promise;
    const start = f.coordinator.start(input);
    expect(f.coordinator.frozen('graph')).toBe(true);
    expect(f.coordinator.cancelStart('graph')).toEqual({ runId: null });
    expect(f.coordinator.frozen('graph')).toBe(false);
    gate.resolve();
    await expect(start).rejects.toThrow('agent_start_cancelled');
    expect(f.posts).toHaveLength(0);
  });

  it('rejects in-flight manual and unscoped work, even without visible logs', async () => {
    const f = fixture();
    const job = f.coordinator.beginManual('graph');
    await expect(f.coordinator.start(input)).rejects.toThrow(
      'manual transforms'
    );
    job.finish();
    const unscoped = f.coordinator.beginManual();
    await expect(f.coordinator.start(input)).rejects.toThrow(
      'manual transforms'
    );
    unscoped.finish();
    await f.coordinator.start(input);
  });

  it('invalidates old async callbacks permanently, including failed preparations', async () => {
    const f = fixture();
    const job = f.coordinator.beginManual('graph');
    job.finish();
    f.editor.flush = vi.fn(async () => false);
    await expect(f.coordinator.start(input)).rejects.toThrow(
      'Save not confirmed'
    );
    expect(job.current()).toBe(false);
    expect(f.coordinator.frozen('graph')).toBe(false);
    expect(f.draft.value).toEqual(graph);
    expect(f.posts).toHaveLength(0);
  });

  it('detects conflicting note drafts before issuing any barrier writes', async () => {
    const f = fixture();
    const a = f.note('first');
    const b = f.note('second');
    expect(f.coordinator.noteConflict('graph')).toBe(true);
    await expect(f.coordinator.start(input)).rejects.toThrow(
      'Conflicting drafts'
    );
    expect(f.editor.flush).not.toHaveBeenCalled();
    expect(a.editor.flush).not.toHaveBeenCalled();
    expect(b.editor.flush).not.toHaveBeenCalled();
    expect(f.request).not.toHaveBeenCalled();
  });

  it('chooses the single dirty note, drains clean editors, and avoids their stale writes', async () => {
    const f = fixture();
    const clean = f.note('old', false);
    const dirty = f.note('chosen');
    await f.coordinator.start(input);
    expect(clean.editor.idle).toHaveBeenCalledTimes(2);
    expect(clean.editor.flush).not.toHaveBeenCalled();
    expect(dirty.editor.flush).toHaveBeenCalledOnce();
    expect(f.canonical.notes).toBe('chosen');
  });

  it('allows identical note drafts but flushes only one writer', async () => {
    const f = fixture();
    const a = f.note();
    const b = f.note();
    await f.coordinator.start(input);
    expect(a.editor.flush).toHaveBeenCalledOnce();
    expect(b.editor.flush).not.toHaveBeenCalled();
  });

  it('does not guess between divergent clean note snapshots', async () => {
    const f = fixture();
    f.note('a', false);
    f.note('b', false);
    await expect(f.coordinator.start(input)).rejects.toThrow('out of sync');
    expect(f.posts).toHaveLength(0);
  });

  it('blocks if a linked note is loading', async () => {
    const f = fixture();
    f.note().draft.ready = false;
    await expect(f.coordinator.start(input)).rejects.toThrow('not ready');
    expect(f.posts).toHaveLength(0);
  });

  it('rejects a late draft mutation during queue drain', async () => {
    const f = fixture();
    const gate = deferred();
    f.editor.idle = () => gate.promise;
    const pending = f.coordinator.start(input);
    f.draft.value = { nodes: [], edges: [] };
    gate.resolve();
    await expect(pending).rejects.toThrow('draft changed');
    expect(f.posts).toHaveLength(0);
  });

  it('rejects editor membership changes during preparation', async () => {
    const f = fixture();
    const gate = deferred();
    f.editor.idle = () => gate.promise;
    const pending = f.coordinator.start(input);
    f.note();
    gate.resolve();
    await expect(pending).rejects.toThrow('Open editors');
    expect(f.posts).toHaveLength(0);
  });

  it.each(['notes', 'locked', 'revision'])(
    'rejects canonical %s mismatch or invalidity',
    async (field) => {
      const f = fixture();
      f.note();
      f.request.mockImplementation(async () => {
        const canonical = structuredClone(f.canonical);
        if (field === 'notes') canonical.notes = 'other tab';
        if (field === 'locked') canonical.writeState.locked = true;
        if (field === 'revision') canonical.revision = 'invalid';
        return Response.json(canonical);
      });
      await expect(f.coordinator.start(input)).rejects.toThrow();
      expect(f.coordinator.frozen('graph')).toBe(false);
      expect(f.posts).toHaveLength(0);
    }
  );

  it('persists the visible graph with the latest version without adopting server nodes', async () => {
    const f = fixture();
    const graphValue = f.draft.value as { nodes: any[]; edges: unknown[] };
    graphValue.nodes[0].data.createdAt = new Date('2026-09-30T10:00:00Z');
    graphValue.nodes[0].data.optional = undefined;
    f.canonical.nodes = [];
    f.canonical.writeState.version++;
    await expect(f.coordinator.start(input)).resolves.toBeTypeOf('string');
    expect(f.editor.adopt).not.toHaveBeenCalled();
    expect(f.canonical.nodes).toEqual(
      JSON.parse(JSON.stringify(graphValue.nodes))
    );
    expect(f.posts).toHaveLength(1);
    expect(f.posts[0].expectedWriteVersion).toBe(3);
  });

  it.each([
    [141.12000805986722, 141.1200080598672],
    [283.66218546322625, 283.6621854632263],
    [-145.50003380861355, -145.5000338086136],
    [-275.16333805159695, -275.163338051597]
  ])(
    'starts a follow-up after moving a node to %s despite database float serialization',
    async (local, saved) => {
      const f = fixture();
      const value = f.draft.value as typeof graph;
      value.nodes[0].position = { x: local, y: -local };
      f.editor.flush = vi.fn(async () => {
        f.canonical.nodes = structuredClone(value.nodes);
        (f.canonical.nodes[0] as (typeof graph.nodes)[0]).position = {
          x: saved,
          y: -saved
        };
        f.canonical.revision = 'b'.repeat(64);
        return true;
      });
      const original = f.request.getMockImplementation()!;
      f.request.mockImplementation(async (url, options) => {
        const response = await original(url, options);
        if (options?.method === 'PUT')
          (f.canonical.nodes[0] as (typeof graph.nodes)[0]).position = {
            x: saved,
            y: -saved
          };
        return response;
      });
      const parentRunId = 'previous-investigation';
      await f.coordinator.start({ ...input, parentRunId });
      expect(f.posts).toHaveLength(1);
      expect(f.posts[0]).toMatchObject({
        parentRunId,
        expectedRevision: 'b'.repeat(64),
        expectedWriteVersion: 2
      });
      expect(
        f.request.mock.calls.some(([, options]) => options?.method === 'PUT')
      ).toBe(false);
      expect(f.editor.adopt).not.toHaveBeenCalled();
      expect(value.nodes[0].position).toEqual({ x: local, y: -local });
    }
  );

  it('reconciles a moved node with a stale version and database-rounded coordinates', async () => {
    const f = fixture();
    const value = f.draft.value as typeof graph;
    value.nodes[0].position.x = 141.12000805986722;
    f.canonical.writeState.version++;
    f.editor.flush = vi.fn(async () => false);
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (url, options) => {
      const response = await original(url, options);
      if (options?.method === 'PUT')
        (f.canonical.nodes[0] as (typeof graph.nodes)[0]).position.x =
          141.1200080598672;
      return response;
    });
    await f.coordinator.start({
      ...input,
      parentRunId: 'previous-investigation'
    });
    expect(f.posts).toHaveLength(1);
    expect(f.posts[0].expectedWriteVersion).toBe(3);
    expect(f.editor.adopt).not.toHaveBeenCalled();
  });

  it.each([
    'position',
    'metadata',
    'numeric-metadata',
    'label',
    'deleted-node',
    'edge'
  ])(
    'still rejects a real concurrent %s change after saving',
    async (change) => {
      const f = fixture();
      const original = f.request.getMockImplementation()!;
      const value = f.draft.value as typeof graph;
      value.nodes[0].position.x = 141.12000805986722;
      Object.assign(value.nodes[0].data.metadata, {
        confidence: 0.9999999999999999
      });
      f.request.mockImplementation(async (url, options) => {
        const response = await original(url, options);
        if (options?.method === 'PUT') {
          const node = f.canonical.nodes[0] as (typeof graph.nodes)[0];
          node.position.x = 141.1200080598672;
          if (change === 'position') node.position.x += 0.000001;
          if (change === 'metadata')
            Object.assign(node.data.metadata, { confidence: 0.9 });
          if (change === 'numeric-metadata')
            Object.assign(node.data.metadata, { confidence: 1 });
          if (change === 'label') node.data.label = 'other.example';
          if (change === 'deleted-node') f.canonical.nodes = [];
          if (change === 'edge')
            f.canonical.edges = [{ id: 'new', source: 'a', target: 'b' }];
        }
        return response;
      });
      await expect(f.coordinator.start(input)).rejects.toThrow(
        'changed elsewhere'
      );
      expect(f.posts).toHaveLength(0);
      expect(f.coordinator.frozen('graph')).toBe(false);
      expect(f.editor.adopt).not.toHaveBeenCalled();
    }
  );

  it('reconciles a revision race and automatically retries the start with the current graph', async () => {
    const f = fixture();
    const original = f.request.getMockImplementation()!;
    const bodies: any[] = [];
    f.request.mockImplementation(async (url, options) => {
      if (options?.method === 'POST') {
        bodies.push(JSON.parse(String(options.body)));
        if (bodies.length === 1) {
          f.canonical.revision = 'b'.repeat(64);
          f.canonical.nodes = [];
          return Response.json(
            { error: 'agent_snapshot_changed' },
            { status: 409 }
          );
        }
      }
      return original(url, options);
    });
    await f.coordinator.start(input);
    expect(bodies).toHaveLength(2);
    expect(bodies[1].runId).toBe(bodies[0].runId);
    expect(bodies[1].expectedRevision).toBe('b'.repeat(64));
    expect(f.editor.adopt).not.toHaveBeenCalled();
    expect(f.canonical.nodes).toEqual(graph.nodes);
    expect(f.posts).toHaveLength(1);
  });

  it('keeps an automatically rebased request unchanged if its response is lost', async () => {
    const f = fixture();
    const original = f.request.getMockImplementation()!;
    const bodies: string[] = [];
    f.request.mockImplementation(async (url, options) => {
      if (options?.method === 'POST') {
        bodies.push(String(options.body));
        if (bodies.length === 1) {
          f.canonical.revision = 'b'.repeat(64);
          return Response.json(
            { error: 'agent_snapshot_changed' },
            { status: 409 }
          );
        }
        if (bodies.length === 2) throw new Error('Lost response');
      }
      return original(url, options);
    });
    await expect(f.coordinator.start(input)).rejects.toThrow(
      'Start not confirmed'
    );
    await f.coordinator.retry('graph');
    expect(bodies[2]).toBe(bodies[1]);
  });

  it('bounds automatic reconciliation when another writer keeps changing the graph', async () => {
    const f = fixture();
    const original = f.request.getMockImplementation()!;
    let posts = 0;
    f.request.mockImplementation(async (url, options) => {
      if (options?.method === 'POST') {
        posts++;
        return Response.json(
          { error: 'agent_snapshot_changed' },
          { status: 409 }
        );
      }
      return original(url, options);
    });
    await expect(f.coordinator.start(input)).rejects.toThrow('Start rejected');
    expect(posts).toBe(3);
    expect(f.coordinator.attempt('graph')?.phase).toBe('rejected');
  });

  it('does not overwrite a locally changed draft while reconciling a denied start', async () => {
    const f = fixture();
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (url, options) => {
      if (options?.method === 'POST') {
        f.draft.value = { nodes: [], edges: [] };
        return Response.json(
          { error: 'agent_snapshot_changed' },
          { status: 409 }
        );
      }
      return original(url, options);
    });
    await expect(f.coordinator.start(input)).rejects.toThrow('synchronization');
    expect(f.editor.adopt).not.toHaveBeenCalled();
    expect(f.draft.value).toEqual({ nodes: [], edges: [] });
  });

  it('still rejects domain changes after JSON normalization', () => {
    const draft = {
      nodes: [{ id: 'a', data: { createdAt: new Date(0), label: 'Original' } }],
      edges: []
    };
    const persisted = JSON.parse(JSON.stringify(draft));
    expect(graphDraftFingerprint(draft)).toBe(graphDraftFingerprint(persisted));
    persisted.nodes[0].data.label = 'Changed';
    expect(graphDraftFingerprint(draft)).not.toBe(
      graphDraftFingerprint(persisted)
    );
  });

  it.each(['network', 'server', 'bad-json', 'wrong-id'])(
    'holds the freeze on ambiguous %s POST and reuses the exact request',
    async (failure) => {
      const f = fixture();
      const original = f.request.getMockImplementation()!;
      const bodies: string[] = [];
      f.request.mockImplementation(async (url, options) => {
        if (options?.method === 'POST') {
          bodies.push(String(options.body));
          if (bodies.length === 1) {
            if (failure === 'network') throw new Error('offline');
            if (failure === 'server')
              return Response.json(
                { error: 'agent_start_unavailable' },
                { status: 503 }
              );
            if (failure === 'bad-json') return new Response('invalid');
            return Response.json({ runId: 'different' });
          }
        }
        return original(url, options);
      });
      await expect(f.coordinator.start(input)).rejects.toThrow(
        'Start not confirmed'
      );
      expect(f.coordinator.frozen('graph')).toBe(true);
      expect(f.coordinator.attempt('graph')?.phase).toBe('uncertain');
      expect(() => f.coordinator.beginManual('graph')).toThrow();
      await f.coordinator.retry('graph');
      expect(bodies[0]).toBe(bodies[1]);
      expect(f.draft.value).toEqual(graph);
    }
  );

  it('recovers a confirmed rejection without replacing the visible graph', async () => {
    const f = fixture();
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation((url, options) =>
      options?.method === 'POST'
        ? Promise.resolve(
            Response.json({ error: 'agent_snapshot_changed' }, { status: 409 })
          )
        : original(url, options)
    );
    await expect(f.coordinator.start(input)).rejects.toThrow('Start rejected');
    expect(f.coordinator.frozen('graph')).toBe(true);
    f.canonical.nodes = [];
    await f.coordinator.recoverRejected('graph');
    expect(f.canonical.nodes).toEqual(graph.nodes);
    expect(f.editor.adopt).toHaveBeenCalledWith(f.canonical);
    expect(f.coordinator.frozen('graph')).toBe(false);
  });

  it('preserves intentional deletions instead of resurrecting saved nodes', async () => {
    const f = fixture();
    f.draft.value = { nodes: [], edges: [] };
    await f.coordinator.start(input);
    expect(f.canonical.nodes).toEqual([]);
    expect(f.editor.adopt).not.toHaveBeenCalled();
    expect(f.posts).toHaveLength(1);
  });

  it('recovers a stale-epoch graph save without replacing local content', async () => {
    const f = fixture();
    f.canonical.writeState.version++;
    f.canonical.nodes = [];
    f.editor.flush = vi.fn(async () => {
      f.draft.ready = false;
      return false;
    });
    await f.coordinator.start(input);
    expect(f.canonical.nodes).toEqual(graph.nodes);
    expect(f.posts[0].expectedWriteVersion).toBe(3);
    expect(f.editor.adopt).not.toHaveBeenCalled();
  });

  it('does not start if persisting the visible graph fails or becomes locked', async () => {
    const f = fixture();
    const original = f.request.getMockImplementation()!;
    f.canonical.nodes = [];
    f.request.mockImplementation((url, options) =>
      options?.method === 'PUT'
        ? Promise.resolve(
            Response.json({ error: 'graph_agent_running' }, { status: 423 })
          )
        : original(url, options)
    );
    await expect(f.coordinator.start(input)).rejects.toThrow(
      'Save not confirmed'
    );
    expect(f.posts).toHaveLength(0);
    expect(f.draft.value).toEqual(graph);
    expect(f.editor.adopt).not.toHaveBeenCalled();
  });

  it.each([
    'agent_worker_disabled',
    'agent_worker_unavailable',
    'agent_worker_busy',
    'agent_provider_key_not_configured',
    'agent_configuration_unavailable',
    'agent_manual_jobs_active'
  ])(
    'makes explicit %s denials recoverable without losing drafts',
    async (code) => {
      const f = fixture();
      const original = f.request.getMockImplementation()!;
      f.request.mockImplementation((url, options) =>
        options?.method === 'POST'
          ? Promise.resolve(
              Response.json(
                { error: code },
                {
                  status:
                    code === 'agent_manual_jobs_active'
                      ? 409
                      : code === 'agent_worker_busy'
                        ? 429
                        : 503
                }
              )
            )
          : original(url, options)
      );
      await expect(f.coordinator.start(input)).rejects.toThrow(
        'Start rejected'
      );
      expect(f.coordinator.attempt('graph')?.phase).toBe('rejected');
      expect(f.draft.value).toEqual(graph);
      await f.coordinator.recoverRejected('graph');
      expect(f.editor.adopt).toHaveBeenCalled();
      expect(f.coordinator.frozen('graph')).toBe(false);
    }
  );

  it('also permits an exact same UUID retry after worker busy', async () => {
    const f = fixture();
    const original = f.request.getMockImplementation()!;
    let firstBody: string | undefined;
    f.request.mockImplementation(async (url, options) => {
      if (options?.method === 'POST' && !firstBody) {
        firstBody = String(options.body);
        return Response.json({ error: 'agent_worker_busy' }, { status: 429 });
      }
      return original(url, options);
    });
    await expect(f.coordinator.start(input)).rejects.toThrow('busy');
    await f.coordinator.retry('graph');
    expect(f.posts[0]).toEqual(JSON.parse(firstBody!));
  });

  it('does not treat a lost retry response as the earlier explicit denial', async () => {
    const f = fixture();
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation((url, options) =>
      options?.method === 'POST'
        ? Promise.resolve(
            Response.json({ error: 'agent_worker_busy' }, { status: 429 })
          )
        : original(url, options)
    );
    await expect(f.coordinator.start(input)).rejects.toThrow('busy');
    f.request.mockRejectedValueOnce(new Error('lost retry'));
    await expect(f.coordinator.retry('graph')).rejects.toThrow(
      'Start not confirmed'
    );
    expect(f.coordinator.attempt('graph')?.phase).toBe('uncertain');
    await expect(f.coordinator.recoverRejected('graph')).rejects.toThrow(
      'still to be confirmed'
    );
    expect(f.coordinator.frozen('graph')).toBe(true);
  });

  it('reloads only unchanged locally started editors after a terminal run', async () => {
    const f = fixture();
    const note = f.note();
    const runId = await f.coordinator.start(input);
    const late = f.note('second tab', true);
    note.draft.value = 'unexpected new draft';
    f.canonical.notes = 'agent result';
    f.canonical.writeState.version++;
    await f.coordinator.observe({
      id: runId,
      graphId: 'graph',
      status: 'completed'
    });
    expect(f.editor.adopt).toHaveBeenCalledWith(f.canonical);
    expect(note.editor.adopt).not.toHaveBeenCalled();
    expect(late.editor.adopt).not.toHaveBeenCalled();
    expect(late.editor.invalidate).toHaveBeenCalledOnce();
    expect(note.editor.invalidate).toHaveBeenCalledOnce();
    expect(late.draft.value).toBe('second tab');
    expect(f.coordinator.frozen('graph')).toBe(false);
  });

  it('shows agent writes live and still auto-reloads the previewed editor', async () => {
    const f = fixture();
    f.editor.invalidate = vi.fn();
    f.editor.preview = vi.fn((snapshot: CanonicalGraphSnapshot) => {
      f.draft.value = {
        nodes: (snapshot.nodes as Record<string, unknown>[]).map((node) => ({
          ...node,
          selected: false,
          width: 120
        })),
        edges: snapshot.edges
      };
    });
    await f.coordinator.preview('graph');
    expect(f.editor.preview).not.toHaveBeenCalled();
    const runId = await f.coordinator.start(input);
    f.canonical.writeState = { ...f.canonical.writeState, locked: true };
    f.canonical.nodes = [
      ...f.canonical.nodes,
      { id: 'b', position: { x: 5, y: 5 }, data: { label: 'agent' } }
    ];
    await f.coordinator.observe({
      id: runId,
      graphId: 'graph',
      status: 'running'
    });
    await Promise.all([
      f.coordinator.preview('graph'),
      f.coordinator.preview('graph')
    ]);
    expect(f.editor.preview).toHaveBeenCalledTimes(2);
    expect(f.coordinator.frozen('graph')).toBe(true);
    f.canonical.writeState = { version: 3, locked: false, expiresAt: null };
    await f.coordinator.observe({
      id: runId,
      graphId: 'graph',
      status: 'completed'
    });
    expect(f.editor.adopt).toHaveBeenCalledWith(f.canonical);
    expect(f.editor.invalidate).not.toHaveBeenCalled();
    expect(f.coordinator.frozen('graph')).toBe(false);
  });

  it('does not treat a locally diverged previewed editor as unchanged', async () => {
    const f = fixture();
    f.editor.invalidate = vi.fn();
    f.editor.preview = vi.fn();
    const runId = await f.coordinator.start(input);
    await f.coordinator.preview('graph');
    f.draft.value = { nodes: [], edges: [] };
    f.canonical.writeState = { version: 3, locked: false, expiresAt: null };
    await f.coordinator.observe({
      id: runId,
      graphId: 'graph',
      status: 'completed'
    });
    expect(f.editor.adopt).not.toHaveBeenCalled();
    expect(f.editor.invalidate).toHaveBeenCalledOnce();
  });

  it('does not unlock after a failed terminal reload, but retries it safely', async () => {
    const f = fixture();
    const runId = await f.coordinator.start(input);
    f.request.mockRejectedValueOnce(new Error('offline'));
    await f.coordinator.observe({
      id: runId,
      graphId: 'graph',
      status: 'failed'
    });
    expect(f.coordinator.frozen('graph')).toBe(true);
    await f.coordinator.observe({
      id: runId,
      graphId: 'graph',
      status: 'failed'
    });
    expect(f.coordinator.frozen('graph')).toBe(false);
  });

  it('never auto-reloads a historical or different run', async () => {
    const f = fixture();
    await f.coordinator.start(input);
    await f.coordinator.observe({
      id: 'historical',
      graphId: 'graph',
      status: 'completed'
    });
    expect(f.editor.adopt).not.toHaveBeenCalled();
    expect(f.coordinator.frozen('graph')).toBe(true);
  });

  it('includes metadata, exact positions, and edge properties in equality, excluding transient selection', () => {
    const baseline = graphDraftFingerprint(graph);
    expect(
      graphDraftFingerprint({
        ...graph,
        nodes: graph.nodes.map((node) => ({
          ...node,
          selected: true,
          width: 200
        }))
      })
    ).toBe(baseline);
    expect(
      graphDraftFingerprint({
        ...graph,
        nodes: graph.nodes.map((node) => ({
          ...node,
          position: { x: 2, y: 2 }
        }))
      })
    ).not.toBe(baseline);
    expect(
      graphDraftFingerprint({
        ...graph,
        nodes: graph.nodes.map((node) => ({
          ...node,
          data: { ...node.data, metadata: { source: 'changed' } }
        }))
      })
    ).not.toBe(baseline);
  });
});
