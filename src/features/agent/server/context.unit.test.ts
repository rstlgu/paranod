import { describe, expect, it, vi } from 'vitest';
import {
  checkpointSchema,
  contextInput,
  contextTextChunks,
  publicModelContext,
  readAgentContext
} from './context';
import { AGENT_CONTEXT_HISTORY, estimateContextTokens } from '../lib/context';

describe('agent context memory', () => {
  it('stops at a cleared checkpoint without reintroducing old requests', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'last',
      goal: 'Old goal',
      parentRunId: 'older',
      events: [],
      contextCheckpoint: {
        mode: 'cleared',
        summary: '',
        includesRun: true,
        goals: []
      }
    });
    const result = await readAgentContext(
      { agentRun: { findFirst } } as never,
      { parentRunId: 'last', graphId: 'graph', userId: 'owner' }
    );
    expect(result).toEqual({ history: [], summary: '', goals: [] });
    expect(findFirst).toHaveBeenCalledOnce();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          events: expect.objectContaining({ take: 1 })
        })
      })
    );
    expect(contextInput('New goal', result)).toBe('New goal');
  });
  it('keeps the current public exchange after an automatic ancestor compaction', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'last',
      goal: 'Continue',
      parentRunId: 'older',
      events: [{ data: { type: 'message', text: 'New results', sources: [] } }],
      contextCheckpoint: {
        mode: 'compacted',
        summary: 'Earlier findings',
        includesRun: false,
        goals: ['Original target']
      }
    });
    const result = await readAgentContext(
      { agentRun: { findFirst } } as never,
      { parentRunId: 'last', graphId: 'graph', userId: 'owner' }
    );
    expect(result.history).toEqual([
      { runId: 'last', goal: 'Continue', messages: ['New results'] }
    ]);
    expect(result.goals).toEqual(['Original target', 'Continue']);
    expect(contextInput('Go on', result)).toContain('Earlier findings');
    expect(findFirst).toHaveBeenCalledOnce();
  });
  it('does not load deleted, running, archived or other-owner conversations', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    expect(
      await readAgentContext({ agentRun: { findFirst } } as never, {
        parentRunId: 'missing',
        graphId: 'graph',
        userId: 'owner'
      })
    ).toEqual({ history: [], summary: '', goals: [] });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'missing',
          graphId: 'graph',
          userId: 'owner',
          archivedAt: null,
          status: { not: 'running' }
        }
      })
    );
  });
  it('retains long follow-ups beyond the old 40-turn and 160k-character caps', async () => {
    const answer = `${'evidence '.repeat(1600)}TAIL EVIDENCE`;
    const findFirst = vi.fn(async ({ where }: { where: { id: string } }) => {
      const index = Number(where.id);
      return {
        id: where.id,
        goal: `Goal ${index}`,
        parentRunId: index ? String(index - 1) : null,
        contextCheckpoint: null,
        events: [{ data: { type: 'message', text: answer, sources: [] } }]
      };
    });
    const result = await readAgentContext(
      { agentRun: { findFirst } } as never,
      {
        parentRunId: '49',
        graphId: 'graph',
        userId: 'owner'
      }
    );
    expect(result.history).toHaveLength(50);
    expect(result.history[0].goal).toBe('Goal 0');
    expect(result.history.at(-1)?.goal).toBe('Goal 49');
    expect(
      result.history.every((turn) => turn.messages[0].endsWith('TAIL EVIDENCE'))
    ).toBe(true);
    expect(contextInput('Follow up', result).length).toBeGreaterThan(160_000);
    expect(result.goals).toHaveLength(50);
    expect(
      checkpointSchema.safeParse({
        mode: 'compacted',
        summary: 'Memory',
        includesRun: false,
        goals: result.goals
      }).success
    ).toBe(true);
  });

  it('keeps hard history bounds and stops cycles', async () => {
    const findFirst = vi.fn(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      goal: 'g'.repeat(8000),
      parentRunId: String(Number(where.id) + 1),
      contextCheckpoint: null,
      events: Array.from({ length: 3 }, () => ({
        data: { type: 'message', text: 'm'.repeat(16_000), sources: [] }
      }))
    }));
    const scope = { parentRunId: '0', graphId: 'graph', userId: 'owner' };
    const result = await readAgentContext(
      { agentRun: { findFirst } } as never,
      scope
    );
    expect(
      result.history.reduce(
        (chars, turn) => chars + JSON.stringify(turn).length,
        0
      )
    ).toBeLessThanOrEqual(AGENT_CONTEXT_HISTORY.maxChars);
    expect(findFirst.mock.calls.length).toBeLessThanOrEqual(
      AGENT_CONTEXT_HISTORY.maxTurns
    );

    findFirst.mockReset().mockResolvedValue({
      id: '0',
      goal: 'Goal',
      parentRunId: '0',
      contextCheckpoint: null,
      events: []
    });
    expect(
      (await readAgentContext({ agentRun: { findFirst } } as never, scope))
        .history
    ).toHaveLength(1);
    expect(findFirst).toHaveBeenCalledOnce();
  });

  it('chunks UTF-8 text without losing non-ASCII data or splitting Unicode pairs', () => {
    const text = 'hello 日本語 😀 evidence\n'.repeat(3000);
    const chunks = Array.from(contextTextChunks(text, 2000));
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.join('')).toBe(text);
    expect(chunks.every((chunk) => estimateContextTokens(chunk) <= 2000)).toBe(
      true
    );
    expect(chunks.every((chunk) => chunk.isWellFormed())).toBe(true);
    expect(() => Array.from(contextTextChunks('text', 0))).toThrow(
      'agent_context_limit'
    );
  });

  it('does not truncate large public inputs before compaction can summarize their tail', () => {
    const text = `${'x'.repeat(330_000)}IMPORTANT TAIL`;
    const projected = publicModelContext([
      { role: 'user', content: text, providerData: { private: 'PRIVATE' } },
      {
        type: 'function_call_result',
        callId: 'tool',
        output: { type: 'text', text }
      }
    ]);
    expect(projected[0].text).toBe(text);
    expect(projected[1].result).toBe(text);
    expect(JSON.stringify(projected)).not.toContain('PRIVATE');
  });
  it('excludes reasoning and provider state from compaction inputs', () => {
    const result = publicModelContext([
      { type: 'reasoning', content: 'PRIVATE' },
      {
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Found example.org' }],
        providerData: { secret: 'PRIVATE' }
      },
      {
        type: 'function_call_result',
        callId: 'call',
        output: { type: 'text', text: '{"nodeId":"seed"}' },
        providerData: { secret: 'PRIVATE' }
      }
    ]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(JSON.stringify(result)).toContain('seed');
    expect(estimateContextTokens('日本語')).toBeGreaterThan(
      estimateContextTokens('abc')
    );
  });
});
