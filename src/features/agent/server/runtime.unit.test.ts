import { describe, expect, it, vi } from 'vitest';
import {
  type Model,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type protocol
} from '@openai/agents';
import {
  listModulesPage,
  listModulesSchema,
  runInvestigation,
  type AgentRuntimePort
} from './runtime';
import { z } from 'zod';
import type { AgentApprovalMode, AgentEventData } from '../lib/contracts';
import { AGENT_CONTEXT_LIMIT } from '../lib/context';
import {
  AGENT_LIMITS,
  argumentsHash,
  publicText,
  seedIsInGoal,
  validateModelSelection
} from './policy';

type ModelOutput =
  protocol.StreamEventResponseCompleted['response']['output'][number];
function modelWith(outputs: ModelOutput[][], tokensPerCall: number[] = []) {
  const requests: ModelRequest[] = [];
  let index = 0;
  const model: Model = {
    getResponse: async (): Promise<ModelResponse> => {
      throw new Error('streaming_required');
    },
    async *getStreamedResponse(request) {
      requests.push(request);
      const output = outputs[index++];
      if (!output) throw new Error('unexpected_model_call');
      yield { type: 'response_started' };
      yield {
        type: 'response_done',
        response: {
          id: `response-${index}`,
          output,
          usage: {
            inputTokens: (tokensPerCall[index - 1] ?? 30) - 10,
            outputTokens: 10,
            totalTokens: tokensPerCall[index - 1] ?? 30
          }
        }
      };
    }
  };
  return {
    requests,
    provider: { getModel: () => model } satisfies ModelProvider
  };
}
const call = (name: string, args: object, callId = 'call-1'): ModelOutput => ({
  type: 'function_call',
  name,
  callId,
  arguments: JSON.stringify(args)
});
const message = (text = 'Operazione completata.'): ModelOutput => ({
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text }]
});
function fixture(
  outputs: ModelOutput[][],
  approvalMode?: AgentApprovalMode,
  tokensPerCall?: number[]
) {
  const model = modelWith(outputs, tokensPerCall);
  const events: AgentEventData[] = [];
  const port: AgentRuntimePort = {
    saveContextCheckpoint: vi.fn(async () => undefined),
    assertActive: vi.fn(async () => undefined),
    publish: vi.fn(async (event) => {
      events.push(event);
    }),
    readGraph: vi.fn(async () => ({ nodes: [] })),
    listModules: vi.fn(async () => ({ modules: [] })),
    describeModule: vi.fn(async () => ({
      moduleId: 'dns-lookup',
      transformId: 'dns-resolve-a',
      executable: true
    })),
    addSeed: vi.fn(async () => ({ nodeId: 'new-node' })),
    addHypothesis: vi.fn(async () => ({ edgesAdded: 1 })),
    deleteNodes: vi.fn(async () => ({ nodesRemoved: 1, edgesRemoved: 0 })),
    mergeNodes: vi.fn(async () => ({
      mergedNodeId: 'merged-node',
      nodeType: 'domain',
      nodesMerged: 2
    })),
    prepareTransform: vi.fn(async () => ({
      fingerprint: 'pinned-manifest-and-target',
      requiresApproval: true,
      destination: 'example.test',
      summary: 'Inviare il dominio example.test al modulo esterno?'
    })),
    executeTransform: vi.fn(async () => ({ nodesAdded: 1 })),
    waitForDecision: vi.fn(async () => true)
  };
  const abort = new AbortController();
  return {
    ...model,
    events,
    port,
    abort,
    run: (
      extra: Partial<
        Pick<
          Parameters<typeof runInvestigation>[0],
          'history' | 'contextSummary' | 'contextGoals' | 'model' | 'reasoning'
        >
      > = {}
    ) =>
      runInvestigation({
        runId: 'run-test',
        model: 'gpt-6-astra',
        reasoning: 'high',
        goal: 'Analizza example.test',
        approvalMode,
        provider: model.provider,
        port,
        signal: abort.signal,
        ...extra
      })
  };
}

