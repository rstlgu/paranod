import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactFlow, { Background, Controls, type Node } from 'reactflow';
import 'reactflow/dist/style.css';
import '@/app/globals.css';
import { AgentPanelView } from '@/features/agent/components/agent-panel-view';
import { AgentMarkdown, AgentMentionProvider } from '@/features/agent/components/agent-markdown';
import agentStyles from '@/features/agent/components/agent-panel.module.css';
import type {
  AgentApprovalMode,
  AgentEvent,
  AgentRunSummary
} from '@/features/agent/lib/contracts';
import type { AgentModelSelection } from '@/features/agent/components/agent-model-picker';
import './preview.css';

// Isolated visual fixture. This entry is never imported by the application.
function previewModel(
  id: string,
  name: string,
  provider:
    | 'openai'
    | 'anthropic'
    | 'google'
    | 'xai'
    | 'deepseek'
    | 'moonshot'
    | 'openrouter',
  available: boolean
) {
  return {
    id,
    name,
    provider,
    reasoningLevels: ['low', 'medium', 'high'],
    defaultReasoning: 'high',
    available
  };
}
const previewModels = [
  previewModel('gpt-6-astra', 'GPT-6 Astra', 'openai', true),
  previewModel('gpt-6.1-sol', 'GPT-6.1 Sol', 'openai', true),
  previewModel('gpt-6-sol', 'GPT-6 Sol', 'openai', true),
  previewModel('gpt-6-luna', 'GPT-6 Luna', 'openai', true),
  previewModel('gpt-5.6-terra', 'GPT-5.6 Terra', 'openai', true),
  previewModel('gpt-5.5', 'GPT-5.5', 'openai', true),
  previewModel('claude-sonnet-5-5', 'Claude Sonnet 5.5', 'anthropic', true),
  previewModel('claude-opus-5-5', 'Claude Opus 5.5', 'anthropic', true),
  previewModel('claude-opus-5', 'Claude Opus 5', 'anthropic', true),
  previewModel('gemini-3.8-flash', 'Gemini 3.8 Flash', 'google', true),
  previewModel('grok-4.7', 'Grok 4.7', 'xai', true),
  previewModel('deepseek-flash', 'DeepSeek Flash', 'deepseek', true),
  previewModel('kimi-k2.6', 'Kimi K2.6', 'moonshot', true),
  previewModel('openrouter/demo', 'OpenRouter demo', 'openrouter', true)
];
const initialRun: AgentRunSummary = {
  id: 'fixture',
  graphId: 'fixture-graph',
  graphName: 'Infrastruttura example.org',
  goal: 'Analyze the domain example.org and map the verified relationships on the graph, citing sources.',
  model: 'Modello di test',
  reasoning: 'high',
  approvalMode: 'guarded',
  status: 'running',
  createdAt: new Date(Date.now() - 42000).toISOString(),
  endedAt: null
};
const event = (sequence: number, data: AgentEvent['data']): AgentEvent => ({
  sequence,
  data,
  createdAt: new Date().toISOString()
});
const baseEvents: AgentEvent[] = [
  event(1, {
    type: 'phase',
    phase: 'planning',
    summary:
      'Controllo i moduli disponibili e organizzo la raccolta delle fonti pubbliche. Nessuna modifica distruttiva.'
  }),
  event(2, {
    type: 'tool',
    callId: 'dns',
    name: 'DNS Lookup',
    target: 'example.org',
    status: 'completed',
    summary: 'Record DNS ricevuti. Dati sintetici della verifica grafica.',
    durationMs: 1250,
    sources: [{ title: 'Dominio di esempio', url: 'https://example.org' }]
  }),
  event(3, {
    type: 'phase',
    phase: 'researching',
    summary: 'Comparing sources before adding relationships to the graph.'
  }),
  event(4, {
    type: 'tool',
    callId: 'rdap',
    name: 'RDAP Lookup',
    target: 'example.org',
    status: 'running',
    summary: '',
    sources: []
  })
];
const approval = event(5, {
  type: 'approval',
  approvalId: 'approval',
  tool: 'Addon di test',
  summary:
    'La richiesta invia il dominio a un servizio esterno e utilizza una chiamata a pagamento.',
  destination: 'example.org',
  argumentsHash: 'a'.repeat(64)
});
const liveEvents: AgentEvent[] = [
  event(1, {
    type: 'phase',
    phase: 'planning',
    summary: 'Preparing the investigation.'
  }),
  event(2, { type: 'message', text: 'Risoluzione A completata per **example.org**; verifico moduli sugli IP emersi.', sources: [] }),
  event(3, {
    type: 'tool',
    callId: 'live-dns',
    name: 'run_transform',
    target: 'dns-lookup/dns-resolve-a',
    status: 'running',
    summary: '',
    sources: []
  }),
  event(4, {
    type: 'graph_changes',
    nodesAdded: 3,
    edgesAdded: 3,
    summary: 'Saved'
  }),
  event(5, {
    type: 'tool',
    callId: 'live-dns',
    name: 'run_transform',
    target: 'dns-lookup/dns-resolve-a',
    status: 'completed',
    summary: 'Done',
    sources: []
  }),
  event(6, { type: 'phase', phase: 'thinking', summary: 'Thinking.' }),
  event(7, {
    type: 'message',
    text: 'Final report: 3 nodes and 3 links saved.',
    sources: []
  })
];
const nodes: Node[] = [
  {
    id: 'domain',
    position: { x: 100, y: 170 },
    data: { label: 'example.org', type: 'domain' },
    style: { borderColor: '#26977c', borderRadius: 5, padding: 16 }
  },
  {
    id: 'ip',
    position: { x: 350, y: 60 },
    data: { label: '192.0.2.1', type: 'ip' },
    style: { borderColor: '#b88234', borderRadius: 5, padding: 16 }
  },
  {
    id: 'org',
    position: { x: 360, y: 290 },
    data: { label: 'Example Organization', type: 'company' },
    style: { borderColor: '#528eb1', borderRadius: 5, padding: 16 }
  }
];

