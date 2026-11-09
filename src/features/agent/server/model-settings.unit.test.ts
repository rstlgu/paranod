import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Agent, Runner, tool, type Model } from '@openai/agents';
import { aisdk } from '@openai/agents-extensions/ai-sdk';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { agentModelSettings } from './model-settings';
import type { AgentModelSelection } from './policy';

interface Captured {
  url: string;
  body: Record<string, unknown>;
}

function capture(reply: unknown) {
  const requests: Captured[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json(reply);
  };
  return { requests, fetch };
}

async function runOnce(
  model: Model,
  selection: Pick<AgentModelSelection, 'provider' | 'reasoning'>
) {
  const runner = new Runner({
    modelProvider: { getModel: () => model },
    tracingDisabled: true,
    modelSettings: agentModelSettings(selection)
  });
  const agent = new Agent({
    name: 'fixture',
    instructions: 'fixture',
    model: 'fixture',
    tools: [
      tool({
        name: 'noop',
        description: 'noop',
        parameters: z.object({}).strict(),
        execute: async () => 'ok'
      })
    ]
  });
  return runner.run(agent, 'hello');
}

describe('provider wire requests', () => {
  it('sends Claude effort with hidden adaptive thinking and serial tools', async () => {
    const { requests, fetch } = capture({
      id: 'msg_fixture',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 }
    });
    const anthropic = createAnthropic({
      apiKey: 'fixture',
      baseURL: 'https://api.anthropic.com/v1',
      fetch
    });
    const result = await runOnce(aisdk(anthropic('claude-opus-5-5')), {
      provider: 'anthropic',
      reasoning: 'high'
    });
    expect(result.finalOutput).toBe('ok');
    expect(requests[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(requests[0]?.body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 8192,
      thinking: { type: 'adaptive', display: 'omitted' },
      output_config: { effort: 'high' },
      tool_choice: { type: 'auto', disable_parallel_tool_use: true }
    });
  });

  it('sends Gemini thinking level without thoughts', async () => {
    const { requests, fetch } = capture({
      candidates: [
        {
          content: { role: 'model', parts: [{ text: 'ok' }] },
          finishReason: 'STOP'
        }
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
    });
    const google = createGoogleGenerativeAI({
      apiKey: 'fixture',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      fetch
    });
    await runOnce(aisdk(google('gemini-3.8-flash')), {
      provider: 'google',
      reasoning: 'low'
    });
    expect(requests[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'
    );
    expect(requests[0]?.body).toMatchObject({
      generationConfig: {
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingLevel: 'low', includeThoughts: false }
      }
    });
  });

  it('sends OpenRouter reasoning excluded and parallel tools disabled', async () => {
    const { requests, fetch } = capture({
      id: 'gen_fixture',
      model: 'x-ai/grok-4',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop'
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    });
    const openrouter = createOpenRouter({
      apiKey: 'fixture',
      baseURL: 'https://openrouter.ai/api/v1',
      compatibility: 'strict',
      fetch
    });
    const chat = openrouter.chat('x-ai/grok-4', {
      parallelToolCalls: false,
      reasoning: { effort: 'medium', exclude: true }
    });
    await runOnce(aisdk(chat), { provider: 'openrouter', reasoning: 'medium' });
    expect(requests[0]?.url).toBe(
      'https://openrouter.ai/api/v1/chat/completions'
    );
    expect(requests[0]?.body).toMatchObject({
      model: 'x-ai/grok-4',
      parallel_tool_calls: false,
      reasoning: { effort: 'medium', exclude: true }
    });
  });
});
