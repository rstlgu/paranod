import type { Edge, Node } from 'reactflow';
import type { AgentEvent, AgentRunSummary } from '@/features/agent/lib/contracts';

export const GRAPH_ID = 'fixture-read-only-graph';
export const GRAPH_NAME = 'Read-only QA graph';

function initialNodes(): Node[] {
  return [
    { id: 'person', type: 'osint', position: { x: 40, y: 70 }, data: { type: 'person', label: 'Alex Sample', metadata: { description: 'Synthetic person for details inspection.' } } },
    { id: 'company', type: 'osint', position: { x: 360, y: 70 }, data: { type: 'company', label: 'Synthetic Labs', metadata: { description: 'Synthetic organization, no external account.' } } },
    { id: 'location-a', type: 'osint', position: { x: 40, y: 260 }, data: { type: 'location', label: '45.4642, 9.1900' } },
    { id: 'location-b', type: 'osint', position: { x: 360, y: 260 }, data: { type: 'location', label: '45.4842, 9.2100' } }
  ];
}

function initialEdges(): Edge[] {
  return [
    { id: 'works-at', type: 'osint', source: 'person', target: 'company', sourceHandle: 'right', targetHandle: 'left', data: { relationship: 'works at', label: 'works at' } },
    { id: 'based-in', type: 'osint', source: 'person', target: 'location-a', sourceHandle: 'bottom', targetHandle: 'top', data: { relationship: 'based in' } },
    { id: 'office', type: 'osint', source: 'company', target: 'location-b', sourceHandle: 'bottom', targetHandle: 'top', data: { relationship: 'office' } }
  ];
}

export interface FixtureRequest {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  status: number;
  locked: boolean;
}

