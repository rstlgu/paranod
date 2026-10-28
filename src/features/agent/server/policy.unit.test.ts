import { describe, expect, it } from 'vitest';
import {
  agentModelCatalog,
  isModelAvailable,
  publicText,
  resolveModelSelection,
  validateModelSelection,
  type AgentModelAccess
} from './policy';
import { agentModelSettings } from './model-settings';

const NONE: AgentModelAccess = { providers: [], openrouterModels: [] };
const OPENAI: AgentModelAccess = {
  providers: ['openai'],
  openrouterModels: []
};

describe('agent model selection', () => {
  it('resolves Auto to a concrete model deterministically per configuration', () => {
    const first = resolveModelSelection('auto', 'auto', OPENAI);
    expect(first).toEqual(resolveModelSelection('auto', 'anything', OPENAI));
    expect(first.model).toBe('gpt-5.5');
    expect(
      resolveModelSelection('auto', 'auto', {
        providers: ['anthropic', 'google'],
        openrouterModels: []
      })
    ).toMatchObject({ model: 'claude-sonnet-5-5', provider: 'anthropic' });
    expect(
      resolveModelSelection('auto', 'auto', {
        providers: ['xai'],
        openrouterModels: []
      })
    ).toMatchObject({ model: 'grok-4.7', provider: 'xai', reasoning: 'high' });
    expect(validateModelSelection('deepseek-flash', 'none')).toMatchObject({
      provider: 'deepseek',
      providerModelId: 'deepseek-flash'
    });
    expect(validateModelSelection('kimi-k3', 'high')).toMatchObject({
      provider: 'moonshot'
    });
    expect(() => validateModelSelection('kimi-k2.6', 'high')).toThrow(
      'agent_model_not_allowed'
    );
    expect(
      resolveModelSelection('auto', 'auto', {
        providers: ['openrouter'],
        openrouterModels: ['x-ai/grok-4']
      })
    ).toMatchObject({
      model: 'openrouter/x-ai/grok-4',
      providerModelId: 'x-ai/grok-4'
    });
    expect(() => validateModelSelection('auto', 'auto')).toThrow(
      'agent_model_not_allowed'
    );
  });
  it('accepts every supported provider but only well-formed OpenRouter slugs', () => {
    expect(validateModelSelection('claude-opus-5-5', 'max')).toMatchObject({
      provider: 'anthropic'
    });
    expect(
      validateModelSelection('gemini-3.1-pro-preview', 'high')
    ).toMatchObject({ provider: 'google' });
    for (const model of [
      'openrouter/X-AI/grok-4',
      'openrouter/../grok',
      'openrouter/grok',
      'unknown-model'
    ])
      expect(() => validateModelSelection(model, 'medium')).toThrow(
        'agent_model_not_allowed'
      );
  });
  it('rejects reasoning levels outside the chosen model', () => {
    expect(() => resolveModelSelection('gpt-5.5', 'max', OPENAI)).toThrow(
      'agent_model_not_allowed'
    );
    expect(() =>
      resolveModelSelection('gpt-6.1-sol', 'none', OPENAI)
    ).toThrow('agent_model_not_allowed');
    expect(validateModelSelection('gpt-6-luna', 'low')).toMatchObject({
      provider: 'openai',
      providerModelId: 'gpt-6-luna'
    });
    expect(validateModelSelection('claude-sonnet-5-5', 'high')).toMatchObject({
      provider: 'anthropic',
      providerModelId: 'claude-sonnet-5-5'
    });
    expect(validateModelSelection('gemini-3-flash-lite', 'none')).toMatchObject(
      {
        provider: 'google'
      }
    );
    expect(resolveModelSelection('gpt-6-astra', 'max', OPENAI)).toEqual({
      model: 'gpt-6-astra',
      reasoning: 'max',
      provider: 'openai',
      providerModelId: 'gpt-6-astra'
    });
  });
  it('marks models available only when their provider is configured', () => {
    const catalog = agentModelCatalog({
      providers: ['anthropic', 'openrouter'],
      openrouterModels: ['x-ai/grok-4']
    });
    expect(catalog[0]?.id).not.toBe('auto');
    expect(catalog.some((option) => option.id === 'auto')).toBe(false);
    for (const option of catalog)
      expect(option.available).toBe(
        ['anthropic', 'openrouter'].includes(option.provider)
      );
    expect(catalog.map((option) => option.id)).toContain(
      'openrouter/x-ai/grok-4'
    );
    for (const option of catalog)
      expect(option.reasoningLevels).toContain(option.defaultReasoning);
    expect(agentModelCatalog(NONE).every((option) => !option.available)).toBe(
      true
    );
    expect(
      isModelAvailable(
        { provider: 'openrouter', providerModelId: 'deepseek/deepseek-chat' },
        { providers: ['openrouter'], openrouterModels: ['x-ai/grok-4'] }
      )
    ).toBe(false);
  });
});

describe('provider model settings', () => {
  it('keeps OpenAI summaries and never asks others for raw thoughts', () => {
    expect(
      agentModelSettings({ provider: 'openai', reasoning: 'high' })
    ).toMatchObject({
      store: false,
      parallelToolCalls: false,
      reasoning: { effort: 'high', summary: 'auto' }
    });
    expect(
      agentModelSettings({ provider: 'anthropic', reasoning: 'xhigh' })
        .providerData
    ).toEqual({
      providerOptions: {
        anthropic: {
          disableParallelToolUse: true,
          sendReasoning: true,
          thinking: { type: 'adaptive', display: 'omitted' },
          effort: 'xhigh'
        }
      }
    });
    expect(
      agentModelSettings({ provider: 'anthropic', reasoning: 'none' })
        .providerData?.providerOptions.anthropic.thinking
    ).toEqual({ type: 'disabled' });
    expect(
      agentModelSettings({ provider: 'google', reasoning: 'low' }).providerData
    ).toEqual({
      providerOptions: {
        google: {
          thinkingConfig: { thinkingLevel: 'low', includeThoughts: false }
        }
      }
    });
    expect(
      agentModelSettings({ provider: 'xai', reasoning: 'high' })
    ).toMatchObject({
      parallelToolCalls: false,
      reasoning: { effort: 'high' }
    });
    expect(
      agentModelSettings({ provider: 'deepseek', reasoning: 'none' })
    ).toEqual({
      maxTokens: 8192,
      timeoutMs: 120_000,
      retry: { maxRetries: 0 },
      parallelToolCalls: false,
      providerData: { thinking: { type: 'disabled' } }
    });
    expect(
      agentModelSettings({ provider: 'moonshot', reasoning: 'none' })
    ).not.toHaveProperty('reasoning');
    expect(
      agentModelSettings({ provider: 'moonshot', reasoning: 'high' })
    ).toMatchObject({ reasoning: { effort: 'high' } });
  });
  it('redacts provider keys from public text', () => {
    expect(
      publicText(
        'a sk-ant-api03-abcdefghijklmnop b AIzaSyA1234567890abcdefghijklmnopqrstu c xai-abcdefghijklmnop d'
      )
    ).toBe('a [redacted] b [redacted] c [redacted] d');
  });
});
