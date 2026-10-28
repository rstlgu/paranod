import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactFlow, {
  ReactFlowProvider,
  applyNodeChanges,
  type Node
} from 'reactflow';
import 'reactflow/dist/style.css';
import { OSINTNode } from '@/features/graph/components/osint-node';
import { GraphMutationContext } from '@/features/graph/contexts/graph-mutation-context';
import { GraphLayoutSettingsProvider } from '@/features/graph/contexts/graph-layout-settings-context';
import '@/app/globals.css';
import { AgentDock } from '@/features/agent/components/agent-dock';
import { useAgentPanelStore } from '@/features/agent/store/agent-panel-store';
import { registerAgentGraphReferences } from '@/features/agent/store/agent-graph-references';
import { useWorkspaceTabsStore } from '@/features/workspace/store/workspace-tabs-store';
import { useGraphWriteGuard } from '@/features/graph/components/graph-editor/hooks/use-graph-write-guard';
import { useGraphAutosave } from '@/features/graph/components/graph-editor/hooks/use-graph-autosave';
import { useGraphHistory } from '@/features/graph/components/graph-editor/hooks/use-graph-history';
import {
  TransformLoggerProvider,
  useTransformLogger
} from '@/features/graph/contexts/transform-logger-context';
import { useGraphParticipant } from '@/features/graph/components/graph-editor/hooks/use-graph-participant';
import {
  graphClientCoordinator,
  graphDraftFingerprint
} from '@/features/graph/lib/graph-client-coordinator';
import { CaseNoteWorkspaceEditor } from '@/features/cases/components/case-note-workspace-editor';
import type {
  AgentEvent,
  AgentHistoryExchange,
  AgentRunSummary
} from '@/features/agent/lib/contracts';
import './preview.css';

// Only this isolated fixture replaces fetch. It never imports a server module
// or contacts an app database, API provider, or authenticated installation.
const roundPositions = new URLSearchParams(location.search).has(
  'roundPositions'
);
const state = {
  nodes: [
    {
      id: 'seed',
      position: { x: roundPositions ? 141.12000805986722 : 0, y: 0 },
      data: { label: 'example.org', type: 'domain' }
    }
  ] as Node[],
  edges: [],
  notes: '<p>Original note</p>',
  version: 2,
  run: null as AgentRunSummary | null,
  events: [] as AgentEvent[],
  history: [] as AgentHistoryExchange[],
  previous: [] as Array<{
    run: AgentRunSummary;
    events: AgentEvent[];
    history: AgentHistoryExchange[];
  }>,
  requests: [] as Array<{ url: string; method: string; body: any }>,
  loseResponse: false,
  failSave: false,
  backups: [] as unknown[]
};
Object.assign(window, { agentStartFixture: state });
const writeState = () => ({
  version: state.version,
  locked: state.run?.status === 'running',
  expiresAt: null
});
const snapshot = () => ({
  graphId: 'fixture-graph',
  revision: 'a'.repeat(64),
  writeState: writeState(),
  nodes: state.nodes,
  edges: state.edges,
  notes: state.notes
});
const note = () => ({
  id: 'note',
  caseId: 'case',
  name: 'Linked note',
  graphId: 'fixture-graph',
  content: state.notes
});
const event = (data: AgentEvent['data']) =>
  state.events.push({
    sequence: state.events.length + 1,
    createdAt: new Date().toISOString(),
    data
  });
