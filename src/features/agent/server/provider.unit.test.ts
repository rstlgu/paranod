import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  key: vi.fn(),
  access: vi.fn(),
  pluginConfig: vi.fn(),
  client: vi.fn(),
  provider: vi.fn(),
  anthropic: vi.fn(),
  google: vi.fn(),
  openrouter: vi.fn(),
  openrouterChat: vi.fn()
}));
vi.mock('./credential', () => ({
  loadAgentProviderKey: mocks.key,
  getAgentModelAccess: mocks.access
}));
vi.mock('@/features/plugins/server-config', () => ({
  loadWorkspacePluginConfig: mocks.pluginConfig
}));
vi.mock('openai', () => ({
  default: class {
    constructor(options: unknown) {
      mocks.client(options);
    }
  }
}));
vi.mock('@openai/agents', () => ({
  OpenAIProvider: class {
    constructor(options: unknown) {
      mocks.provider(options);
    }
    close = async () => {};
  }
}));
vi.mock('@openai/agents-extensions/ai-sdk', () => ({
  aisdk: (model: unknown) => ({ wrapped: model })
}));
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: (options: unknown) => {
    mocks.anthropic(options);
    return (id: string) => ({ id, via: 'anthropic' });
  }
}));
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: (options: unknown) => {
    mocks.google(options);
    return (id: string) => ({ id, via: 'google' });
  }
}));
vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: (options: unknown) => {
    mocks.openrouter(options);
    return {
      chat: (id: string, settings: unknown) => {
        mocks.openrouterChat(id, settings);
        return { id, via: 'openrouter' };
      }
    };
  }
}));
import { getWorkspaceAgentProvider, relaxAnthropicInit } from './provider';

const OPENAI_RUN = { model: 'gpt-5.5', reasoning: 'medium' };
const ALL_ACCESS = {
  providers: [
    'openai',
    'anthropic',
    'google',
    'xai',
    'deepseek',
    'moonshot',
    'openrouter'
  ],
  openrouterModels: ['x-ai/grok-4']
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
function enable() {
  vi.stubEnv('PARANOD_AGENT_WORKER_ENABLED', 'true');
  mocks.access.mockResolvedValue(ALL_ACCESS);
  mocks.key.mockResolvedValue('fixture-not-a-real-key');
}

describe('Anthropic tool payload', () => {
  it('drops schema keywords that Sonnet strict tools reject', () => {
    const relaxed = relaxAnthropicInit({
      body: JSON.stringify({
        tools: [
          {
            input_schema: {
              properties: {
                offset: { type: 'integer', minimum: 0, maximum: 10000 },
                label: { type: 'string', minLength: 1, maxLength: 100 },
                page: {
                  anyOf: [
                    { type: 'integer', minimum: 0, maximum: 10 },
                    { type: 'null' }
                  ]
                },
                nodeIds: {
                  type: 'array',
                  minItems: 2,
                  maxItems: 100,
                  items: { type: 'string', minLength: 1, maxLength: 200 }
                },
                one: { type: 'array', minItems: 1, items: { type: 'string' } }
              }
            }
          }
        ]
      })
    });
    const properties = JSON.parse(String(relaxed?.body)).tools[0].input_schema
      .properties;
    expect(properties.offset).toEqual({ type: 'integer' });
    expect(properties.label).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 100
    });
    expect(properties.page.anyOf[0]).toEqual({ type: 'integer' });
    expect(properties.nodeIds).toEqual({
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 200 }
    });
    expect(properties.one.minItems).toBe(1);
    expect(relaxAnthropicInit({ body: 'not-json' })?.body).toBe('not-json');
  });
});

