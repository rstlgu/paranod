import { z } from 'zod';

// Application working-context budget, not a claim about a provider's model window.
export const AGENT_CONTEXT_LIMIT = 128_000;
export const AGENT_CONTEXT_THRESHOLD = 0.8;
export const AGENT_CONTEXT_OUTPUT_RESERVE = 8192;
export const AGENT_CONTEXT_REQUEST_RESERVE = 8192;
export const AGENT_CONTEXT_HISTORY = { maxTurns: 200, maxChars: 1_536_000 };
export const AGENT_CONTEXT_MAX_GOALS = 200;
export const AGENT_CONTEXT_MAX_TOTAL_TOKENS = AGENT_CONTEXT_LIMIT * 8;
export const AGENT_CONTEXT_MAX_INPUT_CHARACTERS = AGENT_CONTEXT_LIMIT * 4;

// Curated direct models whose published window is at least 128k.
// Never infer a capacity from a provider name or a similar-looking model alias.
const LARGE_CONTEXT_MODELS = new Set([
  'gpt-6-astra',
  'gpt-6.1-sol',
  'gpt-6-sol',
  'gpt-6-luna',
  'gpt-5.6-terra',
  'gpt-5.5',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
  'gemini-3.1-pro-preview',
  'gemini-3.8-flash',
  'grok-4.7',
  'grok-4.3',
  'deepseek-flash',
  'kimi-k3',
  'kimi-k2.6'
]);
export function agentContextLimit(model?: string) {
  return !model || LARGE_CONTEXT_MODELS.has(model)
    ? AGENT_CONTEXT_LIMIT
    : 24_000;
}

export function agentContextCompactionThreshold(model?: string) {
  const limit = agentContextLimit(model);
  return Math.min(
    Math.floor(limit * AGENT_CONTEXT_THRESHOLD),
    limit - AGENT_CONTEXT_OUTPUT_RESERVE
  );
}
export const contextUsageSchema = z
  .object({
    tokens: z.number().int().min(0),
    limit: z.number().int().positive(),
    estimated: z.boolean(),
    compactions: z.number().int().min(0),
    state: z.enum(['ready', 'compacting', 'cleared']),
    budgetVersion: z.literal(2).optional()
  })
  .strict()
  .transform((usage): typeof usage => ({
    ...usage,
    // Old snapshots/events used a global 24k application limit. Normalize on
    // read, without rewriting token counters or the immutable event log.
    limit:
      usage.budgetVersion === undefined && usage.limit === 24_000
        ? AGENT_CONTEXT_LIMIT
        : usage.limit,
    budgetVersion: 2 as const
  }));
export type AgentContextUsage = z.infer<typeof contextUsageSchema>;
export function estimateContextTokens(text: string) {
  return Math.ceil(new TextEncoder().encode(text).length / 3);
}
export function emptyContextUsage(model?: string): AgentContextUsage {
  return {
    tokens: 0,
    limit: agentContextLimit(model),
    estimated: true,
    compactions: 0,
    state: 'ready',
    budgetVersion: 2
  };
}
