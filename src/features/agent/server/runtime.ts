import {
  Agent,
  Runner,
  tool,
  type AgentOutputType,
  type ModelProvider,
  type ModelRequest,
  type RunState,
  type StreamedRunResult
} from '@openai/agents';
import { z } from 'zod';
import {
  DEFAULT_AGENT_APPROVAL_MODE,
  type AgentApprovalMode,
  type AgentEventData
} from '../lib/contracts';
import {
  seedSchema,
  linkSchema,
  deleteNodesSchema,
  mergeNodesSchema
} from './graph-data';
import { type ConversationTurn } from './conversation';
import {
  compactContext,
  contextInput,
  publicModelContext,
  type ContextCheckpoint
} from './context';
import {
  AGENT_CONTEXT_MAX_GOALS,
  AGENT_CONTEXT_OUTPUT_RESERVE,
  AGENT_CONTEXT_REQUEST_RESERVE,
  agentContextCompactionThreshold,
  agentContextLimit,
  estimateContextTokens
} from '../lib/context';
import { agentModelSettings } from './model-settings';
import { trimDiscoveryContext } from './discovery-context';
import {
  agentFailure,
  isFatalAgentError,
  isRecoverableTransformPreparationError,
  toolArgumentFailure
} from './failure';
import {
  AGENT_INSTRUCTIONS,
  AGENT_LIMITS,
  actionNeedsApproval,
  argumentsHash,
  publicText,
  validateModelSelection
} from './policy';

export const transformRequestSchema = z
  .object({
    moduleId: z.string().min(1).max(200),
    transformId: z.string().min(1).max(200),
    nodeId: z.string().min(1).max(200)
  })
  .strict();

// Unknown keys are ignored. nextOffset is the result field name models copy
// into the next call; it is a page start, not a second cursor.
export const listModulesSchema = z.object({
  inputType: z.string().min(1).max(100),
  query: z.string().max(160).nullable().optional(),
  offset: z.number().int().min(0).max(10_000).nullable().optional(),
  nextOffset: z.number().int().min(0).max(10_000).nullable().optional()
});

export function listModulesPage(
  offset: number | null | undefined,
  nextOffset: number | null | undefined
) {
  if (typeof offset === 'number') return offset;
  if (typeof nextOffset === 'number') return nextOffset;
  return 0;
}
export type TransformRequest = z.infer<typeof transformRequestSchema>;
export interface TransformPermit {
  fingerprint: string;
  requiresApproval: boolean;
  destination: string;
  summary: string;
}

export interface AgentRuntimePort {
  saveContextCheckpoint?(checkpoint: ContextCheckpoint): Promise<void>;
  assertActive(): Promise<void>;
  publish(data: AgentEventData): Promise<void>;
  readGraph(offset: number): Promise<unknown>;
  listModules(
    inputType: string,
    query?: string,
    offset?: number
  ): Promise<unknown>;
  describeModule(
    inputType: string,
    moduleId: string,
    transformId: string
  ): Promise<unknown>;
  addSeed(input: z.infer<typeof seedSchema>): Promise<unknown>;
  addHypothesis(input: z.infer<typeof linkSchema>): Promise<unknown>;
  deleteNodes(input: z.infer<typeof deleteNodesSchema>): Promise<unknown>;
  mergeNodes(input: z.infer<typeof mergeNodesSchema>): Promise<unknown>;
  prepareTransform(input: TransformRequest): Promise<TransformPermit>;
  executeTransform(
    input: TransformRequest,
    fingerprint: string,
    signal: AbortSignal
  ): Promise<unknown>;
  waitForDecision(
    approvalId: string,
    hash: string,
    signal: AbortSignal
  ): Promise<boolean>;
}