describe('agent provider boundary', () => {
  it('is off by default and never resolves a key', async () => {
    vi.stubEnv('PARANOD_AGENT_WORKER_ENABLED', 'false');
    await expect(
      getWorkspaceAgentProvider('workspace', OPENAI_RUN)
    ).rejects.toThrow('agent_worker_disabled');
    expect(mocks.key).not.toHaveBeenCalled();
  });
  it('uses only the dedicated agent key and official Responses endpoint', async () => {
    enable();
    vi.stubEnv('OPENAI_BASE_URL', 'https://untrusted.invalid/');
    await getWorkspaceAgentProvider('pinned-workspace', OPENAI_RUN);
    expect(mocks.key).toHaveBeenCalledWith('pinned-workspace', 'openai');
    expect(mocks.pluginConfig).not.toHaveBeenCalled();
    expect(mocks.client).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'fixture-not-a-real-key',
        baseURL: 'https://api.openai.com/v1',
        maxRetries: 0,
        organization: null,
        project: null
      })
    );
    expect(mocks.provider).toHaveBeenCalledWith(
      expect.objectContaining({ useResponses: true })
    );
  });
  it('pins Grok, DeepSeek and Kimi to official chat endpoints', async () => {
    enable();
    vi.stubEnv('XAI_BASE_URL', 'https://untrusted.invalid/');
    vi.stubEnv('DEEPSEEK_BASE_URL', 'https://untrusted.invalid/');
    vi.stubEnv('MOONSHOT_BASE_URL', 'https://untrusted.invalid/');
    await getWorkspaceAgentProvider('ws', {
      model: 'grok-4.7',
      reasoning: 'high'
    });
    expect(mocks.key).toHaveBeenCalledWith('ws', 'xai');
    expect(mocks.client).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://api.x.ai/v1' })
    );
    expect(mocks.provider).toHaveBeenCalledWith(
      expect.objectContaining({ useResponses: false })
    );
    await getWorkspaceAgentProvider('ws', {
      model: 'deepseek-flash',
      reasoning: 'none'
    });
    expect(mocks.client).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://api.deepseek.com' })
    );
    await getWorkspaceAgentProvider('ws', {
      model: 'kimi-k3',
      reasoning: 'high'
    });
    expect(mocks.client).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://api.moonshot.ai/v1' })
    );
  });
  it('routes Claude and Gemini through pinned official endpoints', async () => {
    enable();
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://untrusted.invalid/');
    const claude = await getWorkspaceAgentProvider('ws', {
      model: 'claude-opus-5-5',
      reasoning: 'high'
    });
    expect(mocks.key).toHaveBeenCalledWith('ws', 'anthropic');
    expect(mocks.anthropic).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://api.anthropic.com/v1' })
    );
    expect(await claude.provider.getModel('claude-opus-5-5')).toEqual({
      wrapped: { id: 'claude-opus-5-5', via: 'anthropic' }
    });
    expect(() => claude.provider.getModel('gpt-5.5')).toThrow(
      'agent_model_not_allowed'
    );
    await getWorkspaceAgentProvider('ws', {
      model: 'gemini-3.8-flash',
      reasoning: 'medium'
    });
    expect(mocks.google).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://generativelanguage.googleapis.com/v1beta'
      })
    );
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('runs only admin-approved OpenRouter models with hidden reasoning', async () => {
    enable();
    await getWorkspaceAgentProvider('ws', {
      model: 'openrouter/x-ai/grok-4',
      reasoning: 'high'
    });
    expect(mocks.openrouter).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://openrouter.ai/api/v1' })
    );
    expect(mocks.openrouterChat).toHaveBeenCalledWith('x-ai/grok-4', {
      parallelToolCalls: false,
      reasoning: { effort: 'high', exclude: true }
    });
    await expect(
      getWorkspaceAgentProvider('ws', {
        model: 'openrouter/deepseek/deepseek-chat',
        reasoning: 'medium'
      })
    ).rejects.toThrow('agent_provider_key_not_configured');
  });
  it('does not fall back to an environment key or a plugin config', async () => {
    enable();
    vi.stubEnv('OPENAI_API_KEY', 'fixture-global-key');
    mocks.pluginConfig.mockResolvedValue({
      provider: 'openai',
      apiKey: 'fixture-ai-analysis-key'
    });
    mocks.access.mockResolvedValue({ providers: [], openrouterModels: [] });
    mocks.key.mockResolvedValue(null);
    await expect(
      getWorkspaceAgentProvider('workspace', OPENAI_RUN)
    ).rejects.toThrow('agent_provider_key_not_configured');
    expect(mocks.pluginConfig).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });
});
