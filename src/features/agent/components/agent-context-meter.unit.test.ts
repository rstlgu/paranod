import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentContextMeter } from './agent-context-meter';
import { AgentPanelView } from './agent-panel-view';
import type { AgentEvent, AgentRunSummary } from '../lib/contracts';
import * as context from '../lib/context';

afterEach(() => vi.restoreAllMocks());

const run: AgentRunSummary = {
  id: 'run',
  graphId: 'graph',
  graphName: 'Graph',
  goal: 'Investigate',
  model: 'openrouter/vendor/custom-model',
  reasoning: 'low',
  approvalMode: 'guarded',
  status: 'running',
  createdAt: new Date(0).toISOString(),
  endedAt: null
};

function renderMeter(
  props: Partial<ComponentProps<typeof AgentContextMeter>> = {}
) {
  return renderToStaticMarkup(
    createElement(AgentContextMeter, {
      run: null,
      events: [],
      disabled: false,
      ...props
    })
  );
}

function usageEvent(tokens: number, limit: number): AgentEvent {
  return {
    sequence: 1,
    createdAt: run.createdAt,
    data: {
      type: 'usage',
      inputTokens: tokens,
      outputTokens: 0,
      context: {
        tokens,
        limit,
        estimated: false,
        compactions: 0,
        state: 'ready',
        budgetVersion: 2
      }
    }
  };
}

describe('context meter model fallback', () => {
  it.each([
    ['openrouter/vendor/custom-model', 24_000],
    ['gemini-3-flash-lite', 24_000],
    ['gpt-6-astra', 128_000],
    [undefined, 128_000]
  ] as const)(
    'uses the idle selected model %s for its empty budget',
    (selectedModel, limit) => {
      const empty = vi.spyOn(context, 'emptyContextUsage');
      renderMeter({ selectedModel });
      expect(empty).toHaveBeenCalledExactlyOnceWith(selectedModel);
      expect(empty.mock.results[0].value.limit).toBe(limit);
    }
  );

  it('prefers the run model before the first usage event, even if the picker differs', () => {
    const empty = vi.spyOn(context, 'emptyContextUsage');
    renderMeter({ run, selectedModel: 'gpt-6-astra' });
    expect(empty).toHaveBeenCalledExactlyOnceWith(run.model);
    expect(empty.mock.results[0].value.limit).toBe(24_000);
  });

  it('keeps event-reported usage instead of recomputing it from the picker', () => {
    const empty = vi.spyOn(context, 'emptyContextUsage');
    const html = renderMeter({
      run,
      selectedModel: 'gpt-6-astra',
      events: [usageEvent(6000, 24_000)]
    });
    expect(html).toContain('aria-label="Context usage: 25%"');
    expect(empty).not.toHaveBeenCalled();
  });

  it('keeps a manually cleared snapshot ahead of historical events', () => {
    const cleared = {
      ...context.emptyContextUsage(run.model),
      state: 'cleared' as const
    };
    const empty = vi.spyOn(context, 'emptyContextUsage');
    const html = renderMeter({
      run: { ...run, status: 'completed', contextUsage: cleared },
      selectedModel: 'gpt-6-astra',
      events: [usageEvent(6000, 24_000)]
    });
    expect(html).toContain('aria-label="Context usage: 0%"');
    expect(empty).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'receives the composer model after catalog availability resolution (%s)',
    (available) => {
      const empty = vi.spyOn(context, 'emptyContextUsage');
      const noop = () => {};
      const props: ComponentProps<typeof AgentPanelView> = {
        run: null,
        events: [],
        selectedRunId: null,
        context: { id: 'graph', name: 'Graph' },
        catalog: {
          available: true,
          reason: null,
          runs: [],
          models: [
            {
              id: 'gpt-6-astra',
              name: 'GPT-6 Astra',
              provider: 'openai',
              reasoningLevels: ['high'],
              defaultReasoning: 'high',
              available: true
            },
            {
              id: run.model,
              name: 'Custom model',
              provider: 'openrouter',
              reasoningLevels: ['low'],
              defaultReasoning: 'low',
              available
            }
          ]
        },
        modelSelection: { model: run.model, reasoning: 'low' },
        loading: false,
        error: null,
        busy: false,
        draft: '',
        onDraft: noop,
        onClose: noop,
        onSelectRun: noop,
        onArchiveThread: noop,
        onStop: noop,
        onDecision: noop,
        onSubmit: noop,
        onRetry: noop
      };
      renderToStaticMarkup(createElement(AgentPanelView, props));
      expect(empty).toHaveBeenLastCalledWith(
        available ? run.model : 'gpt-6-astra'
      );
      expect(empty.mock.results.at(-1)?.value.limit).toBe(
        available ? 24_000 : 128_000
      );
      renderToStaticMarkup(
        createElement(AgentPanelView, {
          ...props,
          modelSelection: { model: 'gpt-6-astra', reasoning: 'high' }
        })
      );
      expect(empty).toHaveBeenLastCalledWith('gpt-6-astra');
    }
  );
});
