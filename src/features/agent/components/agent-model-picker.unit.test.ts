import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentModelOption } from '../lib/contracts';
import { AgentModelPicker, groupAgentModels } from './agent-model-picker';
import { ProviderMark } from './agent-provider-mark';

function option(
  partial: Pick<AgentModelOption, 'id' | 'name' | 'provider'> &
    Partial<AgentModelOption>
): AgentModelOption {
  return {
    reasoningLevels: ['low', 'high'],
    defaultReasoning: 'high',
    available: true,
    ...partial
  };
}

describe('model menu groups', () => {
  it('keeps two models visible and parks the rest under other models', () => {
    const groups = groupAgentModels(
      [
        option({ id: 'gpt-6-astra', name: 'GPT-6 Astra', provider: 'openai' }),
        option({
          id: 'gpt-6.1-sol',
          name: 'GPT-6.1 Sol',
          provider: 'openai'
        }),
        option({ id: 'gpt-6-sol', name: 'GPT-6 Sol', provider: 'openai' }),
        option({ id: 'gpt-6-luna', name: 'GPT-6 Luna', provider: 'openai' }),
        option({
          id: 'claude-sonnet-5-5',
          name: 'Claude Sonnet 5.5',
          provider: 'anthropic',
          available: false
        }),
        option({
          id: 'claude-opus-5',
          name: 'Claude Opus 5',
          provider: 'anthropic',
          available: false
        })
      ],
      'gpt-6-luna'
    );
    const openai = groups.find((group) => group.provider === 'openai');
    const claude = groups.find((group) => group.provider === 'anthropic');
    expect(openai?.primary.map((model) => model.id)).toEqual([
      'gpt-6-astra',
      'gpt-6.1-sol',
      'gpt-6-luna'
    ]);
    expect(openai?.other.map((model) => model.id)).toEqual(['gpt-6-sol']);
    expect(claude).toMatchObject({
      configured: false,
      primary: [],
      other: []
    });
  });

  it('shows the provider mark on the selected model', () => {
    const html = renderToStaticMarkup(
      createElement(AgentModelPicker, {
        models: [
          option({ id: 'gpt-6-astra', name: 'GPT-6 Astra', provider: 'openai' })
        ],
        value: { model: 'gpt-6-astra', reasoning: 'high' },
        onChange: () => undefined
      })
    );
    expect(html).toContain('<svg');
    expect(html).toContain('GPT-6 Astra');
    expect(html).not.toContain('Reasoning');
  });

  it('flattens colored brand marks to the current text color', () => {
    const html = renderToStaticMarkup(createElement(ProviderMark, { provider: 'google' }));
    expect(html).toContain('flood-color="currentColor"');
    expect(html).toContain('operator="in"');
    expect(html).toContain('#4285F4');
  });
});
