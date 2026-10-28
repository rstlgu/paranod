import type { ModelSettings } from '@openai/agents';
import { AGENT_LIMITS, type AgentModelSelection } from './policy';

// The AI SDK adapter ignores `reasoning`/`parallelToolCalls` and forwards
// `providerData` verbatim, so non-OpenAI knobs go through providerOptions.
// Raw thoughts are never requested: only OpenAI returns public summaries.
export function agentModelSettings(
  selection: Pick<AgentModelSelection, 'provider' | 'reasoning'>
): ModelSettings {
  const base = {
    maxTokens: AGENT_LIMITS.maxOutputTokens,
    timeoutMs: 120_000,
    retry: { maxRetries: 0 }
  };
  const { reasoning } = selection;
  switch (selection.provider) {
    case 'openai':
      return {
        ...base,
        store: false,
        parallelToolCalls: false,
        reasoning: { effort: reasoning, summary: 'auto' }
      };
    case 'anthropic':
      return {
        ...base,
        providerData: {
          providerOptions: {
            anthropic: {
              disableParallelToolUse: true,
              sendReasoning: true,
              ...(reasoning === 'none'
                ? { thinking: { type: 'disabled' } }
                : {
                    thinking: { type: 'adaptive', display: 'omitted' },
                    effort: reasoning
                  })
            }
          }
        }
      };
    case 'google':
      return {
        ...base,
        providerData: {
          providerOptions: {
            google: {
              thinkingConfig: {
                thinkingLevel: reasoning,
                includeThoughts: false
              }
            }
          }
        }
      };
    case 'xai':
      return {
        ...base,
        parallelToolCalls: false,
        reasoning: { effort: reasoning }
      };
    case 'deepseek':
      // Thinking stays off. Tool turns must echo reasoning_content, and the
      // chat adapter does not, so an enabled chain of thought fails the run.
      return {
        ...base,
        parallelToolCalls: false,
        providerData: { thinking: { type: 'disabled' } }
      };
    case 'moonshot':
      return {
        ...base,
        parallelToolCalls: false,
        ...(reasoning === 'none' ? {} : { reasoning: { effort: reasoning } })
      };
    case 'openrouter':
      // Reasoning and tool parallelism are fixed when the model is created.
      return base;
  }
}