describe('real Agents SDK runtime with a deterministic model (no API)', () => {
  it('keeps a large follow-up intact and continues tools past the old run budget', async () => {
    const f = fixture(
      [
        [call('read_graph', { offset: 0 }, 'read-long')],
        [call('list_modules', { inputType: 'domain' }, 'list-long')],
        [message('Finished with the earlier evidence.')]
      ],
      'auto',
      [90_000, 90_000, 90_000]
    );
    const history = Array.from({ length: 60 }, (_, i) => ({
      runId: `old-${i}`,
      goal: `Goal ${i}`,
      messages: [`${'evidence '.repeat(450)}TAIL-${i}`]
    }));
    const result = await f.run({ history });
    expect(result.inputTokens + result.outputTokens).toBe(270_000);
    expect(f.requests).toHaveLength(3);
    expect(JSON.stringify(f.requests[0].input).length).toBeGreaterThan(160_000);
    for (const request of f.requests) {
      expect(request.tools.length).toBeGreaterThan(0);
      expect(JSON.stringify(request.input)).toContain('TAIL-0');
      expect(JSON.stringify(request.input)).toContain('TAIL-59');
    }
    expect(f.port.saveContextCheckpoint).not.toHaveBeenCalled();
    expect(f.events).toContainEqual(
      expect.objectContaining({
        type: 'usage',
        context: expect.objectContaining({
          limit: AGENT_CONTEXT_LIMIT,
          estimated: false
        })
      })
    );
  });

  it('preserves all configured providers and keeps unknown OpenRouter models bounded', async () => {
    for (const [model, reasoning, limit] of [
      ['gpt-6-luna', 'low', 128_000],
      ['claude-sonnet-5-5', 'high', 128_000],
      ['gemini-3.8-flash', 'medium', 128_000],
      ['gemini-3-flash-lite', 'low', 24_000],
      ['openrouter/vendor/custom-model', 'low', 24_000]
    ] as const) {
      const f = fixture([[message()]]);
      await f.run({ model, reasoning });
      expect(f.events).toContainEqual(
        expect.objectContaining({
          type: 'usage',
          context: expect.objectContaining({ limit, budgetVersion: 2 })
        })
      );
    }
  });

  it('compacts Unicode-heavy history by tokens rather than character count', async () => {
    const f = fixture([
      [message('Memory one')],
      [message('Memory two')],
      [message('Done')]
    ]);
    await f.run({
      history: [
        { runId: 'old', goal: 'Original', messages: ['語'.repeat(110_000)] }
      ]
    });
    expect(f.requests).toHaveLength(3);
    expect(
      f.requests.slice(0, 2).every((request) => request.tools.length === 0)
    ).toBe(true);
    expect(f.port.saveContextCheckpoint).toHaveBeenCalledOnce();
  });

  it('discovers and loads tools on demand without preloading their catalog', async () => {
    const f = fixture([
      [
        call(
          'list_modules',
          { inputType: 'domain', query: 'dns', offset: 0 },
          'search1'
        )
      ],
      [
        call(
          'list_modules',
          { inputType: 'domain', query: 'dns', offset: 0 },
          'search2'
        )
      ],
      [
        call(
          'describe_module',
          {
            inputType: 'domain',
            moduleId: 'dns-lookup',
            transformId: 'dns-resolve-a'
          },
          'details'
        )
      ],
      [message('DNS tool loaded.')]
    ]);
    vi.mocked(f.port.listModules).mockResolvedValue({
      modules: [{ name: 'Unique catalog result' }]
    });
    await f.run();
    expect(JSON.stringify(f.requests[0].input)).not.toContain(
      'Unique catalog result'
    );
    expect(f.port.listModules).toHaveBeenCalledWith('domain', 'dns', 0);
    expect(f.port.describeModule).toHaveBeenCalledWith(
      'domain',
      'dns-lookup',
      'dns-resolve-a'
    );
    const context = JSON.stringify(f.requests[2].input);
    expect(context.match(/Unique catalog result/g)).toHaveLength(1);
    expect(context).toContain('Older list_modules catalog data omitted');
    expect(f.events).toContainEqual(
      expect.objectContaining({
        type: 'tool',
        name: 'describe_module',
        status: 'completed'
      })
    );
    expect(f.port.prepareTransform).not.toHaveBeenCalled();
  });

  it('accepts a page request that uses nextOffset and ignores extra fields', async () => {
    const f = fixture([
      [
        call(
          'list_modules',
          { inputType: 'domain', query: null, nextOffset: 20, executable: false },
          'page'
        )
      ],
      [message('Next page loaded.')]
    ]);
    await f.run();
    expect(f.port.listModules).toHaveBeenCalledWith('domain', '', 20);
    expect(f.events).toContainEqual(
      expect.objectContaining({
        type: 'tool',
        name: 'list_modules',
        status: 'completed'
      })
    );
    expect(listModulesPage(0, 20)).toBe(0);
    expect(listModulesPage(null, null)).toBe(0);
    expect(listModulesSchema.safeParse({ inputType: 'domain' }).success).toBe(
      true
    );
  });
  it('reports provider token usage during a run and includes compaction cost', async () => {
    const f = fixture(
      [[message('Short memory')], [message('Short memory')], [message('Done')]],
      'auto'
    );
    const usage = await f.run({
      history: [
        {
          runId: 'old',
          goal: 'Analyze example.test',
          messages: [`${'x'.repeat(330_000)}IMPORTANT TAIL`]
        }
      ]
    });
    expect(usage).toEqual({ inputTokens: 60, outputTokens: 30 });
    expect(f.port.saveContextCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'compacted',
        includesRun: false,
        goals: ['Analyze example.test']
      })
    );
    expect(f.events).toContainEqual(
      expect.objectContaining({
        type: 'usage',
        inputTokens: 60,
        outputTokens: 30
      })
    );
    expect(JSON.stringify(f.requests.at(-1)?.input)).not.toContain(
      'x'.repeat(100)
    );
    expect(
      f.requests.slice(0, 2).every((request) => request.tools.length === 0)
    ).toBe(true);
    expect(JSON.stringify(f.requests[1].input)).toContain('IMPORTANT TAIL');
  });

  it('does not replace a checkpoint when compaction fails', async () => {
    const f = fixture([[message('')]]);
    await expect(
      f.run({
        history: [
          {
            runId: 'old',
            goal: 'Original target',
            messages: ['x'.repeat(330_000)]
          }
        ]
      })
    ).rejects.toThrow('agent_compaction_failed');
    expect(f.port.saveContextCheckpoint).not.toHaveBeenCalled();
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].tools).toEqual([]);
    expect(f.events).toContainEqual(
      expect.objectContaining({
        type: 'tool',
        name: 'compact_context',
        status: 'failed'
      })
    );
    expect(f.events.at(-1)).toMatchObject({
      type: 'usage',
      inputTokens: 20,
      outputTokens: 10,
      context: { state: 'ready', limit: AGENT_CONTEXT_LIMIT }
    });
  });

  it('automatically compacts large tool results and continues without replaying tools', async () => {
    const f = fixture(
      [
        [call('read_graph', { offset: 0 })],
        [message('Memory: example.test node seed, do not rerun read_graph.')],
        [message('Memory: example.test node seed, do not rerun read_graph.')],
        [call('list_modules', { inputType: 'domain' }, 'next')],
        [message('Completed after compaction.')]
      ],
      'auto'
    );
    vi.mocked(f.port.readGraph).mockResolvedValue({
      nodes: [{ id: 'seed', value: 'x'.repeat(320_000) }]
    });
    await f.run();
    expect(f.port.readGraph).toHaveBeenCalledOnce();
    expect(f.port.listModules).toHaveBeenCalledOnce();
    expect(f.requests).toHaveLength(5);
    expect(JSON.stringify(f.requests.at(-1)?.input).length).toBeLessThan(
      10_000
    );
    expect(f.events).toContainEqual(
      expect.objectContaining({
        type: 'message',
        text: 'Completed after compaction.'
      })
    );
    expect(f.port.saveContextCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'compacted',
        includesRun: false,
        summary: expect.stringContaining('node seed')
      })
    );
  });
  it('keeps approval bookkeeping through compaction without replaying completed calls', async () => {
    const args = { nodeIds: ['old-node'], reason: 'Remove duplicate' };
    const f = fixture(
      [
        [call('read_graph', { offset: 0 })],
        [message('Memory: old-node is a duplicate, awaiting cleanup.')],
        [message('Memory: old-node is a duplicate, awaiting cleanup.')],
        [call('delete_nodes', args, 'delete-after-compaction')],
        [message('Duplicate removed.')]
      ],
      'guarded'
    );
    vi.mocked(f.port.readGraph).mockResolvedValue({
      nodes: [{ id: 'old-node', value: 'x'.repeat(320_000) }]
    });
    await f.run();
    expect(f.port.readGraph).toHaveBeenCalledOnce();
    expect(f.port.waitForDecision).toHaveBeenCalledOnce();
    expect(f.port.deleteNodes).toHaveBeenCalledExactlyOnceWith(args);
    expect(f.requests).toHaveLength(5);
  });

  it.each(['auto', 'guarded', 'ask'] as const)(
    'deletes nodes using the %s approval policy',
    async (mode) => {
      const args = { nodeIds: ['old-node'], reason: 'Remove duplicate' };
      const f = fixture(
        [[call('delete_nodes', args)], [message('Nodo eliminato.')]],
        mode
      );
      await f.run();
      expect(f.port.deleteNodes).toHaveBeenCalledWith(args);
      expect(f.port.waitForDecision).toHaveBeenCalledTimes(
        mode === 'auto' ? 0 : 1
      );
      expect(f.events).toContainEqual(
        expect.objectContaining({
          type: 'tool',
          name: 'delete_nodes',
          status: 'completed'
        })
      );
      expect(f.events).toContainEqual(
        expect.objectContaining({ type: 'message', text: 'Nodo eliminato.' })
      );
    }
  );

  it.each(['auto', 'guarded', 'ask'] as const)(
    'merges same-type nodes using the %s approval policy',
    async (mode) => {
      const args = {
        nodeIds: ['a', 'b'],
        primaryNodeId: 'a',
        reason: 'Duplicate domains'
      };
      const f = fixture(
        [[call('merge_nodes', args)], [message('Nodi uniti.')]],
        mode
      );
      await f.run();
      expect(f.port.mergeNodes).toHaveBeenCalledWith(args);
      expect(f.port.waitForDecision).toHaveBeenCalledTimes(
        mode === 'auto' ? 0 : 1
      );
      expect(f.events).toContainEqual(
        expect.objectContaining({
          type: 'tool',
          name: 'merge_nodes',
          status: 'completed'
        })
      );
    }
  );

  it('does not delete when the user rejects the operation', async () => {
    const f = fixture(
      [
        [call('delete_nodes', { nodeIds: ['old-node'], reason: 'Cleanup' })],
        [message('Eliminazione annullata.')]
      ],
      'guarded'
    );
    vi.mocked(f.port.waitForDecision).mockResolvedValue(false);
    await f.run();
    expect(f.port.deleteNodes).not.toHaveBeenCalled();
  });

  it('still answers when deletion fails because a target is unavailable', async () => {
    const f = fixture(
      [
        [call('delete_nodes', { nodeIds: ['missing'], reason: 'Cleanup' })],
        [message('Il nodo non è disponibile.')]
      ],
      'auto'
    );
    vi.mocked(f.port.deleteNodes).mockRejectedValue(
      new Error('agent_node_unavailable')
    );
    await f.run();
    expect(f.events).toContainEqual(
      expect.objectContaining({
        type: 'tool',
        name: 'delete_nodes',
        status: 'failed'
      })
    );
    expect(f.events).toContainEqual(
      expect.objectContaining({
        type: 'message',
        text: 'Il nodo non è disponibile.'
      })
    );
  });
  it('executes tools and publishes real activity without storing provider state', async () => {
    const f = fixture([[call('read_graph', { offset: 0 })], [message()]]);
    const usage = await f.run();
    expect(usage).toEqual({ inputTokens: 40, outputTokens: 20 });
    expect(f.port.readGraph).toHaveBeenCalledOnce();
    expect(
      f.events
        .filter((event) => event.type === 'tool')
        .map((event) => event.status)
    ).toEqual(['running', 'completed']);
    expect(f.events.some((event) => event.type === 'message')).toBe(true);
    expect(f.requests[0].modelSettings).toMatchObject({
      store: false,
      parallelToolCalls: false,
      reasoning: { effort: 'high' }
    });
    expect(f.requests[0].tracing).toBe(false);
    expect(JSON.stringify(f.events)).not.toContain('response-');
  });

  it('does not publish thinking, reasoning summaries or private provider data', async () => {
    const f = fixture([
      [
        {
          type: 'reasoning',
          content: [{ type: 'input_text', text: 'Controllo le fonti.' }],
          rawContent: [
            { type: 'reasoning_text', text: 'PRIVATE INTERNAL REASONING' }
          ],
          providerData: { encrypted_content: 'PRIVATE PROVIDER STATE' }
        },
        message()
      ]
    ]);
    await f.run();
    expect(JSON.stringify(f.events)).not.toContain('Controllo le fonti.');
    expect(
      f.events.some(
        (event) => event.type === 'phase' && event.phase === 'thinking'
      )
    ).toBe(false);
    expect(JSON.stringify(f.events)).not.toContain('PRIVATE');
  });

  it.each([true, false])(
    'binds approval to one exact relationship; approved=%s',
    async (approved) => {
      const link = {
        sourceId: 'node-a',
        targetId: 'node-b',
        hypothesis: 'Possibile relazione da verificare'
      };
      const f = fixture([[call('propose_relationship', link)], [message()]]);
      f.port.waitForDecision = vi.fn(async () => {
        expect(f.port.addHypothesis).not.toHaveBeenCalled();
        return approved;
      });
      await f.run();
      expect(f.port.addHypothesis).toHaveBeenCalledTimes(approved ? 1 : 0);
      const approval = f.events.find((event) => event.type === 'approval');
      expect(approval?.type === 'approval' && approval.argumentsHash).toBe(
        argumentsHash({
          runId: 'run-test',
          name: 'propose_relationship',
          arguments: link
        })
      );
      expect(f.port.waitForDecision).toHaveBeenCalledOnce();
    }
  );

  it('pins external transform approval to the descriptor fingerprint', async () => {
    const args = { moduleId: 'sample', transformId: 'test', nodeId: 'node' };
    const f = fixture([[call('run_transform', args)], [message()]]);
    await f.run();
    expect(f.port.executeTransform).toHaveBeenCalledWith(
      args,
      'pinned-manifest-and-target',
      expect.any(AbortSignal)
    );
    const approval = f.events.find((event) => event.type === 'approval');
    expect(approval?.type === 'approval' && approval.argumentsHash).toBe(
      argumentsHash({
        runId: 'run-test',
        name: 'run_transform',
        arguments: args,
        fingerprint: 'pinned-manifest-and-target'
      })
    );
  });

  it('asks before adding a seed only in ask-every-time mode', async () => {
    const seed = { type: 'domain', value: 'example.test' };
    const guarded = fixture([[call('add_seed', seed)], [message()]]);
    await guarded.run();
    expect(guarded.port.waitForDecision).not.toHaveBeenCalled();
    expect(guarded.port.addSeed).toHaveBeenCalledOnce();
    const ask = fixture([[call('add_seed', seed)], [message()]], 'ask');
    ask.port.waitForDecision = vi.fn(async () => {
      expect(ask.port.addSeed).not.toHaveBeenCalled();
      return false;
    });
    await ask.run();
    expect(ask.port.addSeed).not.toHaveBeenCalled();
    const approval = ask.events.find((event) => event.type === 'approval');
    expect(approval).toMatchObject({
      tool: 'add_seed',
      summary: 'Add to graph domain: example.test'
    });
  });

  it('adds hypotheses without asking in full-access mode', async () => {
    const link = { sourceId: 'a', targetId: 'b', hypothesis: 'test' };
    const f = fixture(
      [[call('propose_relationship', link)], [message()]],
      'auto'
    );
    await f.run();
    expect(f.port.waitForDecision).not.toHaveBeenCalled();
    expect(f.port.addHypothesis).toHaveBeenCalledOnce();
    expect(f.events.some((event) => event.type === 'approval')).toBe(false);
  });

  it('cancellation during approval prevents the graph mutation', async () => {
    const f = fixture([
      [
        call('propose_relationship', {
          sourceId: 'a',
          targetId: 'b',
          hypothesis: 'test'
        })
      ]
    ]);
    f.port.waitForDecision = vi.fn(async () => {
      f.abort.abort();
      return true;
    });
    await expect(f.run()).rejects.toThrow();
    expect(f.port.addHypothesis).not.toHaveBeenCalled();
  });

  it('rejects unsupported tools and never executes duplicate tool-call IDs twice', async () => {
    const unsupported = fixture([[call('shell', { command: 'anything' })]]);
    await expect(unsupported.run()).rejects.toThrow();
    const duplicate = fixture([
      [call('read_graph', { offset: 0 })],
      [call('read_graph', { offset: 0 })],
      [message()]
    ]);
    await duplicate.run();
    expect(duplicate.port.readGraph).toHaveBeenCalledOnce();
  });

  it('does not publish a late tool result after access is revoked', async () => {
    const f = fixture([[call('read_graph', { offset: 0 })], [message()]]);
    f.port.readGraph = vi.fn(async () => {
      f.port.assertActive = async () => {
        throw new Error('revoked');
      };
      return { sensitive: true };
    });
    await expect(f.run()).rejects.toThrow('revoked');
    expect(
      f.events.some(
        (event) => event.type === 'tool' && event.status === 'completed'
      )
    ).toBe(false);
    expect(f.requests).toHaveLength(1);
  });

  it('validates the model/reasoning combination before a provider call', async () => {
    expect(() => validateModelSelection('gpt-6-astra', 'none')).toThrow();
    expect(() =>
      validateModelSelection('untrusted-provider-model', 'high')
    ).toThrow();
    expect(validateModelSelection('gpt-6-astra', 'max').reasoning).toBe('max');
  });

  it('redacts tokens and credentialed URLs in public text', () => {
    const text = publicText(
      'sk-test123456789012345 Bearer private-token https://user:pass@example.test/path?api_key=secret#token'
    );
    expect(text).not.toMatch(/secret|private-token|user:pass|sk-test/);
    expect(text).toContain('https://example.test/path');
  });

  it('does not approve an invented seed or a substring of another target', () => {
    expect(
      seedIsInGoal('Analizza example.test e user@example.test', 'example.test')
    ).toBe(true);
    expect(
      seedIsInGoal('Analizza only-user@example.test', 'user@example.test')
    ).toBe(false);
    expect(
      seedIsInGoal('Analizza example.test.evil.invalid', 'example.test')
    ).toBe(false);
    expect(seedIsInGoal('Analizza example.test', 'other.test')).toBe(false);
  });

  it('accepts a standalone @handle for usernames only', () => {
    const goal = 'aggiungi account ig @rstlgu e deriva url';
    expect(seedIsInGoal(goal, 'rstlgu', 'username')).toBe(true);
    expect(seedIsInGoal(goal, 'rstlgu', 'domain')).toBe(false);
    expect(
      seedIsInGoal('Analizza user@example.test', 'example.test', 'username')
    ).toBe(false);
  });

  it('returns a rejected seed to the model instead of failing the run', async () => {
    const f = fixture([
      [call('add_seed', { type: 'username', value: 'invented' })],
      [message('Non posso aggiungerlo.')]
    ]);
    f.port.addSeed = vi.fn(async () => {
      throw new Error('agent_seed_outside_request');
    });
    await expect(f.run()).resolves.toBeDefined();
    expect(JSON.stringify(f.requests[1].input)).toContain(
      'conversation thread'
    );
  });

  it('returns a failed transform to the model and still publishes a reply', async () => {
    const args = { moduleId: 'sample', transformId: 'test', nodeId: 'node' };
    const f = fixture([
      [call('run_transform', args)],
      [message('La transform è andata in timeout.')]
    ]);
    f.port.executeTransform = vi.fn(async () => {
      throw new Error('agent_module_cancelled');
    });
    await expect(f.run()).resolves.toBeDefined();
    expect(JSON.stringify(f.requests[1].input)).toContain('module_timeout');
    expect(
      f.events.some(
        (event) => event.type === 'tool' && event.status === 'failed'
      )
    ).toBe(true);
    expect(f.events.some((event) => event.type === 'message')).toBe(true);
  });

  it('still ends the run on unexpected seed failures', async () => {
    const f = fixture([
      [call('add_seed', { type: 'username', value: 'x' })],
      [message()]
    ]);
    f.port.addSeed = vi.fn(async () => {
      throw new Error('agent_scope_changed');
    });
    await expect(f.run()).rejects.toThrow();
  });

  it('continues after failed HTTP headers and reports later successful work', async () => {
    const args = {
      moduleId: 'url-parser',
      transformId: 'url-http-headers',
      nodeId: 'url'
    };
    const later = {
      moduleId: 'ip-geolocation',
      transformId: 'ip-asn-lookup',
      nodeId: 'ip'
    };
    const f = fixture([
      [call('run_transform', args, 'headers')],
      [call('run_transform', later, 'asn')],
      [message('HTTP non disponibile; ricerca ASN completata.')]
    ]);
    vi.mocked(f.port.executeTransform)
      .mockRejectedValueOnce(new Error('agent_module_failed'))
      .mockResolvedValueOnce({ nodesAdded: 2 });
    await f.run();
    expect(f.port.executeTransform).toHaveBeenCalledTimes(2);
    expect(
      f.events
        .filter((event) => event.type === 'tool')
        .map((event) => event.status)
    ).toEqual(['running', 'failed', 'running', 'completed']);
    expect(f.events.at(-1)).toMatchObject({
      type: 'message',
      text: 'HTTP non disponibile; ricerca ASN completata.'
    });
  });

  it('turns pre-approval input rejection into a recoverable tool error', async () => {
    const f = fixture([
      [
        call('run_transform', {
          moduleId: 'text',
          transformId: 'extract',
          nodeId: 'note'
        })
      ],
      [
        message(
          'Questo modulo non accetta la nota; gli altri risultati restano disponibili.'
        )
      ]
    ]);
    f.port.prepareTransform = vi.fn(async () => {
      z.string()
        .regex(/^[a-z]+$/)
        .parse('PRIVATE invalid note content');
      throw new Error('unreachable');
    });
    await f.run();
    expect(f.port.executeTransform).not.toHaveBeenCalled();
    expect(f.port.waitForDecision).not.toHaveBeenCalled();
    expect(f.events).toContainEqual(
      expect.objectContaining({
        type: 'tool',
        status: 'failed',
        summary: 'The transform does not accept this node or input format.'
      })
    );
    expect(JSON.stringify(f.events)).not.toContain('PRIVATE');
    expect(JSON.stringify(f.requests[1].input)).not.toContain('PRIVATE');
    expect(f.events.at(-1)?.type).toBe('message');
  });

  it('never recovers from revoked access during transform preparation', async () => {
    const f = fixture([
      [
        call('run_transform', {
          moduleId: 'sample',
          transformId: 'test',
          nodeId: 'node'
        })
      ]
    ]);
    f.port.prepareTransform = vi.fn(async () => {
      throw new Error('agent_scope_changed');
    });
    await expect(f.run()).rejects.toThrow();
    expect(f.port.executeTransform).not.toHaveBeenCalled();
    expect(f.requests).toHaveLength(1);
  });

  it('reserves the last allowed model turn for a final report', async () => {
    const f = fixture([
      ...Array.from({ length: AGENT_LIMITS.maxTurns - 1 }, (_, i) => [
        call('read_graph', { offset: 0 }, `read-${i}`)
      ]),
      [message('Risultati parziali salvati.')]
    ]);
    await f.run();
    expect(f.requests.at(-1)).toMatchObject({
      tools: [],
      modelSettings: { toolChoice: 'none' }
    });
    expect(f.requests.at(-1)?.systemInstructions).toContain('final reply now');
    expect(f.requests).toHaveLength(AGENT_LIMITS.maxTurns);
  });

  it('requests a final report before exhausting the total token budget', async () => {
    const f = fixture(
      [[call('read_graph', { offset: 0 })], [message()]],
      undefined,
      [AGENT_LIMITS.maxTotalTokens * 0.76, 30]
    );
    await f.run();
    expect(f.requests[1]).toMatchObject({
      tools: [],
      modelSettings: { toolChoice: 'none' }
    });
  });

  it('rejects an empty model completion instead of reporting silent success', async () => {
    const f = fixture([[message('')]]);
    await expect(f.run()).rejects.toThrow('agent_empty_response');
  });

  it('stops at the turn limit instead of looping indefinitely', async () => {
    const f = fixture(
      Array.from({ length: AGENT_LIMITS.maxTurns + 5 }, (_, index) => [
        call('read_graph', { offset: 0 }, `loop-${index}`)
      ])
    );
    await expect(f.run()).rejects.toThrow();
    expect(f.requests).toHaveLength(AGENT_LIMITS.maxTurns);
  });
});
