import { z } from 'zod';
import { db } from '@/lib/db';
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret
} from '@/lib/security/secrets';
import { AGENT_PROVIDER_IDS, type AgentProviderId } from '../lib/contracts';
import { openRouterSlugSchema, type AgentModelAccess } from './policy';

export const agentProviderSchema = z.enum(
  AGENT_PROVIDER_IDS as [AgentProviderId, ...AgentProviderId[]]
);
export const agentApiKeySchema = z.string().trim().min(20).max(1024);
export const agentOpenRouterModelsSchema = z
  .array(openRouterSlugSchema)
  .max(20)
  .transform((models) =>
    models.filter((slug, index) => models.indexOf(slug) === index)
  );

export interface AgentProviderCredential {
  provider: AgentProviderId;
  configured: boolean;
  keyHint: string | null;
  updatedAt: string | null;
  models: string[];
}

export interface AgentCredentialStatus {
  providers: AgentProviderCredential[];
}

export async function loadAgentProviderKey(
  workspaceId: string,
  provider: AgentProviderId
): Promise<string | null> {
  const setting = await db.workspaceAgentSetting.findUnique({
    where: { workspaceId_provider: { workspaceId, provider } },
    select: { apiKey: true }
  });
  if (!setting) return null;
  return decryptSecret(setting.apiKey).trim() || null;
}

export async function getAgentCredentialStatus(
  workspaceId: string
): Promise<AgentCredentialStatus> {
  const settings = await db.workspaceAgentSetting.findMany({
    where: { workspaceId },
    select: { provider: true, keyHint: true, updatedAt: true, models: true }
  });
  return {
    providers: AGENT_PROVIDER_IDS.map((provider) => {
      const setting = settings.find((entry) => entry.provider === provider);
      return {
        provider,
        configured: !!setting,
        keyHint: setting?.keyHint ?? null,
        updatedAt: setting?.updatedAt.toISOString() ?? null,
        models: setting?.models ?? []
      };
    })
  };
}

export async function getAgentModelAccess(
  workspaceId: string
): Promise<AgentModelAccess> {
  const status = await getAgentCredentialStatus(workspaceId);
  return {
    providers: status.providers
      .filter((entry) => entry.configured)
      .map((entry) => entry.provider),
    openrouterModels:
      status.providers.find((entry) => entry.provider === 'openrouter')
        ?.models ?? []
  };
}

export async function saveAgentCredential(input: {
  workspaceId: string;
  userId: string;
  provider: AgentProviderId;
  apiKey?: string;
  models?: string[];
}) {
  const provider = agentProviderSchema.parse(input.provider);
  const models =
    provider === 'openrouter' && input.models
      ? agentOpenRouterModelsSchema.parse(input.models)
      : undefined;
  const where = {
    workspaceId_provider: { workspaceId: input.workspaceId, provider }
  };
  if (input.apiKey === undefined) {
    if (!models) throw new Error('invalid_agent_credential');
    const updated = await db.workspaceAgentSetting.updateMany({
      where: { workspaceId: input.workspaceId, provider },
      data: { models, updatedByUserId: input.userId }
    });
    if (!updated.count) throw new Error('agent_key_required');
    return getAgentCredentialStatus(input.workspaceId);
  }
  const apiKey = agentApiKeySchema.parse(input.apiKey);
  const encrypted = encryptSecret(apiKey);
  if (!isEncryptedSecret(encrypted)) throw new Error('encryption_required');
  const data = {
    apiKey: encrypted,
    keyHint: `…${apiKey.slice(-4)}`,
    updatedByUserId: input.userId,
    ...(models ? { models } : {})
  };
  await db.workspaceAgentSetting.upsert({
    where,
    create: { workspaceId: input.workspaceId, provider, ...data },
    update: data
  });
  return getAgentCredentialStatus(input.workspaceId);
}

export async function deleteAgentCredential(
  workspaceId: string,
  provider: AgentProviderId
) {
  await db.workspaceAgentSetting.deleteMany({
    where: { workspaceId, provider: agentProviderSchema.parse(provider) }
  });
  return getAgentCredentialStatus(workspaceId);
}
