import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Scope {
  workspaceId: string;
  provider: string;
}

const mocks = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>()
}));
const rowKey = ({ workspaceId, provider }: Scope) =>
  `${workspaceId}:${provider}`;
vi.mock('@/lib/db', () => ({
  db: {
    workspaceAgentSetting: {
      findUnique: async ({ where }: { where: { workspaceId_provider: Scope } }) =>
        mocks.rows.get(rowKey(where.workspaceId_provider)) ?? null,
      findMany: async ({ where }: { where: { workspaceId: string } }) =>
        Array.from(mocks.rows.values()).filter(
          (row) => row.workspaceId === where.workspaceId
        ),
      upsert: async ({
        where,
        create,
        update
      }: {
        where: { workspaceId_provider: Scope };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const key = rowKey(where.workspaceId_provider);
        const previous = mocks.rows.get(key);
        const row = {
          models: [],
          ...(previous ?? create),
          ...update,
          updatedAt: new Date('2026-09-29T12:00:00Z')
        };
        mocks.rows.set(key, row);
        return row;
      },
      updateMany: async ({
        where,
        data
      }: {
        where: Scope;
        data: Record<string, unknown>;
      }) => {
        const previous = mocks.rows.get(rowKey(where));
        if (!previous) return { count: 0 };
        mocks.rows.set(rowKey(where), { ...previous, ...data });
        return { count: 1 };
      },
      deleteMany: async ({ where }: { where: Scope }) => {
        mocks.rows.delete(rowKey(where));
        return { count: 1 };
      }
    }
  }
}));

import {
  deleteAgentCredential,
  getAgentCredentialStatus,
  getAgentModelAccess,
  loadAgentProviderKey,
  saveAgentCredential
} from './credential';

const KEY = 'sk-fixture-not-a-real-key-1234';
const ANTHROPIC_KEY = 'sk-ant-fixture-not-a-real-key-9876';

beforeEach(() => {
  vi.stubEnv('SECRETS_ENCRYPTION_KEY', 'fixture-encryption-passphrase');
});
afterEach(() => {
  vi.unstubAllEnvs();
  mocks.rows.clear();
});

function providerStatus(
  status: Awaited<ReturnType<typeof getAgentCredentialStatus>>,
  provider: string
) {
  return status.providers.find((entry) => entry.provider === provider);
}

describe('graph agent credential', () => {
  it('stores each key encrypted and exposes only a hint', async () => {
    const status = await saveAgentCredential({
      workspaceId: 'ws',
      userId: 'admin',
      provider: 'openai',
      apiKey: `  ${KEY}  `
    });
    const stored = mocks.rows.get('ws:openai');
    expect(stored?.apiKey).toMatch(/^enc:v1:/);
    expect(JSON.stringify(stored)).not.toContain(KEY);
    expect(providerStatus(status, 'openai')).toEqual({
      provider: 'openai',
      configured: true,
      keyHint: '…1234',
      updatedAt: '2026-09-29T12:00:00.000Z',
      models: []
    });
    expect(providerStatus(status, 'anthropic')?.configured).toBe(false);
    expect(JSON.stringify(status)).not.toContain(KEY);
    await expect(loadAgentProviderKey('ws', 'openai')).resolves.toBe(KEY);
    await expect(loadAgentProviderKey('ws', 'anthropic')).resolves.toBeNull();
  });

  it('keeps provider keys independent', async () => {
    await saveAgentCredential({
      workspaceId: 'ws',
      userId: 'a',
      provider: 'openai',
      apiKey: KEY
    });
    await saveAgentCredential({
      workspaceId: 'ws',
      userId: 'a',
      provider: 'anthropic',
      apiKey: ANTHROPIC_KEY
    });
    await deleteAgentCredential('ws', 'openai');
    await expect(loadAgentProviderKey('ws', 'openai')).resolves.toBeNull();
    await expect(loadAgentProviderKey('ws', 'anthropic')).resolves.toBe(
      ANTHROPIC_KEY
    );
    await expect(getAgentModelAccess('ws')).resolves.toEqual({
      providers: ['anthropic'],
      openrouterModels: []
    });
  });

  it('stores validated OpenRouter model slugs and updates them without the key', async () => {
    await expect(
      saveAgentCredential({
        workspaceId: 'ws',
        userId: 'a',
        provider: 'openrouter',
        models: ['x-ai/grok-4']
      })
    ).rejects.toThrow('agent_key_required');
    await saveAgentCredential({
      workspaceId: 'ws',
      userId: 'a',
      provider: 'openrouter',
      apiKey: KEY,
      models: ['X-AI/Grok-4', 'x-ai/grok-4']
    });
    await saveAgentCredential({
      workspaceId: 'ws',
      userId: 'a',
      provider: 'openrouter',
      models: ['x-ai/grok-4', 'mistralai/mistral-large']
    });
    await expect(getAgentModelAccess('ws')).resolves.toEqual({
      providers: ['openrouter'],
      openrouterModels: ['x-ai/grok-4', 'mistralai/mistral-large']
    });
    await expect(
      saveAgentCredential({
        workspaceId: 'ws',
        userId: 'a',
        provider: 'openrouter',
        models: ['https://evil.invalid/model']
      })
    ).rejects.toThrow();
  });

  it('rejects short keys and unknown providers', async () => {
    await expect(
      saveAgentCredential({
        workspaceId: 'ws',
        userId: 'a',
        provider: 'openai',
        apiKey: 'short'
      })
    ).rejects.toThrow();
    await expect(
      saveAgentCredential({
        workspaceId: 'ws',
        userId: 'a',
        provider: 'custom' as never,
        apiKey: KEY
      })
    ).rejects.toThrow();
    expect(mocks.rows.size).toBe(0);
  });

});