export async function runInvestigation(input: {
  runId: string;
  goal: string;
  model: string;
  reasoning: string;
  approvalMode?: AgentApprovalMode;
  provider: ModelProvider;
  port: AgentRuntimePort;
  signal: AbortSignal;
  history?: ConversationTurn[];
  contextSummary?: string;
  contextGoals?: string[];
}) {
  const selection = validateModelSelection(input.model, input.reasoning);
  const contextLimit = agentContextLimit(selection.model);
  const compactionThreshold = agentContextCompactionThreshold(selection.model);
  const { port } = input;
  const signal = AbortSignal.any([
    input.signal,
    AbortSignal.timeout(AGENT_LIMITS.runTimeoutMs)
  ]);
  let toolCalls = 0;
  const executed = new Set<string>();
  const permits = new Map<string, TransformPermit>();
  const preparationErrors = new Map<string, unknown>();
  const approvals = new Map<string, string>();
  const approvalMode = input.approvalMode ?? DEFAULT_AGENT_APPROVAL_MODE;
  const seedNeedsApproval = actionNeedsApproval(approvalMode, 'seed');
  const linkNeedsApproval = actionNeedsApproval(approvalMode, 'relationship');
  const deletionNeedsApproval = actionNeedsApproval(approvalMode, 'deletion');
  const mergeNeedsApproval = actionNeedsApproval(approvalMode, 'merge');
  const consumeApproval = (
    callId: string,
    name: string,
    args: unknown,
    fingerprint?: string
  ) => {
    const hash = argumentsHash({
      runId: input.runId,
      name,
      arguments: args,
      ...(fingerprint ? { fingerprint } : {})
    });
    if (approvals.get(callId) !== hash)
      throw new Error('agent_approval_required');
    approvals.delete(callId);
  };
  const check = async () => {
    signal.throwIfAborted();
    await port.assertActive();
    signal.throwIfAborted();
  };
  const perform = async (
    name: string,
    callId: string | undefined,
    target: string,
    execute: () => Promise<unknown>
  ) => {
    await check();
    if (!callId || executed.has(callId))
      throw new Error('agent_duplicate_tool_call');
    if (++toolCalls > AGENT_LIMITS.maxToolCalls)
      throw new Error('agent_tool_limit');
    executed.add(callId);
    const started = Date.now();
    const base = {
      type: 'tool' as const,
      callId,
      name,
      target: publicText(target, 400),
      sources: []
    };
    await port.publish({
      ...base,
      status: 'running',
      summary: 'Started.'
    });
    try {
      const result = await execute();
      await check();
      await port.publish({
        ...base,
        status: 'completed',
        summary: 'Completed.',
        durationMs: Date.now() - started
      });
      return result;
    } catch (error) {
      if (!signal.aborted)
        await port.publish({
          ...base,
          status: 'failed',
          summary: agentFailure(error).summary,
          durationMs: Date.now() - started
        });
      throw error;
    }
  };
  const tools = [
    tool({
      name: 'read_graph',
      description:
        'Read a bounded page of entities in the current graph. Private content is excluded.',
      parameters: z
        .object({ offset: z.number().int().min(0).max(10_000) })
        .strict(),
      errorFunction: (_context, error) => recoverableToolError(error),
      execute: ({ offset }, _context, details) =>
        perform('read_graph', details?.toolCall?.callId, 'Current graph', () =>
          port.readGraph(offset)
        )
    }),
    tool({
      name: 'list_modules',
      description:
        'Search a compact page of transform names/IDs for an entity type. query filters by capability; omit it or pass null to list every match. offset is the page start; omit it or pass 0 for the first page. To read another page, pass the nextOffset value from the previous result as offset. Full descriptions are loaded separately with describe_module. executable=false cannot run.',
      parameters: listModulesSchema,
      errorFunction: (_context, error) => recoverableToolError(error),
      execute: ({ inputType, query, offset, nextOffset }, _context, details) =>
        perform('list_modules', details?.toolCall?.callId, inputType, () =>
          port.listModules(
            inputType,
            query ?? '',
            listModulesPage(offset, nextOffset)
          )
        )
    }),
    tool({
      name: 'describe_module',
      description:
        'Load the details, limitations and approval requirements for one transform discovered through list_modules. Does not execute it or authorize external requests.',
      parameters: z
        .object({
          inputType: z.string().min(1).max(100),
          moduleId: z.string().min(1).max(200),
          transformId: z.string().min(1).max(200)
        })
        .strict(),
      errorFunction: (_context, error) => recoverableToolError(error),
      execute: ({ inputType, moduleId, transformId }, _context, details) =>
        perform(
          'describe_module',
          details?.toolCall?.callId,
          `${moduleId}/${transformId}`,
          () => port.describeModule(inputType, moduleId, transformId)
        )
    }),
    tool({
      name: 'add_seed',
      description:
        'Add an unverified seed grounded in the conversation thread. You may infer a candidate domain or website URL from a user-named brand (e.g. Adidas -> adidas.com), including follow-ups. No arbitrary metadata. An inferred seed is not proof of ownership.',
      parameters: seedSchema,
      needsApproval: seedNeedsApproval,
      errorFunction: (_context, error) => {
        const code = error instanceof Error ? error.message : '';
        if (!Object.hasOwn(SEED_REJECTIONS, code)) throw error;
        return SEED_REJECTIONS[code];
      },
      execute: (seed, _context, details) =>
        perform('add_seed', details?.toolCall?.callId, seed.value, async () => {
          if (seedNeedsApproval)
            consumeApproval(details!.toolCall!.callId, 'add_seed', seed);
          return port.addSeed(seed);
        })
    }),
    tool({
      name: 'propose_relationship',
      description:
        'Add a clearly marked, unverified hypothesis between two existing nodes.',
      parameters: linkSchema,
      needsApproval: linkNeedsApproval,
      errorFunction: (_context, error) => recoverableToolError(error),
      execute: (link, _context, details) =>
        perform(
          'propose_relationship',
          details?.toolCall?.callId,
          `${link.sourceId} / ${link.targetId}`,
          async () => {
            if (linkNeedsApproval)
              consumeApproval(
                details!.toolCall!.callId,
                'propose_relationship',
                link
              );
            return port.addHypothesis(link);
          }
        )
    }),
    tool({
      name: 'delete_nodes',
      description:
        'Remove specified nodes from the current graph and their incident links. Use exact existing node IDs and give a reason. Can be used on request or autonomously for task-relevant cleanup; the application handles approval. Does not delete neighboring nodes or attachment files.',
      parameters: deleteNodesSchema,
      needsApproval: deletionNeedsApproval,
      errorFunction: (_context, error) => recoverableToolError(error),
      execute: (args, _context, details) =>
        perform(
          'delete_nodes',
          details?.toolCall?.callId,
          args.reason,
          async () => {
            if (deletionNeedsApproval)
              consumeApproval(details!.toolCall!.callId, 'delete_nodes', args);
            return port.deleteNodes(args);
          }
        )
    }),
    tool({
      name: 'merge_nodes',
      description:
        'Merge at least two existing nodes of the same type into one. primaryNodeId must be one of nodeIds and keeps its label and metadata. Other selected nodes of that type are folded in and can be unmerged later. Returns mergedNodeId.',
      parameters: mergeNodesSchema,
      needsApproval: mergeNeedsApproval,
      errorFunction: (_context, error) => recoverableToolError(error),
      execute: (args, _context, details) =>
        perform(
          'merge_nodes',
          details?.toolCall?.callId,
          args.primaryNodeId,
          async () => {
            if (mergeNeedsApproval)
              consumeApproval(details!.toolCall!.callId, 'merge_nodes', args);
            return port.mergeNodes(args);
          }
        )
    }),
    tool({
      name: 'run_transform',
      description:
        'Execute an enabled transform on a graph node, including nodes added earlier in this run. Use the node IDs returned by tools. Credentials and destinations cannot be supplied by the model.',
      parameters: transformRequestSchema,
      errorFunction: (_context, error) => recoverableToolError(error),
      needsApproval: async (_context, args, callId) => {
        await check();
        if (!callId) throw new Error('agent_call_id_required');
        let permit: TransformPermit;
        try {
          permit = await port.prepareTransform(args);
        } catch (error) {
          // SDK approval callbacks run outside tool errorFunction. Route ordinary
          // validation failures through execute so the model can still conclude.
          if (!isRecoverableTransformPreparationError(error)) throw error;
          preparationErrors.set(callId, error);
          return false;
        }
        const previous = permits.get(callId);
        if (previous && previous.fingerprint !== permit.fingerprint)
          throw new Error('agent_module_changed');
        permits.set(callId, permit);
        return permit.requiresApproval;
      },
      execute: (args, _context, details) =>
        perform(
          'run_transform',
          details?.toolCall?.callId,
          `${args.moduleId}/${args.transformId}`,
          async () => {
            const callId = details!.toolCall!.callId;
            if (preparationErrors.has(callId)) {
              const error = preparationErrors.get(callId);
              preparationErrors.delete(callId);
              throw error;
            }
            const permit = permits.get(callId);
            if (!permit) throw new Error('agent_transform_not_prepared');
            if (permit.requiresApproval)
              consumeApproval(
                callId,
                'run_transform',
                args,
                permit.fingerprint
              );
            return port.executeTransform(args, permit.fingerprint, signal);
          }
        )
    })
  ];
  let observedTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let compactions = 0;
  let contextTokens = 0;
  let contextEstimated = true;
  let compacting = false;
  const publishUsage = () =>
    port.publish({
      type: 'usage',
      inputTokens,
      outputTokens,
      context: {
        tokens: contextTokens,
        limit: contextLimit,
        estimated: contextEstimated,
        compactions,
        state: compacting ? 'compacting' : 'ready',
        budgetVersion: 2
      }
    });
  const account = async (usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }) => {
    for (const value of [
      usage.inputTokens,
      usage.outputTokens,
      usage.totalTokens
    ])
      if (!Number.isSafeInteger(value) || value < 0)
        throw new Error('agent_invalid_usage');
    observedTokens += usage.totalTokens;
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    if (!compacting) {
      contextTokens = usage.inputTokens + usage.outputTokens;
      contextEstimated = false;
    }
    await publishUsage();
    if (observedTokens > AGENT_LIMITS.maxTotalTokens)
      throw new Error('agent_token_limit');
  };
  const compact = async (text: string) => {
    await check();
    const started = Date.now();
    const callId = `context-${compactions + 1}`;
    await port.publish({
      type: 'tool',
      callId,
      name: 'compact_context',
      target: 'Conversation',
      status: 'running',
      summary: '',
      sources: []
    });
    compacting = true;
    await publishUsage();
    try {
      const summary = await compactContext({
        text,
        model: input.model,
        reasoning: input.reasoning,
        provider: input.provider,
        signal,
        onUsage: (inputTokens, outputTokens) =>
          account({
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens
          })
      });
      await check();
      compactions++;
      contextTokens = estimateContextTokens(summary);
      contextEstimated = true;
      await port.publish({
        type: 'tool',
        callId,
        name: 'compact_context',
        target: 'Conversation',
        status: 'completed',
        summary: 'Context compacted automatically.',
        durationMs: Date.now() - started,
        sources: []
      });
      return summary;
    } catch (error) {
      await port.publish({
        type: 'tool',
        callId,
        name: 'compact_context',
        target: 'Conversation',
        status: 'failed',
        summary: 'Context compaction failed.',
        durationMs: Date.now() - started,
        sources: []
      });
      throw error;
    } finally {
      compacting = false;
      await publishUsage();
    }
  };
  let modelCalls = 0;
  const prepareModelRequest = (request: ModelRequest): ModelRequest => {
    modelCalls += 1;
    // Reserve the final turn for a report, without raising any hard budget.
    const shouldConclude =
      modelCalls >= AGENT_LIMITS.maxTurns ||
      observedTokens >= AGENT_LIMITS.maxTotalTokens * 0.75 ||
      toolCalls >= AGENT_LIMITS.maxToolCalls - 1;
    const prepared = shouldConclude
      ? {
          ...request,
          tools: [],
          toolsExplicitlyProvided: true,
          modelSettings: {
            ...request.modelSettings,
            toolChoice: 'none' as const
          },
          systemInstructions: `${request.systemInstructions ?? ''}\nThe investigation is approaching its execution budget. Stop using tools and give your final reply now in the user's language. Summarize confirmed work, failed operations and remaining limitations; explicitly state that the investigation is partial when work remains. Do not claim completeness or invent results.`
        }
      : request;
    // The SDK filter cannot see serialized tool definitions. Enforce the full
    // request here as well, including output headroom, before any provider call.
    const tokens = estimateContextTokens(
      JSON.stringify({
        input: prepared.input,
        instructions: prepared.systemInstructions,
        tools: prepared.tools,
        outputType: prepared.outputType,
        handoffs: prepared.handoffs
      })
    );
    if (tokens + AGENT_CONTEXT_OUTPUT_RESERVE > contextLimit)
      throw new Error('agent_context_limit');
    if (
      observedTokens + tokens + AGENT_CONTEXT_OUTPUT_RESERVE >
      AGENT_LIMITS.maxTotalTokens
    )
      throw new Error('agent_token_limit');
    return prepared;
  };
  const boundedProvider: ModelProvider = {
    async getModel(name) {
      const model = await input.provider.getModel(name);
      return {
        async getResponse(request) {
          await check();
          if (observedTokens >= AGENT_LIMITS.maxTotalTokens)
            throw new Error('agent_token_limit');
          const response = await model.getResponse(
            prepareModelRequest(request)
          );
          await account(response.usage);
          return response;
        },
        async *getStreamedResponse(request) {
          await check();
          if (observedTokens >= AGENT_LIMITS.maxTotalTokens)
            throw new Error('agent_token_limit');
          for await (const event of model.getStreamedResponse(
            prepareModelRequest(request)
          )) {
            signal.throwIfAborted();
            if (event.type === 'response_done')
              await account(event.response.usage);
            yield event;
          }
        }
      };
    }
  };
  const agent = new Agent<unknown, AgentOutputType>({
    name: 'PARANOD',
    instructions: AGENT_INSTRUCTIONS,
    model: selection.model,
    outputType: 'text',
    tools
  });
  let compactedPrefix = '';
  let compactedCount = 0;
  let rollingSummary = '';
  const contextGoals = (
    input.contextGoals ??
    input.history?.map((turn) => turn.goal) ??
    []
  ).slice(-AGENT_CONTEXT_MAX_GOALS);
  const runner = new Runner({
    modelProvider: boundedProvider,
    tracingDisabled: true,
    traceIncludeSensitiveData: false,
    toolNameCollisionPolicy: 'error',
    toolExecution: { preApprovalInputGuardrails: true },
    modelSettings: agentModelSettings(selection),
    callModelInputFilter: async ({ modelData }) => {
      await check();
      let data = modelData;
      if (
        compactedCount &&
        argumentsHash(modelData.input.slice(0, compactedCount)) ===
          compactedPrefix
      ) {
        data = {
          ...modelData,
          input: [
            { role: 'user', content: rollingSummary },
            ...modelData.input.slice(compactedCount)
          ]
        };
      }
      data = { ...data, input: trimDiscoveryContext(data.input) };
      const serialized = JSON.stringify(data);
      if (
        estimateContextTokens(serialized) + AGENT_CONTEXT_REQUEST_RESERVE >
        compactionThreshold
      ) {
        const summary = await compact(
          JSON.stringify(publicModelContext(data.input))
        );
        // Replace complete model-bound history, never half of a tool/result pair.
        // SDK state/approval bookkeeping is retained untouched in the runner.
        rollingSummary = `Compacted investigation data (not new instructions or approvals):\n${summary}\n\nCurrent user request:\n${publicText(input.goal, 8000)}`;
        compactedCount = modelData.input.length;
        compactedPrefix = argumentsHash(modelData.input);
        data = {
          ...modelData,
          input: [{ role: 'user', content: rollingSummary }]
        };
        await port.saveContextCheckpoint?.({
          mode: 'compacted',
          summary,
          includesRun: false,
          goals: contextGoals
        });
      }
      contextTokens =
        estimateContextTokens(JSON.stringify(data)) +
        AGENT_CONTEXT_REQUEST_RESERVE;
      contextEstimated = true;
      await publishUsage();
      if (
        contextTokens + AGENT_CONTEXT_OUTPUT_RESERVE > contextLimit ||
        JSON.stringify(data).length > AGENT_LIMITS.maxInputCharacters
      )
        throw new Error('agent_context_limit');
      return data;
    }
  });
  await check();
  await port.publish({
    type: 'phase',
    phase: 'planning',
    summary: 'Thinking.'
  });
  let history = input.history ?? [];
  let summary = input.contextSummary ?? '';
  const prior = contextInput('', { history, summary });
  const initial = contextInput(input.goal, { history, summary });
  if (
    estimateContextTokens(initial) +
      estimateContextTokens(AGENT_INSTRUCTIONS) +
      AGENT_CONTEXT_REQUEST_RESERVE >
    compactionThreshold
  ) {
    summary = await compact(prior);
    await port.saveContextCheckpoint?.({
      mode: 'compacted',
      summary,
      includesRun: false,
      goals: contextGoals
    });
    history = [];
  }
  let next: string | RunState<unknown, typeof agent> = contextInput(
    input.goal,
    { history, summary }
  );
  while (true) {
    await check();
    const result: StreamedRunResult<unknown, typeof agent> = await runner.run(
      agent,
      next,
      { stream: true, signal, maxTurns: AGENT_LIMITS.maxTurns }
    );
    for await (const event of result) {
      signal.throwIfAborted();
      if (event.type !== 'run_item_stream_event') continue;
      await check();
      if (event.item.type === 'message_output_item') {
        const text = event.item.rawItem.content
          .map((part) =>
            part.type === 'output_text'
              ? part.text
              : part.type === 'refusal'
                ? part.refusal
                : ''
          )
          .join('\n');
        if (text.trim())
          await port.publish({
            type: 'message',
            text: publicText(text, 16000),
            sources: []
          });
      }
    }
    await result.completed;
    if (result.error) throw result.error;
    const usage = result.runContext.usage;
    if (usage.totalTokens > AGENT_LIMITS.maxTotalTokens)
      throw new Error('agent_token_limit');
    if (!result.interruptions.length) {
      if (typeof result.finalOutput !== 'string' || !result.finalOutput.trim())
        throw new Error('agent_empty_response');
      return {
        inputTokens,
        outputTokens
      };
    }
    for (const interruption of result.interruptions) {
      await check();
      const call = interruption.rawItem;
      if (
        call.type !== 'function_call' ||
        ![
          'run_transform',
          'propose_relationship',
          'add_seed',
          'delete_nodes',
          'merge_nodes'
        ].includes(call.name)
      )
        throw new Error('agent_unsupported_approval');
      const args: unknown = JSON.parse(call.arguments);
      const permit = permits.get(call.callId);
      if (call.name === 'run_transform' && !permit)
        throw new Error('agent_transform_not_prepared');
      const hash = argumentsHash({
        runId: input.runId,
        name: call.name,
        arguments: args,
        ...(permit ? { fingerprint: permit.fingerprint } : {})
      });
      const approvalId = `approve-${call.callId}`;
      await port.publish({
        type: 'approval',
        approvalId,
        tool: call.name,
        argumentsHash: hash,
        destination: publicText(permit?.destination ?? 'Current graph', 240),
        summary: publicText(permit?.summary ?? approvalSummary(call.name, args))
      });
      const approved = await port.waitForDecision(
        approvalId,
        hash,
        AbortSignal.any([
          signal,
          AbortSignal.timeout(AGENT_LIMITS.approvalTimeoutMs)
        ])
      );
      await check();
      if (approved) {
        approvals.set(call.callId, hash);
        result.state.approve(interruption);
      } else
        result.state.reject(interruption, {
          message:
            'User denied this exact operation. Do not retry or bypass it.'
        });
    }
    next = result.state;
  }
}

