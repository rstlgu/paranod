import { z } from 'zod';
import { contextUsageSchema, type AgentContextUsage } from './context';

export const RUN_STATUSES = [
  'running',
  'completed',
  'cancelled',
  'failed',
  'interrupted'
] as const;
export type AgentRunStatus = (typeof RUN_STATUSES)[number];
export const AGENT_APPROVAL_MODES = {
  ask: {
    label: 'Ask every time',
    description: 'Confirm every module and every graph change'
  },
  guarded: {
    label: 'Auto',
    description: 'Ask for external services, hypotheses and deletions'
  },
  auto: {
    label: 'Full access',
    description: 'Run tools and edit or delete nodes without asking'
  }
} as const;
export type AgentApprovalMode = keyof typeof AGENT_APPROVAL_MODES;
export const agentApprovalModeSchema = z.enum(['ask', 'guarded', 'auto']);
export const DEFAULT_AGENT_APPROVAL_MODE: AgentApprovalMode = 'guarded';
const shortText = z.string().min(1).max(240);
const source = z
  .object({
    title: shortText,
    url: z
      .string()
      .max(2048)
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            ['https:', 'http:'].includes(url.protocol) &&
            !url.username &&
            !url.password
          );
        } catch {
          return false;
        }
      })
  })
  .strict();

// Only public activity belongs here. Provider state, raw reasoning and secrets
// must use separate server-only storage, never an arbitrary event payload.
export const agentEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('usage'),
      inputTokens: z.number().int().min(0),
      outputTokens: z.number().int().min(0),
      context: contextUsageSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('phase'),
      phase: z.enum(['planning', 'thinking', 'researching', 'updating_graph']),
      summary: z.string().min(1).max(2000)
    })
    .strict(),
  z
    .object({
      type: z.literal('message'),
      text: z.string().min(1).max(16000),
      sources: z.array(source).max(30).default([])
    })
    .strict(),
  z
    .object({
      type: z.literal('tool'),
      callId: shortText,
      name: shortText,
      target: z.string().max(400),
      status: z.enum(['running', 'completed', 'failed']),
      summary: z.string().max(2000),
      durationMs: z.number().int().min(0).max(86_400_000).optional(),
      sources: z.array(source).max(20).default([])
    })
    .strict(),
  z
    .object({
      type: z.literal('graph_changes'),
      nodesAdded: z.number().int().min(0).max(10000),
      edgesAdded: z.number().int().min(0).max(20000),
      nodesRemoved: z.number().int().min(0).max(10000).optional(),
      edgesRemoved: z.number().int().min(0).max(20000).optional(),
      summary: z.string().max(2000)
    })
    .strict(),
  z
    .object({
      type: z.literal('approval'),
      approvalId: shortText,
      tool: shortText,
      summary: z.string().min(1).max(2000),
      destination: shortText,
      argumentsHash: z.string().regex(/^[a-f0-9]{64}$/)
    })
    .strict(),
  z
    .object({
      type: z.literal('decision'),
      approvalId: shortText,
      approved: z.boolean()
    })
    .strict(),
  z
    .object({
      type: z.literal('finished'),
      status: z.enum(['completed', 'cancelled', 'failed', 'interrupted']),
      reasonCode: z.string().max(64).optional(),
      summary: z.string().min(1).max(2000)
    })
    .strict()
]);

export type AgentEventData = z.infer<typeof agentEventSchema>;
export interface AgentEvent {
  sequence: number;
  createdAt: string;
  data: AgentEventData;
}
export interface AgentRunSummary {
  inputTokens?: number;
  outputTokens?: number;
  contextUsage?: AgentContextUsage | null;
  id: string;
  parentRunId?: string | null;
  graphId: string;
  graphName: string;
  goal: string;
  model: string;
  reasoning: string;
  approvalMode: AgentApprovalMode;
  status: AgentRunStatus;
  createdAt: string;
  endedAt: string | null;
}
export const AGENT_PROVIDERS = {
  openai: {
    label: 'OpenAI',
    keyPlaceholder: 'sk-...',
    summary: 'GPT models on the official API.'
  },
  anthropic: {
    label: 'Anthropic',
    keyPlaceholder: 'sk-ant-...',
    summary: 'Claude models on the official API.'
  },
  google: {
    label: 'Google',
    keyPlaceholder: 'AIza...',
    summary: 'Gemini models on the official API.'
  },
  xai: {
    label: 'xAI',
    keyPlaceholder: 'xai-...',
    summary: 'Grok models on the official API.'
  },
  deepseek: {
    label: 'DeepSeek',
    keyPlaceholder: 'sk-...',
    summary: 'DeepSeek Chat and Reasoner on the official API.'
  },
  moonshot: {
    label: 'Moonshot',
    keyPlaceholder: 'sk-...',
    summary: 'Kimi models on the official API.'
  },
  openrouter: {
    label: 'OpenRouter',
    keyPlaceholder: 'sk-or-...',
    summary: 'Any other tool-capable model, chosen by slug.'
  }
} as const;
export type AgentProviderId = keyof typeof AGENT_PROVIDERS;
export const AGENT_PROVIDER_IDS = Object.keys(
  AGENT_PROVIDERS
) as AgentProviderId[];

export interface AgentModelOption {
  id: string;
  name: string;
  provider: 'auto' | AgentProviderId;
  reasoningLevels: string[];
  defaultReasoning: string;
  available: boolean;
}
export interface AgentCatalog {
  available: boolean;
  reason: string | null;
  models: AgentModelOption[];
  runs: AgentRunSummary[];
}
export interface AgentFeed {
  run: AgentRunSummary;
  events: AgentEvent[];
  hasMore: boolean;
  history?: AgentHistoryExchange[];
}
export interface AgentHistoryExchange {
  runId: string;
  goal: string;
  messages: string[];
}

export function mergeAgentEvents(
  previous: AgentEvent[],
  incoming: AgentEvent[]
) {
  const bySequence = new Map(previous.map((event) => [event.sequence, event]));
  for (const event of incoming)
    if (!bySequence.has(event.sequence)) bySequence.set(event.sequence, event);
  return Array.from(bySequence.values()).sort(
    (a, b) => a.sequence - b.sequence
  );
}

export function isTerminalRun(status: AgentRunStatus) {
  return status !== 'running';
}
