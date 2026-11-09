import { describe, expect, it } from 'vitest';
import type { AgentEvent, AgentEventData } from './contracts';
import {
  agentTimeline,
  groupAgentTimeline,
  latestAgentActivity,
  latestAgentNote
} from './timeline';
import { describeCompactActivity } from './timeline';
import { runFailureSummary } from './run-outcome';

let sequence = 0;
it('reports node and incident-link deletions in compact activity and failed-run summaries', () => {
  const change: AgentEventData = {
    type: 'graph_changes',
    nodesAdded: 0,
    edgesAdded: 0,
    nodesRemoved: 2,
    edgesRemoved: 3,
    summary: 'Removed duplicate nodes.'
  };
  expect(describeCompactActivity(change)).toBe(
    'Graph updated: removed 2 nodes and 3 links.'
  );
  expect(runFailureSummary([change], 'Interrupted.')).toContain(
    '2 nodes and 3 links removed.'
  );
});
function event(data: AgentEventData, second: number): AgentEvent {
  return {
    sequence: ++sequence,
    createdAt: new Date(second * 1000).toISOString(),
    data
  };
}
const thinking = {
  type: 'phase',
  phase: 'thinking',
  summary: 'Analisi in corso.'
} as const;
const tool = (status: 'running' | 'completed'): AgentEventData => ({
  type: 'tool',
  callId: 'call-1',
  name: 'read_graph',
  target: 'Grafo corrente',
  status,
  summary: '',
  sources: []
});