const finish = () => {
  if (!state.run) return;
  state.run = {
    ...state.run,
    status: 'completed',
    endedAt: new Date().toISOString()
  };
  state.version++;
  state.notes = '<p>Canonical note after synthetic run</p>';
  state.nodes = state.nodes.map((node) => ({
    ...node,
    data: { ...node.data, label: 'Canonical graph after synthetic run' }
  }));
  event({
    type: 'message',
    text: `Synthetic public reply: ${state.run.goal}`,
    sources: []
  });
  event({
    type: 'finished',
    status: 'completed',
    summary: 'Synthetic run completed'
  });
};
window.fetch = async (resource, options) => {
  const url = String(resource);
  const method = options?.method ?? 'GET';
  const body = options?.body ? JSON.parse(String(options.body)) : undefined;
  state.requests.push({ url, method, body });
  if (url.endsWith('/write-state'))
    return Response.json({ writeState: writeState() });
  if (url.endsWith('/snapshot')) return Response.json(snapshot());
  if (url.endsWith('/references')) return Response.json({ references: [] });
  if (url === '/api/agent/runs' && method === 'GET')
    return Response.json({
      available: true,
      reason: null,
      models: [
        {
          id: 'synthetic',
          name: 'Synthetic model',
          provider: 'openai',
          reasoningLevels: ['high'],
          defaultReasoning: 'high',
          available: true
        }
      ],
      runs: [
        ...(state.run ? [state.run] : []),
        ...state.previous.map((entry) => entry.run).reverse()
      ]
    });
  if (url === '/api/agent/runs' && method === 'POST') {
    const existing =
      state.run?.id === body.runId
        ? state.run
        : state.previous.find((entry) => entry.run.id === body.runId)?.run;
    if (existing) return Response.json({ runId: existing.id });
    const parent = body.parentRunId
      ? state.run?.id === body.parentRunId
        ? state
        : state.previous.find((entry) => entry.run.id === body.parentRunId)
      : null;
    if (
      body.parentRunId &&
      (!parent ||
        parent.run?.status === 'running' ||
        parent.run?.graphId !== body.graphId)
    )
      return Response.json({ error: 'invalid_agent_start' }, { status: 400 });
    const history = parent?.run
      ? [
          ...parent.history,
          {
            runId: parent.run.id,
            goal: parent.run.goal,
            messages: parent.events.flatMap((entry) =>
              entry.data.type === 'message' ? [entry.data.text] : []
            )
          }
        ].slice(-6)
      : [];
    if (state.run)
      state.previous.push({
        run: state.run,
        events: state.events,
        history: state.history
      });
    state.history = history;
    state.events = [];
    state.run = {
      id: body.runId,
      parentRunId: body.parentRunId ?? null,
      graphId: body.graphId,
      graphName: 'Synthetic graph',
      goal: body.goal,
      model: body.model,
      reasoning: body.reasoning,
      approvalMode: body.approvalMode ?? 'guarded',
      status: 'running',
      createdAt: new Date().toISOString(),
      endedAt: null
    };
    state.version++;
    event({
      type: 'phase',
      phase: 'planning',
      summary: 'Synthetic persisted activity'
    });
    event({
      type: 'approval',
      approvalId: 'approval',
      tool: 'Synthetic tool',
      summary: 'Synthetic approval only',
      destination: 'example.org',
      argumentsHash: 'b'.repeat(64)
    });
    if (state.loseResponse) {
      state.loseResponse = false;
      throw new TypeError('Synthetic lost response');
    }
    return Response.json({ runId: state.run.id });
  }
  if (url.includes('/api/agent/runs/')) {
    const requestedId = new URL(url, location.origin).pathname.split('/')[4];
    const selected =
      state.run?.id === requestedId
        ? state
        : state.previous.find((entry) => entry.run.id === requestedId);
    if (!selected?.run) return Response.json({}, { status: 404 });
    if (method === 'DELETE') {
      finish();
      return Response.json({ ok: true });
    }
    if (method === 'POST') {
      if (url.endsWith('/context')) {
        if (selected.run.status === 'running')
          return Response.json({}, { status: 423 });
        await new Promise((resolve) => setTimeout(resolve, 200));
        selected.run = {
          ...selected.run,
          inputTokens: 1200,
          outputTokens: 300,
          contextUsage: {
            tokens: body.action === 'clear' ? 0 : 900,
            limit: 24000,
            estimated: true,
            compactions: body.action === 'clear' ? 0 : 1,
            state: body.action === 'clear' ? 'cleared' : 'ready'
          }
        };
        return Response.json({ run: selected.run });
      }
      event({
        type: 'decision',
        approvalId: body.approvalId,
        approved: body.approved
      });
      return Response.json({ ok: true });
    }
    const cursor = Number(
      new URL(url, location.origin).searchParams.get('after') ?? 0
    );
    return Response.json({
      run: selected.run,
      events: selected.events.filter((item) => item.sequence > cursor),
      ...(cursor === 0 ? { history: selected.history } : {}),
      hasMore: false
    });
  }
  if (url === '/api/graphs/fixture-graph' && method === 'PUT') {
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (state.failSave) return Response.json({}, { status: 500 });
    state.nodes = roundPositions
      ? body.nodes.map((node: Node) => ({
          ...node,
          position: {
            x: Number(node.position.x.toPrecision(16)),
            y: Number(node.position.y.toPrecision(16))
          }
        }))
      : body.nodes;
    state.edges = body.edges;
    return Response.json({ ok: true });
  }
  if (url === '/api/cases/case/notes/note') {
    if (method === 'PATCH') {
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (state.failSave) return Response.json({}, { status: 500 });
      state.notes = body.content;
    }
    return Response.json({ note: note(), writeState: writeState() });
  }
  throw new Error(`Unmocked request blocked: ${method} ${url}`);
};