function Preview() {
  const [mode, setMode] = useState('running');
  const [run, setRun] = useState<AgentRunSummary | null>(initialRun);
  const [events, setEvents] = useState(baseEvents);
  const [draft, setDraft] = useState('');
  const [approvalMode, setApprovalMode] =
    useState<AgentApprovalMode>('guarded');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [closed, setClosed] = useState(false);
  const [modelSelection, setModelSelection] = useState<AgentModelSelection>({
    model: 'claude-sonnet-5-5',
    reasoning: 'high'
  });
  const active = run?.status === 'running';
  function scenario(next: string) {
    setMode(next);
    setClosed(false);
    setNotice('');
    setError(
      next === 'error' ? 'Connessione interrotta. Aggiornamenti sospesi.' : null
    );
    setRun(
      next === 'empty'
        ? null
        : {
            ...initialRun,
            status:
              next === 'completed'
                ? 'completed'
                : next === 'failed'
                  ? 'failed'
                  : 'running',
            endedAt: ['completed', 'failed'].includes(next)
              ? new Date().toISOString()
              : null
          }
    );
    setEvents(
      next === 'live'
        ? liveEvents.slice(0, 1)
        : next === 'failed'
          ? [
              ...baseEvents,
              event(5, {
                type: 'tool',
                callId: 'headers',
                name: 'run_transform',
                target: 'url-parser/url-http-headers',
                status: 'failed',
                summary:
                  'The transform could not retrieve or process its target.',
                sources: []
              }),
              event(6, {
                type: 'tool',
                callId: 'rdap',
                name: 'run_transform',
                target: 'whois-lookup/whois-lookup',
                status: 'completed',
                summary: 'Done.',
                sources: []
              }),
              event(7, {
                type: 'graph_changes',
                nodesAdded: 10,
                edgesAdded: 10,
                summary: 'Saved results.'
              }),
              event(8, {
                type: 'phase',
                phase: 'thinking',
                summary: 'Preparing next operation.'
              }),
              event(9, {
                type: 'finished',
                status: 'failed',
                summary:
                  'The investigation reached its token budget before producing a final answer.',
                reasonCode: 'token_limit'
              })
            ]
          : next === 'approval'
            ? [...baseEvents, approval]
            : next === 'completed'
              ? [
                  ...baseEvents,
                  event(8, {
                    type: 'message',
                    text: 'Procedo con la risoluzione DNS A per `example.org`.',
                    sources: []
                  }),
                  { ...approval, sequence: 9 },
                  event(10, {
                    type: 'decision',
                    approvalId: 'approval',
                    approved: true
                  }),
                  event(5, {
                    type: 'tool',
                    callId: 'rdap',
                    name: 'RDAP Lookup',
                    target: 'example.org',
                    status: 'completed',
                    summary: 'Verifica terminata.',
                    sources: []
                  }),
                  event(6, {
                    type: 'graph_changes',
                    nodesAdded: 3,
                    edgesAdded: 2,
                    summary: 'Relazioni associate alle fonti.'
                  }),
                  event(7, {
                    type: 'message',
                    text: '## Risultato\nHo organizzato **3 entita** e **2 relazioni**.\n\n- Dominio: **example.org**\n- Indirizzo IP: `192.0.2.1`\n- Organizzazione: Example Organization\n\nQuesti sono dati sintetici, non il risultato di una vera indagine.\n\n![Immagine da non caricare](https://example.org/tracking-pixel.png)',
                    sources: [
                      {
                        title: 'Dominio di esempio',
                        url: 'https://example.org'
                      }
                    ]
                  })
                ]
              : baseEvents
    );
  }
  return (
    <div className='preview'>
      <header className='preview-toolbar'>
        <strong>PARANOD</strong>
        <span>Anteprima con dati sintetici</span>
        <select
          aria-label='Scenario di verifica'
          value={mode}
          onChange={(e) => scenario(e.target.value)}
        >
          <option value='running'>In corso</option>
          <option value='live'>Log in tempo reale</option>
          <option value='approval'>Approval requested</option>
          <option value='completed'>Completato</option>
          <option value='failed'>Fallito con risultati parziali</option>
          <option value='error'>Connessione persa</option>
          <option value='empty'>Non configurato</option>
        </select>
        {mode === 'live' ? (
          <button
            disabled={events.length >= liveEvents.length}
            onClick={() => {
              const length = Math.min(events.length + 1, liveEvents.length);
              setEvents(liveEvents.slice(0, length));
              if (length === liveEvents.length)
                setRun({
                  ...initialRun,
                  status: 'completed',
                  endedAt: new Date().toISOString()
                });
            }}
          >
            Next activity
          </button>
        ) : null}
        <label>
          <input
            type='checkbox'
            onChange={(e) =>
              document.documentElement.classList.toggle(
                'dark',
                e.target.checked
              )
            }
          />
          Scuro
        </label>
      </header>
      <div className='preview-workspace'>
        <main className='preview-graph'>
          <div className='preview-canvas' inert={active || undefined}>
            <ReactFlow
              nodes={nodes}
              edges={[
                { id: 'dns', source: 'domain', target: 'ip', label: 'DNS' },
                { id: 'rdap', source: 'domain', target: 'org', label: 'RDAP' }
              ]}
              fitView
              nodesDraggable={!active}
              nodesConnectable={false}
              deleteKeyCode={null}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        </main>
        <aside className='preview-agent'>
          {closed ? (
            <button onClick={() => setClosed(false)}>Reopen agent</button>
          ) : (
            <AgentPanelView
              catalog={{
                available: mode !== 'empty',
                reason:
                  mode === 'empty' ? 'agent_runtime_not_configured' : null,
                models: mode === 'empty' ? [] : previewModels,
                runs: [initialRun]
              }}
              run={run}
              events={run ? events : []}
              selectedRunId={run?.id ?? null}
              context={{ id: 'fixture-graph', name: initialRun.graphName }}
              graphReferences={{ nodes, onSelectNode: (id) => setNotice(`Selected graph node: ${id}`) }}
              loading={false}
              error={error}
              busy={false}
              draft={draft}
              approvalMode={approvalMode}
              onApprovalMode={setApprovalMode}
              modelSelection={modelSelection}
              onModelSelection={setModelSelection}
              onDraft={setDraft}
              onClose={() => setClosed(true)}
              onSelectRun={(id) =>
                id ? scenario('running') : scenario('empty')
              }
              onArchiveThread={() => {}}
              onStop={() => {
                setRun((value) =>
                  value
                    ? {
                        ...value,
                        status: 'cancelled',
                        endedAt: new Date().toISOString()
                      }
                    : null
                );
                setNotice('Interrompi ricevuto');
              }}
              onDecision={(approvalId, approved) => {
                setEvents((values) => [
                  ...values,
                  event(values.length + 1, {
                    type: 'decision',
                    approvalId,
                    approved
                  })
                ]);
                setNotice(
                  approved ? 'Approvazione ricevuta' : 'Rifiuto ricevuto'
                );
              }}
              onSubmit={() =>
                setNotice('Invio ricevuto nella verifica, nessuna chiamata AI')
              }
              onRetry={() => {
                setError(null);
                setNotice('Riprova ricevuto');
              }}
            />
          )}
        </aside>
      </div>
      <output className='preview-notice'>
        {notice ||
          'Verifica interfaccia: nessun provider AI, nessuna indagine reale.'}
      </output>
    </div>
  );
}
function BrandPreview() {
  const [selected, setSelected] = useState('');
  const [blue, setBlue] = useState(false);
  const brandedNodes: Node[] = ['bumble.com', 'https://bumble.com/about'].map((label, index) => ({
    id: `brand-${index}`,
    position: { x: 0, y: 0 },
    data: { label, type: index ? 'url' : 'domain', metadata: { customColor: blue ? '#3366cc' : '#ffc629', headerTextColor: blue ? '#3366cc' : '#896400', autoColorFromLogo: true } }
  }));
  return <main style={{ padding: 32, maxWidth: 600 }}>
    <button onClick={() => setBlue((value) => !value)}>Change node color</button>
    <AgentMentionProvider value={{ nodes: brandedNodes, onSelectNode: setSelected }}>
      <article className={agentStyles.message}>
        <AgentMarkdown text='Dominio: bumble.com. URL: https://bumble.com/about' />
      </article>
    </AgentMentionProvider>
    <output>{selected}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(location.search === '?brand' ? <BrandPreview /> : <Preview />);