describe('agent timeline grouping', () => {
  it('does not let module lookups or graph reads overwrite a public note, including batched events', () => {
    const note = event(
      {
        type: 'message',
        text: 'Risoluzione A completata; verifico moduli sugli IP emersi.',
        sources: []
      },
      0
    );
    const rows = [
      note,
      event(tool('running'), 1),
      event(tool('completed'), 2),
      event(
        { ...tool('completed'), name: 'list_modules' } as AgentEventData,
        3
      ),
      event(thinking, 4)
    ];
    expect(latestAgentActivity(rows)?.data).toMatchObject({
      name: 'list_modules'
    });
    expect(latestAgentNote(rows)).toBe(note);
    const next = event(
      {
        type: 'message',
        text: 'Trovati record MX; continuo sul dominio principale.',
        sources: []
      },
      5
    );
    expect(latestAgentNote([...rows, next])).toBe(next);
  });
  it('shows a final fallback for old failed runs without a reply', () => {
    const rows = [
      event(
        {
          type: 'graph_changes',
          nodesAdded: 10,
          edgesAdded: 10,
          summary: 'Saved'
        },
        1
      ),
      event(
        {
          type: 'tool',
          callId: 'headers',
          name: 'run_transform',
          target: 'url-parser/url-http-headers',
          status: 'failed',
          summary: 'Failed.',
          sources: []
        },
        2
      ),
      event(thinking, 3),
      event({ type: 'finished', status: 'failed', summary: 'Run failed.' }, 4)
    ];
    const blocks = groupAgentTimeline(agentTimeline(rows));
    expect(blocks.map((block) => block.kind)).toEqual(['steps', 'event']);
    const last = blocks.at(-1);
    expect(last?.kind === 'event' && last.event.data).toMatchObject({
      type: 'message',
      text: expect.stringContaining('10 nodes and 10 links')
    });
    expect(last?.kind === 'event' && last.event.data).toMatchObject({
      text: expect.stringContaining('url-parser/url-http-headers')
    });
  });

  it('does not duplicate persisted failure replies or count tool updates twice', () => {
    const work = [event(tool('running'), 0), event(tool('completed'), 1)];
    const text = runFailureSummary(
      work.map((row) => row.data),
      'Budget reached.'
    );
    const rows = [
      ...work,
      event({ type: 'message', text, sources: [] }, 2),
      event(
        { type: 'finished', status: 'failed', summary: 'Budget reached.' },
        3
      )
    ];
    const messages = agentTimeline(rows).filter(
      (row) => row.data.type === 'message'
    );
    expect(messages).toHaveLength(1);
    expect(text).toContain('1 operations completed; 0 failed');
  });
  it('folds commentary and decided approvals, keeping the final answer', () => {
    const approval = {
      type: 'approval',
      approvalId: 'approve-2',
      tool: 'run_transform',
      summary: 'Eseguire?',
      destination: 'example.org',
      argumentsHash: 'b'.repeat(64)
    } as const;
    const timeline = agentTimeline([
      event(thinking, 0),
      event({ type: 'message', text: 'Procedo', sources: [] }, 1),
      event(approval, 2),
      event({ type: 'decision', approvalId: 'approve-2', approved: true }, 3),
      event(tool('completed'), 4),
      event({ type: 'message', text: 'Fatto', sources: [] }, 5)
    ]);
    const pending = groupAgentTimeline(timeline.slice(0, 2));
    expect(pending.map((block) => block.kind)).toEqual(['steps', 'event']);
    const blocks = groupAgentTimeline(timeline, new Set(['approve-2']));
    expect(blocks.map((block) => block.kind)).toEqual(['steps', 'event']);
    const [steps, answer] = blocks;
    if (steps.kind !== 'steps' || answer.kind !== 'event')
      throw new Error('unexpected blocks');
    expect(steps.steps.map((step) => step.data.type)).toEqual([
      'message',
      'approval',
      'tool'
    ]);
    expect(answer.event.data).toMatchObject({ text: 'Fatto' });
  });
  it('groups consecutive steps and keeps pending approvals visible', () => {
    const blocks = groupAgentTimeline(
      agentTimeline([
        event(thinking, 0),
        event(tool('running'), 1),
        event(thinking, 2),
        event(thinking, 3),
        event(tool('completed'), 4),
        event(
          {
            type: 'graph_changes',
            nodesAdded: 1,
            edgesAdded: 0,
            summary: 'ok'
          },
          5
        ),
        event({ type: 'message', text: 'Risultato', sources: [] }, 6),
        event(thinking, 7),
        event(
          {
            type: 'approval',
            approvalId: 'approve-1',
            tool: 'run_transform',
            summary: 'Eseguire?',
            destination: 'example.org',
            argumentsHash: 'a'.repeat(64)
          },
          8
        )
      ])
    );
    expect(blocks.map((block) => block.kind)).toEqual(['steps', 'event']);
    const first = blocks[0];
    if (first.kind !== 'steps') throw new Error('expected steps');
    // Tool updates keep their slot; thinking entries never enter the log.
    expect(first.steps.map((step) => step.data.type)).toEqual([
      'tool',
      'graph_changes',
      'message'
    ]);
    expect(first.steps[0].data).toMatchObject({ status: 'completed' });
    expect(first.startedAt).toBe(new Date(4000).toISOString());
    expect(first.endedAt).toBe(new Date(6000).toISOString());
  });

  it('hides all historical thinking and keeps operational commentary compact while running', () => {
    const rows = [
      event(thinking, 0),
      event(tool('running'), 1),
      event({ ...thinking, summary: '**Long reasoning summary**' }, 2),
      event(
        { type: 'message', text: 'Verifico gli indirizzi IP.', sources: [] },
        3
      )
    ];
    const timeline = agentTimeline(rows);
    expect(timeline.map((row) => row.data.type)).toEqual(['tool', 'message']);
    expect(
      groupAgentTimeline(timeline, new Set(), true).map((block) => block.kind)
    ).toEqual(['steps']);
    expect(
      groupAgentTimeline(timeline, new Set(), false).map((block) => block.kind)
    ).toEqual(['steps', 'event']);
    expect(latestAgentActivity(rows)?.data).toMatchObject({
      text: 'Verifico gli indirizzi IP.'
    });
  });

  it('keeps trailing progress notes out of the finished report', () => {
    const note = (text: string, second: number) =>
      event({ type: 'message', text, sources: [] }, second);
    const timeline = agentTimeline([
      event(tool('completed'), 1),
      note('Resta l’IPv6 già trovato; provo ASN e PTR anche su quello.', 2),
      note('Ho quasi finito: aggiungo ASN e reverse DNS anche per l’IPv6.', 3),
      note('Ho ricominciato con il nuovo target yandex.com.', 4)
    ]);
    expect(
      groupAgentTimeline(timeline, new Set(), true).map((block) => block.kind)
    ).toEqual(['steps']);
    const blocks = groupAgentTimeline(timeline);
    expect(blocks.map((block) => block.kind)).toEqual(['steps', 'event']);
    const [steps, answer] = blocks;
    if (steps.kind !== 'steps' || answer.kind !== 'event')
      throw new Error('unexpected blocks');
    expect(steps.steps.map((step) => step.data.type)).toEqual([
      'tool',
      'message',
      'message'
    ]);
    expect(answer.event.data).toMatchObject({
      text: 'Ho ricominciato con il nuovo target yandex.com.'
    });
  });

  it('follows the latest tool completion even when its history slot precedes a graph update', () => {
    const rows = [
      event({ ...tool('running'), name: 'run_transform' } as AgentEventData, 0),
      event(
        {
          type: 'graph_changes',
          nodesAdded: 1,
          edgesAdded: 1,
          summary: 'Saved'
        },
        1
      ),
      event(
        { ...tool('completed'), name: 'run_transform' } as AgentEventData,
        2
      ),
      event(thinking, 3)
    ];
    expect(agentTimeline(rows).at(-1)?.data.type).toBe('graph_changes');
    expect(latestAgentActivity(rows)?.data).toMatchObject({
      type: 'tool',
      status: 'completed'
    });
  });
});