useWorkspaceTabsStore.setState({
  tabs: [
    {
      id: 'graph:fixture-graph',
      kind: 'graph',
      resourceId: 'fixture-graph',
      title: 'Synthetic graph'
    }
  ],
  activeTabId: 'graph:fixture-graph',
  hasHydrated: true
});
useAgentPanelStore.setState({ open: true });

const nodeTypes = { osint: OSINTNode };
function GraphHarness() {
  const guard = useGraphWriteGuard('fixture-graph');
  const [nodes, setNodes] = useState(state.nodes);
  useEffect(
    () =>
      registerAgentGraphReferences('fixture-graph', {
        nodes,
        onSelectNode: (id) =>
          setNodes((items) =>
            items.map((node) => ({ ...node, selected: node.id === id }))
          )
      }),
    [nodes]
  );
  const [loaded, setLoaded] = useState(false);
  const version = useRef<number | undefined>(2);
  const loading = useRef(false);
  const saves = useGraphAutosave({
    graphId: 'fixture-graph',
    mounted: loaded,
    nodes: nodes as any,
    edges: [],
    isLoadingFromStorageRef: loading,
    writeVersionRef: version,
    saveStatus: null,
    createStateHash: (nodes, edges) => graphDraftFingerprint({ nodes, edges }),
    canEditSnapshot: guard.canEditSnapshot,
    canSaveSnapshot: guard.canSaveSnapshot,
    debounceMs: 250
  });
  const history = useGraphHistory({
    mounted: loaded,
    nodes: nodes as any,
    edges: state.edges,
    setNodes,
    setEdges: () => {}
  });
  useEffect(() => {
    guard.acceptSnapshot('fixture-graph', writeState());
    history.resetHistory({ nodes: state.nodes as any, edges: [] });
    setLoaded(true);
  }, [guard.acceptSnapshot]);
  useGraphParticipant('fixture-graph', {
    kind: 'graph',
    capture: () => ({
      ready: loaded && guard.canSaveSnapshot(),
      version: version.current,
      value: { nodes, edges: [] },
      dirty: saves.isDirty()
    }),
    idle: saves.idle,
    flush: (draft) => saves.flush(true, draft?.value as any),
    adopt: (canonical) => {
      state.backups.push(nodes);
      history.commitHistory({ nodes: nodes as any, edges: [] });
      setNodes(canonical.nodes as Node[]);
      history.commitHistory({ nodes: canonical.nodes as any, edges: [] });
      version.current = canonical.writeState.version;
      saves.markSavedState(canonical.nodes as any, []);
      guard.acceptSnapshot('fixture-graph', canonical.writeState);
    },
    preview: (canonical) => {
      history.commitHistory({ nodes: nodes as any, edges: [] });
      setNodes(canonical.nodes as Node[]);
      history.commitHistory({ nodes: canonical.nodes as any, edges: [] });
      saves.markSavedState(canonical.nodes as any, []);
    }
  });
  return (
    <div className='graph-harness'>
      <button
        onClick={history.undo}
        disabled={guard.blocked || !history.canUndo}
      >
        Undo graph
      </button>
      <button
        onClick={history.redo}
        disabled={guard.blocked || !history.canRedo}
      >
        Redo graph
      </button>
      <output aria-label='Node count'>{nodes.length}</output>
      <label>
        Graph label
        <input
          aria-label='Graph label'
          disabled={guard.blocked}
          value={nodes[0]?.data.label ?? ''}
          onChange={(e) => {
            if (guard.canEditSnapshot())
              setNodes([
                {
                  ...nodes[0],
                  data: { ...nodes[0].data, label: e.target.value }
                }
              ]);
          }}
        />
      </label>
      <output aria-label='Graph state'>{guard.status}</output>
      <output aria-label='Local start state'>
        {graphClientCoordinator.attempt('fixture-graph')?.phase ?? 'idle'}
      </output>
      <GraphMutationContext.Provider value={guard.canEditSnapshot}>
        <GraphLayoutSettingsProvider
          value={{
            graphViewMode: 'free',
            lockedAxis: 'vertical',
            spacingPreset: 'normal'
          }}
        >
          <ReactFlowProvider>
            <div
              style={{ width: 450, height: 260 }}
              aria-label='Deletion test graph'
            >
              <ReactFlow
                nodes={nodes.map((node) => ({
                  ...node,
                  type: 'osint',
                  selected: true
                }))}
                nodeTypes={nodeTypes}
                defaultViewport={{
                  x: 25,
                  y: 25,
                  zoom: roundPositions ? 0.85 : 1
                }}
                deleteKeyCode={guard.blocked ? null : 'Backspace'}
                nodesDraggable={!guard.blocked}
                onNodesChange={(changes) =>
                  setNodes((current) =>
                    applyNodeChanges(
                      guard.canEditSnapshot()
                        ? changes
                        : changes.filter(
                            (change) =>
                              change.type === 'dimensions' ||
                              change.type === 'select'
                          ),
                      current
                    )
                  )
                }
              />
            </div>
          </ReactFlowProvider>
        </GraphLayoutSettingsProvider>
      </GraphMutationContext.Provider>
    </div>
  );
}
function ConsoleHarness() {
  const { consoleEntries, logs, clearConsole } = useTransformLogger();
  return (
    <section aria-label='Transform console'>
      <button onClick={clearConsole}>Clear transform console</button>
      <output aria-label='Transform logs'>
        {logs.map((log) => `${log.transformName}: ${log.status}`).join(' | ')}
      </output>
      {consoleEntries.map((entry) => (
        <p key={entry.id}>{entry.message}</p>
      ))}
    </section>
  );
}
function Preview() {
  const [activeGraph, setActiveGraph] = useState('fixture-graph');
  return (
    <>
      <header className='fixture-toolbar'>
        <strong>Synthetic start-flow verification</strong>
        <button
          id='agent-panel-toggle'
          onClick={() => useAgentPanelStore.getState().setOpen(true)}
        >
          Open agent
        </button>
        <button onClick={finish}>Termina run sintetica</button>
        <label>
          Active graph
          <select
            aria-label='Active graph'
            value={activeGraph}
            onChange={(event) => {
              const id = event.target.value;
              setActiveGraph(id);
              useWorkspaceTabsStore.setState({
                tabs: [
                  {
                    id: `graph:${id}`,
                    kind: 'graph',
                    resourceId: id,
                    title:
                      id === 'fixture-graph' ? 'Synthetic graph' : 'Other graph'
                  }
                ],
                activeTabId: `graph:${id}`
              });
            }}
          >
            <option value='fixture-graph'>Synthetic graph</option>
            <option value='other-graph'>Other unloaded graph</option>
          </select>
        </label>
        <label>
          <input
            type='checkbox'
            onChange={(e) => {
              state.loseResponse = e.target.checked;
            }}
          />
          Perdi risposta avvio
        </label>
        <label>
          <input
            type='checkbox'
            onChange={(e) => {
              state.failSave = e.target.checked;
            }}
          />
          Errore salvataggio
        </label>
      </header>
      <div className='fixture-workspace'>
        <AgentDock>
          <TransformLoggerProvider graphId='fixture-graph'>
            <GraphHarness />
            <ConsoleHarness />
            <div className='note-harness'>
              <CaseNoteWorkspaceEditor
                resourceId='case/note'
                onOpenGraph={() => {}}
              />
            </div>
          </TransformLoggerProvider>
        </AgentDock>
      </div>
    </>
  );
}
createRoot(document.getElementById('root')!, {
  onUncaughtError: (error) => {
    document.body.textContent =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
  }
}).render(<Preview />);
