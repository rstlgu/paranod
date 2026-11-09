import { NextResponse } from 'next/server';
import { getActiveWorkspaceAccess } from '@/lib/auth-utils';
import { db } from '@/lib/db';
import { PUBLIC_RUN_SELECT, toRunSummary } from '@/features/agent/server/runs';
import {
  agentModelCatalog,
  isModelAvailable,
  resolveModelSelection,
  type AgentModelAccess
} from '@/features/agent/server/policy';
import { getAgentModelAccess } from '@/features/agent/server/credential';
import { getWorkspaceAgentAvailability } from '@/features/agent/server/provider';
import { getAgentWorkerCapacity } from '@/features/agent/server/readiness';
import { agentStartSchema } from '@/features/agent/server/start-contract';
import {
  createAgentProducer,
  enqueueAgentRun,
  findStartedAgentRun
} from '@/features/agent/server/queue';
import { readBoundedBody } from '@/lib/security/bounded-body';
import { graphWriteErrorResponse } from '@/features/graph/server/graph-write-response';
import { agentMutationOriginError } from '@/features/agent/server/request-origin';

const producer = createAgentProducer();
const NO_STORE = { 'Cache-Control': 'private, no-store' };
const NO_MODEL_ACCESS: AgentModelAccess = { providers: [], openrouterModels: [] };

function invalidStart(status: number) {
  return NextResponse.json(
    { error: 'invalid_agent_start' },
    { status, headers: NO_STORE }
  );
}

async function availability(workspaceId: string) {
  const config = await getWorkspaceAgentAvailability(workspaceId);
  if (!config.available) return config;
  try {
    const capacity = await getAgentWorkerCapacity(db);
    if (!capacity.readyWorkers)
      return { available: false, reason: 'agent_worker_unavailable' };
    return { available: true, reason: null };
  } catch {
    return { available: false, reason: 'agent_worker_unavailable' };
  }
}

export async function GET() {
  const access = await getActiveWorkspaceAccess();
  if (!access)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const runs = await db.agentRun.findMany({
    where: {
      userId: access.userId,
      archivedAt: null,
      graph: { userId: access.userId, workspaceId: access.workspaceId }
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: PUBLIC_RUN_SELECT
  });
  const state = await availability(access.workspaceId);
  const modelAccess = await getAgentModelAccess(access.workspaceId).catch(
    () => NO_MODEL_ACCESS
  );
  return NextResponse.json(
    {
      ...state,
      models: agentModelCatalog(modelAccess),
      runs: runs.map(toRunSummary)
    },
    { headers: NO_STORE }
  );
}

export async function POST(request: Request) {
  const originError = agentMutationOriginError(request);
  if (originError) return originError;
  const access = await getActiveWorkspaceAccess();
  if (!access)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let parsed;
  try {
    parsed = agentStartSchema.parse(
      JSON.parse(await readBoundedBody(request, 40_000))
    );
  } catch (error) {
    return invalidStart(error instanceof RangeError ? 413 : 400);
  }
  let modelAccess: AgentModelAccess;
  try {
    modelAccess = await getAgentModelAccess(access.workspaceId);
  } catch {
    return NextResponse.json(
      { error: 'agent_configuration_unavailable' },
      { status: 503, headers: NO_STORE }
    );
  }
  let selection;
  try {
    selection = resolveModelSelection(
      parsed.model,
      parsed.reasoning,
      modelAccess
    );
  } catch {
    return invalidStart(400);
  }
  const input = {
    ...parsed,
    model: selection.model,
    reasoning: selection.reasoning,
    userId: access.userId,
    workspaceId: access.workspaceId
  };
  try {
    // A lost HTTP response must never turn a retry into a second investigation.
    const previous = await findStartedAgentRun(db, input);
    if (previous) return NextResponse.json(previous, { headers: NO_STORE });
    const state = await availability(access.workspaceId);
    if (!state.available)
      return NextResponse.json(
        { error: state.reason },
        { status: 503, headers: NO_STORE }
      );
    if (!isModelAvailable(selection, modelAccess))
      return NextResponse.json(
        { error: 'agent_provider_key_not_configured' },
        { status: 503, headers: NO_STORE }
      );
    return NextResponse.json(await enqueueAgentRun(db, producer, input), {
      status: 201,
      headers: NO_STORE
    });
  } catch (error) {
    const graphError = graphWriteErrorResponse(error);
    if (graphError) return graphError;
    const code = error instanceof Error ? error.message : '';
    const known = [
      'agent_worker_unavailable',
      'agent_worker_busy',
      'agent_queue_rejected'
    ];
    return NextResponse.json(
      { error: known.includes(code) ? code : 'agent_start_unavailable' },
      {
        status: code === 'agent_worker_busy' ? 429 : 503,
        headers: NO_STORE
      }
    );
  }
}