export function createFixtureServer(origin = 'http://127.0.0.1:4183') {
  const listeners = new Set<() => void>();
  let revision = 0;
  let contentRevision = 1;
  const state = {
    nodes: initialNodes(),
    edges: initialEdges(),
    notes: '<p>Synthetic investigation notes. No live data or services.</p>',
    version: 1,
    locked: false,
    run: null as AgentRunSummary | null,
    events: [] as AgentEvent[],
    requests: [] as FixtureRequest[],
    acceptedWrites: 0,
    rejectedWrites: 0,
    unexpectedRequests: 0
  };
  const emit = () => {
    revision++;
    listeners.forEach((listener) => listener());
  };
  const writeState = () => ({ version: state.version, locked: state.locked, expiresAt: null });
  const snapshot = () => structuredClone({
    graphId: GRAPH_ID,
    revision: contentRevision.toString(16).padStart(64, '0'),
    writeState: writeState(),
    nodes: state.nodes,
    edges: state.edges,
    notes: state.notes
  });
  const graph = () => ({
    id: GRAPH_ID, name: GRAPH_NAME, description: 'Synthetic browser QA',
    nodes: state.nodes, edges: state.edges, notes: state.notes,
    nodeCount: state.nodes.length, activeCase: null, writeState: writeState()
  });
  const event = (data: AgentEvent['data']) => state.events.push({
    sequence: state.events.length + 1, createdAt: new Date().toISOString(), data
  });
  const rejectWrite = (body: Record<string, unknown> | null) => {
    if (state.locked) return { status: 423, error: 'graph_agent_running' };
    if (typeof body?.expectedWriteVersion !== 'number') return { status: 428, error: 'invalid_graph_write_version' };
    if (body.expectedWriteVersion !== state.version) return { status: 409, error: 'graph_changed' };
    return null;
  };

  const request: typeof fetch = async (resource, options) => {
    const input = resource instanceof Request ? resource : null;
    const url = new URL(input?.url ?? String(resource), origin);
    const method = (options?.method ?? input?.method ?? 'GET').toUpperCase();
    const raw = options?.body ?? (input && method !== 'GET' && method !== 'HEAD' ? await input.clone().text() : null);
    let body: Record<string, unknown> | null = null;
    try { body = raw ? JSON.parse(String(raw)) : null; } catch { /* Non-JSON writes are rejected below. */ }
    const entry: FixtureRequest = { method, path: url.pathname, body, status: 0, locked: state.locked };
    state.requests.push(entry);
    const reply = (value: unknown, status = 200) => {
      entry.status = status;
      emit();
      return Response.json(value, { status });
    };
    const denied = (status: number, error: string) => {
      state.rejectedWrites++;
      return reply({ error }, status);
    };
    if (url.origin !== origin) {
      state.unexpectedRequests++;
      return reply({ error: 'fixture_external_request_blocked' }, 403);
    }
    const path = url.pathname;
    if (method === 'GET') {
      if (path === '/api/auth/get-session') return reply({
        session: { id: 'fixture-session', userId: 'fixture-user', token: 'synthetic-only', expiresAt: '2099-01-01T00:00:00.000Z' },
        user: { id: 'fixture-user', name: 'Fixture QA', email: 'qa@example.test', emailVerified: true, role: 'admin', image: null }
      });
      if (path === '/api/plugins') return reply({ builtin: [], community: [], custom: [], addons: [], isAdmin: false });
      if (path === '/api/plugins/config') return reply({ success: true, data: {} });
      if (path === '/api/flows') return reply({ flows: [] });
      if (path === '/api/cases') return reply({ cases: [] });
      if (path === '/api/graphs') return reply({ graphs: [graph()] });
      if (path === `/api/graphs/${GRAPH_ID}`) return reply({ graph: graph() });
      if (path === `/api/graphs/${GRAPH_ID}/write-state`) return reply({ writeState: writeState() });
      if (path === `/api/graphs/${GRAPH_ID}/notes`) return reply({ content: state.notes, caseNote: null, writeState: writeState() });
      if (path === `/api/agent/graphs/${GRAPH_ID}/snapshot`) return reply(snapshot());
      if (path === `/api/agent/graphs/${GRAPH_ID}/references`) return reply({ references: [] });
      if (path === '/api/agent/runs') return reply({ available: true, reason: null, models: [], runs: state.run ? [state.run] : [] });
      if (state.run && path === `/api/agent/runs/${state.run.id}`) {
        const after = Number(url.searchParams.get('after') ?? 0);
        return reply({ run: state.run, events: state.events.filter((item) => item.sequence > after), history: [], hasMore: false });
      }
    }
    if (method === 'POST' && path === '/api/agent/runs') {
      const rejection = rejectWrite(body);
      if (rejection) return denied(rejection.status, rejection.error);
      if (body?.graphId !== GRAPH_ID || body.expectedRevision !== snapshot().revision || typeof body.runId !== 'string')
        return denied(409, 'agent_snapshot_changed');
      state.locked = true;
      state.version++;
      state.events = [];
      state.run = {
        id: body.runId, graphId: GRAPH_ID, graphName: GRAPH_NAME,
        goal: 'Synthetic graph lock QA', model: 'fixture-no-provider', reasoning: 'low',
        approvalMode: 'guarded', status: 'running', createdAt: new Date().toISOString(), endedAt: null
      };
      event({ type: 'tool', callId: 'fixture-transform', name: 'run_transform', target: 'fixture/inspect', status: 'running', summary: 'Synthetic inspection started', sources: [] });
      return reply({ runId: state.run.id });
    }
    if (path === `/api/graphs/${GRAPH_ID}` && method === 'PUT') {
      const rejection = rejectWrite(body);
      if (rejection) return denied(rejection.status, rejection.error);
      if (!Array.isArray(body?.nodes) || !Array.isArray(body?.edges)) return denied(400, 'fixture_snapshot_required');
      state.nodes = structuredClone(body.nodes as Node[]);
      state.edges = structuredClone(body.edges as Edge[]);
      state.acceptedWrites++;
      contentRevision++;
      return reply({ ok: true, graph: graph(), writeState: writeState() });
    }
    if (path === `/api/graphs/${GRAPH_ID}/notes` && ['PATCH', 'POST'].includes(method)) {
      const rejection = rejectWrite(body);
      if (rejection) return denied(rejection.status, rejection.error);
      if (typeof body?.content !== 'string') return denied(400, 'fixture_content_required');
      state.notes = body.content;
      state.acceptedWrites++;
      contentRevision++;
      return reply({ content: state.notes, caseNote: null, writeState: writeState() });
    }
    state.unexpectedRequests++;
    if (!['GET', 'HEAD'].includes(method)) return denied(403, 'fixture_unhandled_write_blocked');
    return reply({ error: 'fixture_unhandled_request_blocked', path, method }, 501);
  };

  return {
    state, request, snapshot, writeState,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getRevision: () => revision,
    complete() {
      if (!state.run || !state.locked) return;
      state.locked = false;
      state.version++;
      contentRevision++;
      const id = `canonical-${state.version}`;
      state.nodes = state.nodes.map((node) => node.id === 'person'
        ? { ...node, data: { ...node.data, label: `Alex Sample (canonical ${state.version})` } }
        : node);
      state.nodes.push({ id, type: 'osint', position: { x: 680, y: 70 }, data: { type: 'person', label: `Canonical result ${state.version}` } });
      state.edges.push({ id: `edge-${id}`, type: 'osint', source: 'company', target: id, sourceHandle: 'right', targetHandle: 'left', data: { relationship: 'synthetic result' } });
      state.notes = `<p>Canonical notes after synthetic completion ${state.version}.</p>`;
      state.run = { ...state.run, status: 'completed', endedAt: new Date().toISOString() };
      event({ type: 'tool', callId: 'fixture-transform', name: 'run_transform', target: 'fixture/inspect', status: 'completed', summary: 'Synthetic inspection completed', durationMs: 1000, sources: [] });
      event({ type: 'finished', status: 'completed', summary: 'Canonical synthetic graph adopted' });
      emit();
    }
  };
}
