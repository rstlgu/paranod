import { describe, expect, it } from 'vitest';
import {
  agentEventSchema,
  mergeAgentEvents,
  type AgentEvent
} from './contracts';
import { agentTimeline } from './timeline';

const event = (sequence: number, data: AgentEvent['data']): AgentEvent => ({
  sequence,
  data,
  createdAt: new Date(0).toISOString()
});
const tool = {
  type: 'tool',
  callId: 'call-1',
  name: 'dns',
  target: 'example.org',
  status: 'running',
  summary: '',
  sources: []
} as const;

describe('public agent activity', () => {
  it('rejects arbitrary payloads and provider-internal fields', () => {
    for (const extra of [
      { apiKey: 'secret' },
      { rawReasoning: 'internal' },
      { arguments: { token: 'secret' } }
    ]) {
      expect(
        agentEventSchema.safeParse({
          type: 'phase',
          phase: 'thinking',
          summary: 'Analisi delle fonti',
          ...extra
        }).success
      ).toBe(false);
    }
  });
  it('rejects unsafe source protocols and embedded credentials', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,foo',
      'file:///tmp/test',
      'https://user:pass@example.org'
    ]) {
      expect(
        agentEventSchema.safeParse({
          type: 'message',
          text: 'Test',
          sources: [{ title: 'Fonte', url }]
        }).success
      ).toBe(false);
    }
    expect(
      agentEventSchema.safeParse({
        type: 'message',
        text: 'Test',
        sources: [{ title: 'Fonte', url: 'https://example.org/path' }]
      }).success
    ).toBe(true);
  });
  it('bounds public event sizes and requires immutable approval fingerprints', () => {
    expect(
      agentEventSchema.safeParse({ type: 'message', text: 'x'.repeat(16001) })
        .success
    ).toBe(false);
    expect(
      agentEventSchema.safeParse({
        type: 'approval',
        approvalId: 'a',
        tool: 'x',
        summary: 'Test',
        destination: 'example.org',
        argumentsHash: 'bad'
      }).success
    ).toBe(false);
  });
  it('replays overlapping pages once in stable sequence order', () => {
    const first = event(1, {
      type: 'phase',
      phase: 'planning',
      summary: 'Test'
    });
    const second = event(2, { ...tool, sources: [] });
    expect(
      mergeAgentEvents(
        [second, first],
        [first, second, event(3, { ...tool, status: 'completed', sources: [] })]
      ).map((value) => value.sequence)
    ).toEqual([1, 2, 3]);
  });
  it('updates a tool row in its original position and hides lifecycle duplicates', () => {
    const rows = agentTimeline([
      event(1, { ...tool, sources: [] }),
      event(2, { type: 'phase', phase: 'researching', summary: 'Controllo' }),
      event(3, { ...tool, status: 'completed', sources: [] }),
      event(4, { type: 'decision', approvalId: 'a', approved: false }),
      event(5, { type: 'finished', status: 'completed', summary: 'Fine' })
    ]);
    expect(rows.map((value) => value.sequence)).toEqual([1, 2]);
    expect(rows[0].data).toMatchObject({ status: 'completed' });
  });
});
