import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AgentPanelView,
  exchangesToShow,
  pinTranscript
} from './agent-panel-view';
import type { AgentRunSummary } from '../lib/contracts';

const run: AgentRunSummary = {
  id: 'child',
  parentRunId: 'parent',
  graphId: 'graph',
  graphName: 'Graph',
  goal: 'Current question',
  model: 'test',
  reasoning: 'high',
  approvalMode: 'guarded',
  status: 'completed',
  createdAt: new Date(0).toISOString(),
  endedAt: new Date(1).toISOString()
};
const noop = () => {};
describe('conversation transcript', () => {
  it('places elapsed work above the activity without a model footer', () => {
    const html = renderToStaticMarkup(
      createElement(AgentPanelView, {
        run: { ...run, status: 'running', endedAt: null },
        events: [],
        selectedRunId: run.id,
        context: { id: 'graph', name: 'Graph' },
        catalog: { available: true, reason: null, models: [], runs: [run] },
        loading: false,
        error: null,
        busy: false,
        draft: '',
        onDraft: noop,
        onClose: noop,
        onSelectRun: noop,
        onArchiveThread: noop,
        onStop: noop,
        onDecision: noop,
        onSubmit: noop,
        onRetry: noop
      })
    );
    expect(html).toContain('Working for');
    expect(html).not.toContain('test · High');
    expect(html).not.toContain('lucide-loader-circle');
  });
  it('renders the failure explanation and saved progress outside collapsed steps', () => {
    const html = renderToStaticMarkup(
      createElement(AgentPanelView, {
        run: { ...run, status: 'failed' },
        events: [
          {
            sequence: 1,
            createdAt: run.createdAt,
            data: {
              type: 'graph_changes',
              nodesAdded: 10,
              edgesAdded: 10,
              summary: 'Saved'
            }
          },
          {
            sequence: 2,
            createdAt: run.createdAt,
            data: {
              type: 'finished',
              status: 'failed',
              summary: 'The investigation reached its token budget.'
            }
          }
        ],
        selectedRunId: run.id,
        context: { id: 'graph', name: 'Graph' },
        catalog: { available: true, reason: null, models: [], runs: [run] },
        loading: false,
        error: null,
        busy: false,
        draft: '',
        onDraft: noop,
        onClose: noop,
        onSelectRun: noop,
        onArchiveThread: noop,
        onStop: noop,
        onDecision: noop,
        onSubmit: noop,
        onRetry: noop
      })
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('The investigation reached its token budget.');
    expect(html).toContain('10 nodes and 10 links');
    expect(html).toContain('This investigation is incomplete.');
    expect(html).toContain('Copy response');
  });
  it('keeps the previous turns visible while a follow-up feed is still loading', () => {
    const history = [
      { runId: 'first', goal: 'Oldest question', messages: ['Oldest reply'] },
      {
        runId: 'parent',
        goal: 'Previous question',
        messages: ['Previous reply']
      }
    ];
    const pinned = pinTranscript(history, run, ['Current reply']);
    expect(
      exchangesToShow([], undefined, pinned, true).map(
        (exchange) => exchange.goal
      )
    ).toEqual(['Oldest question', 'Previous question', 'Current question']);
    expect(exchangesToShow([], undefined, pinned, false)).toEqual([]);
  });

  it('renders public exchanges chronologically before the current goal without remote images', () => {
    const html = renderToStaticMarkup(
      createElement(AgentPanelView, {
        run,
        events: [],
        selectedRunId: run.id,
        context: { id: 'graph', name: 'Graph' },
        catalog: {
          available: true,
          reason: null,
          models: [
            {
              id: 'test',
              name: 'Test',
              provider: 'openai',
              reasoningLevels: ['high'],
              defaultReasoning: 'high',
              available: true
            }
          ],
          runs: [run]
        },
        history: [
          {
            runId: 'first',
            goal: 'Oldest question',
            messages: ['Oldest reply']
          },
          {
            runId: 'parent',
            goal: 'Previous question',
            messages: [
              'Previous reply ![remote](https://example.org/image.png)'
            ]
          }
        ],
        loading: false,
        error: null,
        busy: false,
        canStart: true,
        draft: 'Follow-up',
        onDraft: noop,
        onClose: noop,
        onSelectRun: noop,
        onArchiveThread: noop,
        onStop: noop,
        onDecision: noop,
        onSubmit: noop,
        onRetry: noop
      })
    );
    const texts = [
      'Oldest question',
      'Oldest reply',
      'Previous question',
      'Previous reply',
      'Current question'
    ];
    const positions = texts.map((text) => html.indexOf(text));
    expect(positions.every((index) => index >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html).not.toContain('<img');
    expect(html).not.toContain('image.png');
    const submit = html.match(
      /<button[^>]*aria-label="Send message"[^>]*>/
    )?.[0];
    expect(submit).toBeDefined();
    expect(submit).not.toContain('disabled');
  });
  it('collapses intermediate steps into one summary until expanded', () => {
    const at = (second: number) => new Date(second * 1000).toISOString();
    const html = renderToStaticMarkup(
      createElement(AgentPanelView, {
        run,
        events: [
          {
            sequence: 1,
            createdAt: at(0),
            data: { type: 'phase', phase: 'planning', summary: 'Piano' }
          },
          {
            sequence: 2,
            createdAt: at(12),
            data: {
              type: 'tool',
              callId: 'c1',
              name: 'read_graph',
              target: 'Grafo corrente',
              status: 'completed',
              summary: '',
              sources: []
            }
          },
          {
            sequence: 3,
            createdAt: at(13),
            data: { type: 'message', text: 'Risposta finale', sources: [] }
          }
        ],
        selectedRunId: run.id,
        context: { id: 'graph', name: 'Graph' },
        catalog: { available: true, reason: null, models: [], runs: [run] },
        loading: false,
        error: null,
        busy: false,
        draft: '',
        onDraft: noop,
        onClose: noop,
        onSelectRun: noop,
        onArchiveThread: noop,
        onStop: noop,
        onDecision: noop,
        onSubmit: noop,
        onRetry: noop
      })
    );
    expect(html).toContain('Activity · 12 s');
    expect(html).toContain('2 steps');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Reading the graph');
    expect(html).toContain('Risposta finale');
    expect(html).not.toContain('data-response-word');
  });
  it('keeps the sent message visible and uses stop while the run is starting', () => {
    const html = renderToStaticMarkup(
      createElement(AgentPanelView, {
        run: null,
        events: [],
        selectedRunId: 'starting',
        context: { id: 'graph', name: 'Graph' },
        catalog: {
          available: true,
          reason: null,
          models: [
            {
              id: 'test',
              name: 'Test',
              provider: 'openai',
              reasoningLevels: ['high'],
              defaultReasoning: 'high',
              available: true
            }
          ],
          runs: []
        },
        loading: true,
        error: null,
        busy: true,
        canStart: false,
        startPhase: 'preparing',
        pendingGoal: 'Look up this domain',
        draft: '',
        onDraft: noop,
        onClose: noop,
        onSelectRun: noop,
        onArchiveThread: noop,
        onStop: noop,
        onDecision: noop,
        onSubmit: noop,
        onRetry: noop
      })
    );
    expect(html).toContain('data-allow-text-selection="true"');
    expect(html).toContain('Look up this domain');
    expect(html).not.toContain('Loading conversation');
    const stop = html.match(/<button[^>]*aria-label="Stop agent"[^>]*>/)?.[0];
    expect(stop).toBeDefined();
    expect(stop).not.toContain('disabled');
  });
});