function recoverableToolError(error: unknown) {
  if (isFatalAgentError(error)) throw error;
  const argumentsMessage = toolArgumentFailure(error);
  if (argumentsMessage) return argumentsMessage;
  const failure = agentFailure(error);
  return `The tool failed (${failure.code}): ${failure.summary} Explain the limitation in the final reply. Do not invent findings and do not retry the same action.`;
}

// Validation rejections the model can recover from; anything else ends the run.
const SEED_REJECTIONS: Record<string, string> = {
  agent_seed_outside_request:
    'Seed rejected: this target is not grounded in the conversation thread. Named targets and candidate domains/URLs matching a user-named brand are allowed. Recheck the intended entity; do not invent unrelated targets. Ask for clarification only if the intended target is genuinely ambiguous, not merely because a domain suffix was omitted.',
  agent_sensitive_seed:
    'Seed rejected: the value looks like a credential or a URL with credentials, query or fragment. Tell the user.',
  agent_invalid_seed: 'Seed rejected: empty value. Tell the user.'
};

function approvalSummary(name: string, args: unknown) {
  if (name === 'delete_nodes') {
    const deletion = deleteNodesSchema.parse(args);
    return `Delete ${new Set(deletion.nodeIds).size} nodes and their incident links: ${deletion.reason}`;
  }
  if (name === 'merge_nodes') {
    const merge = mergeNodesSchema.parse(args);
    return `Merge ${new Set(merge.nodeIds).size} nodes of the same type, keeping ${merge.primaryNodeId}: ${merge.reason}`;
  }
  if (name === 'add_seed') {
    const seed = seedSchema.parse(args);
    return `Add to graph ${seed.type}: ${seed.value}`;
  }
  return `Add this hypothesis: ${linkSchema.parse(args).hypothesis}`;
}
