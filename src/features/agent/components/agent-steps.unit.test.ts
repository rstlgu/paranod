import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AgentSteps } from './agent-steps';
import styles from './agent-panel.module.css';
import type { AgentEvent } from '../lib/contracts';
import {
  agentTimeline,
  groupAgentTimeline,
  latestAgentActivity,
  latestAgentNote
} from '../lib/timeline';

it('keeps the latest narrative visible alongside transform and graph updates', () => {
  const data: AgentEvent['data'][] = [
    {
      type: 'phase',
      phase: 'planning',
      summary: 'Preparing the investigation.'
    },
    { type: 'message', text: 'Checking DNS records now.', sources: [] },
    {
      type: 'tool',
      callId: 'dns',
      name: 'run_transform',
      target: 'dns-lookup/dns-resolve-a',
      status: 'running',
      summary: '',
      sources: []
    },
    { type: 'graph_changes', nodesAdded: 3, edgesAdded: 3, summary: 'Saved' },
    {
      type: 'tool',
      callId: 'dns',
      name: 'run_transform',
      target: 'dns-lookup/dns-resolve-a',
      status: 'completed',
      summary: 'Done',
      sources: []
    },
    { type: 'phase', phase: 'thinking', summary: 'Thinking.' }
  ];
  const expected = [
    'Thinking…',
    'Checking DNS records now.',
    'Running transform dns-lookup/dns-resolve-a',
    'Graph updated: added 3 nodes and 3 links.',
    'Transform dns-lookup/dns-resolve-a completed.',
    'Transform dns-lookup/dns-resolve-a completed.'
  ];
  const events: AgentEvent[] = [];
  for (let i = 0; i < data.length; i++) {
    events.push({
      sequence: i + 1,
      createdAt: new Date(i * 1000).toISOString(),
      data: data[i]
    });
    const blocks = groupAgentTimeline(agentTimeline(events), new Set(), true);
    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    if (block.kind !== 'steps') throw new Error('Expected compact steps');
    const html = renderToStaticMarkup(
      createElement(AgentSteps, {
        block,
        decisions: new Map(),
        live: true,
        running: true,
        stale: false,
        latestActivity: latestAgentActivity(events),
        latestNote: latestAgentNote(events)
      })
    );
    expect(html).toContain(expected[i]);
    if (i > 0) expect(html).not.toContain('Thinking');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(styles.compactRow);
    expect(html).toContain(styles.compactNote);
    expect(html).toContain(styles.activityPulse);
    expect(html).not.toContain('lucide-loader-circle');
    expect(html).not.toContain('>Activity<');
    if (i >= 2) expect(html).toContain('Checking DNS records now.');
  }
});

it('shows on-demand tool loading with an animated operation icon', () => {
  const row: AgentEvent = {
    sequence: 1,
    createdAt: new Date(0).toISOString(),
    data: {
      type: 'tool',
      callId: 'discovery',
      name: 'describe_module',
      target: 'dns-lookup/dns-resolve-a',
      status: 'running',
      summary: '',
      sources: []
    }
  };
  const block = groupAgentTimeline([row], new Set(), true)[0];
  if (block.kind !== 'steps') throw new Error('Expected steps');
  const html = renderToStaticMarkup(
    createElement(AgentSteps, {
      block,
      decisions: new Map(),
      live: true,
      running: true,
      stale: false,
      latestActivity: row
    })
  );
  expect(html).toContain('Loading tool details');
  expect(html).toContain('lucide-wrench');
  expect(html).not.toContain('lucide-loader-circle');
});
