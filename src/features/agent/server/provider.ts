import OpenAI from 'openai';
import { OpenAIProvider, type ModelProvider } from '@openai/agents';
import { aisdk } from '@openai/agents-extensions/ai-sdk';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getAgentModelAccess, loadAgentProviderKey } from './credential';
import {
  isModelAvailable,
  validateModelSelection,
  type AgentModelSelection
} from './policy';

const REQUEST_TIMEOUT_MS = 120_000;

function assertAgentEnabled() {
  if (process.env.PARANOD_AGENT_WORKER_ENABLED !== 'true')
    throw new Error('agent_worker_disabled');
}

export async function getWorkspaceAgentAvailability(workspaceId: string) {
  try {
    assertAgentEnabled();
    const access = await getAgentModelAccess(workspaceId);
    if (!access.providers.length)
      throw new Error('agent_provider_key_not_configured');
    return { available: true, reason: null };
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const allowed = [
      'agent_worker_disabled',
      'agent_provider_key_not_configured'
    ];
    return {
      available: false,
      reason: allowed.includes(code) ? code : 'agent_configuration_unavailable'
    };
  }
}

// Bounds every provider request; the run signal is still honored.
const boundedFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    redirect: 'error',
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

function openAIChat(baseURL: string, apiKey: string, useResponses: boolean) {
  const provider = new OpenAIProvider({
    openAIClient: new OpenAI({
      apiKey,
      baseURL,
      organization: null,
      project: null,
      maxRetries: 0,
      timeout: REQUEST_TIMEOUT_MS
    }),
    useResponses
  });
  return { provider, close: () => provider.close() };
}

// Sonnet 5.5 strict tools reject integer bounds, array maxItems, and minItems
// above 1. Those limits stay in our own validation.
export function relaxAnthropicInit(init?: RequestInit) {
  const text = requestBodyText(init?.body);
  if (!text) return init;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return init;
  }
  if (!parsed || typeof parsed !== 'object' || !('tools' in parsed))
    return init;
  const tools = (parsed as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return init;
  stripIntegerBounds(tools);
  const body = JSON.stringify(parsed);
  const headers = new Headers(init?.headers);
  if (headers.has('content-length'))
    headers.set('content-length', String(Buffer.byteLength(body)));
  return { ...init, headers, body };
}

function requestBodyText(body: BodyInit | null | undefined) {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  return null;
}

function stripIntegerBounds(value: unknown) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) stripIntegerBounds(item);
    return;
  }
  const record = value as Record<string, unknown>;
  const types = Array.isArray(record.type) ? record.type : [record.type];
  if (types.includes('integer')) {
    delete record.minimum;
    delete record.maximum;
    delete record.exclusiveMinimum;
    delete record.exclusiveMaximum;
  }
  if (types.includes('array')) {
    delete record.maxItems;
    if (typeof record.minItems === 'number' && record.minItems > 1)
      delete record.minItems;
  }
  for (const nested of Object.values(record)) stripIntegerBounds(nested);
}

function singleModelProvider(
  modelName: string,
  model: ReturnType<typeof aisdk>
): ModelProvider {
  return {
    getModel(name) {
      if (name !== modelName) throw new Error('agent_model_not_allowed');
      return model;
    }
  };
}

function createProvider(selection: AgentModelSelection, apiKey: string) {
  const { model, providerModelId, reasoning } = selection;
  switch (selection.provider) {
    case 'openai':
      return openAIChat('https://api.openai.com/v1', apiKey, true);
    case 'xai':
      return openAIChat('https://api.x.ai/v1', apiKey, false);
    case 'deepseek':
      return openAIChat('https://api.deepseek.com', apiKey, false);
    case 'moonshot':
      return openAIChat('https://api.moonshot.ai/v1', apiKey, false);
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey,
        baseURL: 'https://api.anthropic.com/v1',
        fetch: (input, init) => boundedFetch(input, relaxAnthropicInit(init))
      });
      return {
        provider: singleModelProvider(model, aisdk(anthropic(providerModelId))),
        close: async () => undefined
      };
    }
    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta',
        fetch: boundedFetch
      });
      return {
        provider: singleModelProvider(model, aisdk(google(providerModelId))),
        close: async () => undefined
      };
    }
    case 'openrouter': {
      const openrouter = createOpenRouter({
        apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
        compatibility: 'strict',
        fetch: boundedFetch
      });
      const chat = openrouter.chat(providerModelId, {
        parallelToolCalls: false,
        // Excluded reasoning keeps raw thoughts out of the event stream.
        reasoning: {
          effort: reasoning === 'max' ? 'xhigh' : reasoning,
          exclude: true
        }
      });
      return {
        provider: singleModelProvider(model, aisdk(chat)),
        close: async () => undefined
      };
    }
  }
}

export async function getWorkspaceAgentProvider(
  workspaceId: string,
  run: { model: string; reasoning: string }
) {
  assertAgentEnabled();
  const selection = validateModelSelection(run.model, run.reasoning);
  const access = await getAgentModelAccess(workspaceId);
  if (!isModelAvailable(selection, access))
    throw new Error('agent_provider_key_not_configured');
  const apiKey = await loadAgentProviderKey(workspaceId, selection.provider);
  if (!apiKey) throw new Error('agent_provider_key_not_configured');
  return createProvider(selection, apiKey);
}
