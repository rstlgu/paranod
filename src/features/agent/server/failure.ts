/** Only fixed, reviewed diagnostics may leave the worker. Never serialize SDK errors. */
const FAILURES = {
  compaction_failed: 'Context compaction could not finish. Saved messages and graph data are unchanged; try compacting the context again.',
  unknown:
    'The investigation stopped because of an unexpected error. The exact cause could not be identified safely.',
  turn_limit:
    'The investigation reached its step limit before producing a final answer.',
  token_limit:
    'The investigation reached its token budget before producing a final answer.',
  context_limit: 'The investigation context became too large to continue.',
  tool_limit: 'The investigation reached its tool-call limit.',
  event_limit: 'The investigation reached its activity limit.',
  timeout: 'The investigation reached its time limit.',
  interrupted:
    'The investigation was interrupted. No late results will be applied.',
  access_lost:
    'The investigation stopped because graph access or its edit lock is no longer valid.',
  authorization:
    'The operation could not be authorized safely. No further actions were performed.',
  authentication: 'The AI provider rejected the configured credentials.',
  quota:
    'The AI provider has no remaining credits or has reached a spending limit.',
  rate_limit: 'The AI provider temporarily limited requests.',
  provider_unavailable: 'The AI provider is temporarily unavailable.',
  invalid_input: 'The transform does not accept this node or input format.',
  node_unavailable:
    'A requested node is unavailable in the current graph. No changes were applied.',
  merge_not_allowed:
    'These nodes cannot be merged. Use at least two existing nodes of the same type, and choose one of them as the primary node. No changes were applied.',
  module_unavailable: 'The transform is unavailable or disabled.',
  module_timeout: 'The transform timed out or was cancelled.',
  module_failed: 'The transform could not retrieve or process its target.',
  invalid_result:
    'The transform returned a result that could not be safely applied.',
  result_limit:
    'The transform result exceeds the supported import limits. No results from this operation were saved.',
  empty_response: 'The model ended the investigation without a final answer.'
} as const;

export type AgentFailureCode = keyof typeof FAILURES;
const CODES: Record<string, AgentFailureCode> = {
  agent_compaction_failed: 'compaction_failed',
  agent_token_limit: 'token_limit',
  agent_context_limit: 'context_limit',
  agent_tool_limit: 'tool_limit',
  agent_event_limit: 'event_limit',
  agent_empty_response: 'empty_response',
  agent_lease_lost: 'access_lost',
  graph_lease_lost: 'access_lost',
  agent_scope_changed: 'access_lost',
  workspace_access_revoked: 'access_lost',
  agent_run_finished: 'access_lost',
  agent_approval_required: 'authorization',
  agent_approval_mismatch: 'authorization',
  agent_module_changed: 'authorization',
  agent_transform_unavailable: 'module_unavailable',
  agent_module_disabled: 'module_unavailable',
  agent_entity_type_not_supported: 'invalid_input',
  agent_node_unavailable: 'node_unavailable',
  agent_merge_not_allowed: 'merge_not_allowed',
  agent_module_cancelled: 'module_timeout',
  agent_module_failed: 'module_failed',
  agent_provider_failed: 'module_failed',
  agent_invalid_module_result: 'invalid_result',
  agent_result_limit: 'result_limit',
  agent_result_type_not_allowed: 'invalid_result'
};

/** Model-facing text when a tool call never reached execute. No raw arguments. */
export function toolArgumentFailure(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const value = error as {
    name?: string;
    originalError?: { issues?: unknown };
  };
  if (value.name !== 'InvalidToolInputError') return null;
  const issues = Array.isArray(value.originalError?.issues)
    ? value.originalError.issues.slice(0, 3)
    : [];
  const detail = issues
    .map((issue) => {
      if (!issue || typeof issue !== 'object') return '';
      const record = issue as { path?: unknown; message?: unknown };
      const path = Array.isArray(record.path)
        ? record.path
            .filter(
              (part) => typeof part === 'string' || typeof part === 'number'
            )
            .map(String)
            .join('.')
        : '';
      const message =
        typeof record.message === 'string' ? record.message.slice(0, 160) : '';
      if (!message) return '';
      return path ? `${path}: ${message}` : message;
    })
    .filter(Boolean)
    .join('; ');
  return detail
    ? `The arguments were rejected (${detail}). Use only the declared parameters and retry once.`
    : 'The arguments were rejected. Use only the declared parameters and retry once.';
}

export function agentFailure(
  error: unknown,
  signal?: AbortSignal,
  depth = 0
): { code: AgentFailureCode; summary: string } {
  let code: AgentFailureCode = 'unknown';
  const value =
    error && typeof error === 'object'
      ? (error as Record<string, unknown>)
      : {};
  if (
    !signal?.aborted &&
    depth < 3 &&
    ['ToolCallError', 'GuardrailExecutionError'].includes(String(value.name))
  ) {
    return agentFailure(value.error, undefined, depth + 1);
  }
  if (signal?.aborted) {
    const reason = signal.reason;
    code =
      reason?.name === 'TimeoutError'
        ? 'timeout'
        : reason?.message === 'agent_lease_lost'
          ? 'access_lost'
          : 'interrupted';
  } else if (
    typeof value.message === 'string' &&
    Object.hasOwn(CODES, value.message)
  ) {
    code = CODES[value.message];
  } else if (value.name === 'MaxTurnsExceededError') code = 'turn_limit';
  else if (value.name === 'ZodError') code = 'invalid_input';
  else if (
    value.name === 'TimeoutError' ||
    value.name === 'ModelTimeoutError' ||
    value.name === 'APIConnectionTimeoutError'
  )
    code = 'timeout';
  else if (providerQuota(error)) code = 'quota';
  else if (value.status === 401) code = 'authentication';
  else if (value.status === 429) code = 'rate_limit';
  else if (
    typeof value.status === 'number' &&
    value.status >= 500 &&
    value.status <= 599
  )
    code = 'provider_unavailable';
  return { code, summary: FAILURES[code] };
}

const QUOTA_CODES = new Set([
  'insufficient_quota',
  'credit_balance_exhausted'
]);

// OpenAI quota failures often omit HTTP status and nest the code on `error`.
function providerQuota(error: unknown) {
  let current = error;
  for (let depth = 0; current && typeof current === 'object' && depth < 4; depth++) {
    const value = current as Record<string, unknown>;
    if (
      (typeof value.code === 'string' && QUOTA_CODES.has(value.code)) ||
      (typeof value.type === 'string' && QUOTA_CODES.has(value.type))
    )
      return true;
    current = value.error ?? value.cause;
  }
  return false;
}

export function isFatalAgentError(error: unknown) {
  return [
    'turn_limit',
    'token_limit',
    'context_limit',
    'tool_limit',
    'event_limit',
    'access_lost',
    'authorization'
  ].includes(agentFailure(error).code);
}

export function isRecoverableTransformPreparationError(error: unknown) {
  return ['invalid_input', 'module_unavailable', 'node_unavailable'].includes(
    agentFailure(error).code
  );
}
