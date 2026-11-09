import { describe, expect, it } from 'vitest';
import {
  agentConversationPickerValue,
  agentConversationThreads,
  agentThreadRunIds
} from './conversation-threads';
import type { AgentRunSummary } from './contracts';

function run(
  id: string,
  goal: string,
  createdAt: string,
  parentRunId: string | null = null
): AgentRunSummary {
  return {
    id,
    parentRunId,
    graphId: 'graph',
    graphName: 'Graph',
    goal,
    model: 'gpt-5.5',
    reasoning: 'medium',
    approvalMode: 'guarded',
    status: 'completed',
    createdAt,
    endedAt: createdAt
  };
}

describe('agent conversation threads', () => {
  it('groups follow-ups under the root conversation', () => {
    const threads = agentConversationThreads([
      run('b2', 'Follow-up', '2026-01-02T00:00:00.000Z', 'b1'),
      run('a1', 'First chat', '2026-01-01T00:00:00.000Z'),
      run('b1', 'Second chat', '2026-01-01T12:00:00.000Z')
    ]);
    expect(threads.map((thread) => thread.rootId)).toEqual(['b1', 'a1']);
    expect(threads[0]).toMatchObject({
      title: 'Second chat',
      latest: { id: 'b2' }
    });
    expect(
      agentConversationPickerValue(
        [
          run('b2', 'Follow-up', '2026-01-02T00:00:00.000Z', 'b1'),
          run('b1', 'Second chat', '2026-01-01T12:00:00.000Z')
        ],
        'b1'
      )
    ).toBe('b2');
    expect(
      agentThreadRunIds(
        [
          run('b2', 'Follow-up', '2026-01-02T00:00:00.000Z', 'b1'),
          run('b1', 'Second chat', '2026-01-01T12:00:00.000Z'),
          run('a1', 'First chat', '2026-01-01T00:00:00.000Z')
        ],
        'b1'
      ).sort()
    ).toEqual(['b1', 'b2']);
  });
});
