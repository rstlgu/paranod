import { describe, expect, it } from 'vitest';
import { agentEventSchema } from './contracts';
import {
  AGENT_CONTEXT_LIMIT,
  AGENT_CONTEXT_OUTPUT_RESERVE,
  agentContextCompactionThreshold,
  agentContextLimit,
  contextUsageSchema,
  emptyContextUsage
} from './context';

describe('context budget and persisted usage compatibility', () => {
  it('uses a 128k baseline with reply headroom and an earlier compaction trigger', () => {
    expect(emptyContextUsage()).toMatchObject({
      limit: 128_000,
      budgetVersion: 2
    });
    expect(agentContextCompactionThreshold('gpt-6-astra')).toBe(102_400);
    expect(
      agentContextCompactionThreshold() + AGENT_CONTEXT_OUTPUT_RESERVE
    ).toBeLessThan(AGENT_CONTEXT_LIMIT);
  });

  it('upgrades old 24k snapshots and usage events without changing accounting', () => {
    const legacy = {
      tokens: 18_432,
      limit: 24_000,
      estimated: false,
      compactions: 3,
      state: 'ready' as const
    };
    const parsed = contextUsageSchema.parse(legacy);
    expect(parsed).toEqual({
      ...legacy,
      limit: AGENT_CONTEXT_LIMIT,
      budgetVersion: 2
    });
    expect(contextUsageSchema.parse(parsed)).toEqual(parsed);
    expect(
      agentEventSchema.parse({
        type: 'usage',
        inputTokens: 99_000,
        outputTokens: 1200,
        context: legacy
      })
    ).toEqual({
      type: 'usage',
      inputTokens: 99_000,
      outputTokens: 1200,
      context: parsed
    });
    expect(legacy.limit).toBe(24_000);
  });

  it('preserves explicitly versioned smaller model budgets on repeated reads', () => {
    const usage = emptyContextUsage('openrouter/vendor/custom-model');
    expect(agentContextLimit('openrouter/vendor/custom-model')).toBe(24_000);
    expect(agentContextLimit('gemini-3-flash-lite')).toBe(24_000);
    expect(agentContextLimit('grok-4.7')).toBe(128_000);
    expect(agentContextLimit('deepseek-flash')).toBe(128_000);
    expect(agentContextLimit('kimi-k2.6')).toBe(128_000);
    expect(agentContextLimit('future-unverified-model')).toBe(24_000);
    expect(contextUsageSchema.parse(usage)).toEqual(usage);
    expect(contextUsageSchema.parse(contextUsageSchema.parse(usage))).toEqual(
      usage
    );
  });

  it('still rejects malformed and private usage data', () => {
    expect(
      contextUsageSchema.safeParse({ ...emptyContextUsage(), tokens: -1 })
        .success
    ).toBe(false);
    expect(
      contextUsageSchema.safeParse({
        ...emptyContextUsage(),
        secret: 'private'
      }).success
    ).toBe(false);
    expect(
      contextUsageSchema.safeParse({
        ...emptyContextUsage(),
        budgetVersion: 99
      }).success
    ).toBe(false);
  });
});
