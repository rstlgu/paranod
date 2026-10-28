import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getActiveWorkspaceAccess } from '@/lib/auth-utils';
import { readBoundedBody } from '@/lib/security/bounded-body';
import { agentMutationOriginError } from '@/features/agent/server/request-origin';
import {
  agentApiKeySchema,
  agentOpenRouterModelsSchema,
  agentProviderSchema,
  deleteAgentCredential,
  getAgentCredentialStatus,
  saveAgentCredential
} from '@/features/agent/server/credential';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const bodySchema = z
  .object({
    provider: agentProviderSchema,
    apiKey: agentApiKeySchema.optional(),
    models: agentOpenRouterModelsSchema.optional()
  })
  .strict()
  .refine((body) => body.apiKey !== undefined || body.models !== undefined);

export async function GET() {
  const access = await getActiveWorkspaceAccess();
  if (!access)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await getAgentCredentialStatus(access.workspaceId), {
    headers: NO_STORE
  });
}

export async function PUT(request: Request) {
  const guard = await adminGuard(request);
  if (guard instanceof NextResponse) return guard;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(JSON.parse(await readBoundedBody(request, 8192)));
  } catch {
    return NextResponse.json(
      { error: 'invalid_agent_key' },
      { status: 400, headers: NO_STORE }
    );
  }
  try {
    const status = await saveAgentCredential({
      workspaceId: guard.workspaceId,
      userId: guard.userId,
      ...body
    });
    return NextResponse.json(status, { headers: NO_STORE });
  } catch (error) {
    return credentialError(error);
  }
}

export async function DELETE(request: Request) {
  const guard = await adminGuard(request);
  if (guard instanceof NextResponse) return guard;
  const provider = agentProviderSchema.safeParse(
    new URL(request.url).searchParams.get('provider')
  );
  if (!provider.success)
    return NextResponse.json(
      { error: 'invalid_agent_provider' },
      { status: 400, headers: NO_STORE }
    );
  try {
    return NextResponse.json(
      await deleteAgentCredential(guard.workspaceId, provider.data),
      { headers: NO_STORE }
    );
  } catch (error) {
    return credentialError(error);
  }
}

async function adminGuard(request: Request) {
  const originError = agentMutationOriginError(request);
  if (originError) return originError;
  const access = await getActiveWorkspaceAccess();
  if (!access)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (access.role !== 'admin')
    return NextResponse.json(
      { error: 'workspace_admin_required' },
      { status: 403, headers: NO_STORE }
    );
  return access;
}

const ERROR_STATUS: Record<string, number> = {
  agent_key_required: 409,
  encryption_required: 500
};

function credentialError(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  const known = Object.hasOwn(ERROR_STATUS, code);
  return NextResponse.json(
    { error: known ? code : 'agent_credential_unavailable' },
    { status: known ? ERROR_STATUS[code] : 500, headers: NO_STORE }
  );
}
