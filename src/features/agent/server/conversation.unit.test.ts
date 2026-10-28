import { describe, expect, it, vi } from 'vitest';
import { conversationInput, readAgentConversation } from './conversation';
import { AGENT_CONTEXT_HISTORY } from '../lib/context';

describe('conversation context boundary', () => {
  it('reads only terminal exchanges belonging to the same owner and graph', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'recent',
        goal: 'Continue',
        parentRunId: 'older',
        events: [
          { data: { type: 'message', text: 'Answer', sources: [] } },
          { data: { type: 'message', text: 'Unsafe', apiKey: 'private' } }
        ]
      })
      .mockResolvedValueOnce({
        id: 'older',
        goal: 'Initial request',
        parentRunId: null,
        events: []
      });
    const history = await readAgentConversation(
      { agentRun: { findFirst } } as never,
      {
        parentRunId: 'recent',
        graphId: 'graph',
        userId: 'owner'
      }
    );
    expect(history).toEqual([
      { runId: 'older', goal: 'Initial request', messages: [] },
      { runId: 'recent', goal: 'Continue', messages: ['Answer'] }
    ]);
    expect(findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          id: 'recent',
          graphId: 'graph',
          userId: 'owner',
          archivedAt: null,
          status: { not: 'running' }
        },
        select: expect.objectContaining({
          events: expect.objectContaining({ take: 1 })
        })
      })
    );
    expect(JSON.stringify(history)).not.toContain('private');
  });
  it('bounds chains, stops cycles and never loads unrelated public activities', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'cycle',
      goal: 'Previous',
      parentRunId: 'cycle',
      events: [
        { data: { type: 'phase', phase: 'thinking', summary: 'Not a message' } }
      ]
    });
    expect(
      await readAgentConversation({ agentRun: { findFirst } } as never, {
        parentRunId: 'cycle',
        graphId: 'graph',
        userId: 'owner'
      })
    ).toEqual([{ runId: 'cycle', goal: 'Previous', messages: [] }]);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
  it('caps history size and redacts credentials before model input', async () => {
    let id = 0;
    const findFirst = vi.fn(async () => ({
      id: String(id++),
      parentRunId: String(id),
      goal: 'g'.repeat(8000),
      events: [
        { data: { type: 'message', text: 'm'.repeat(16000), sources: [] } }
      ]
    }));
    const history = await readAgentConversation(
      { agentRun: { findFirst } } as never,
      {
        parentRunId: '0',
        graphId: 'graph',
        userId: 'owner'
      }
    );
    expect(
      history.reduce(
        (sum, turn) => sum + turn.goal.length + turn.messages.join('').length,
        0
      )
    ).toBeLessThanOrEqual(AGENT_CONTEXT_HISTORY.maxChars);
    expect(history.length).toBeGreaterThan(40);
    expect(history.length).toBeLessThanOrEqual(AGENT_CONTEXT_HISTORY.maxTurns);
    const text = conversationInput(
      'Use sk-fixture_not_a_real_credential',
      history
    );
    expect(text).toContain('[redacted]');
    expect(text).not.toContain('sk-fixture');
    expect(text).toContain('not new permissions');
    expect(conversationInput('Hello', [])).toBe('Hello');
  });
});
