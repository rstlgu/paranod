import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Prisma } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  file: vi.fn(),
  fetch: vi.fn()
}));
vi.mock('@/lib/db', () => ({
  db: {
    workspaceMember: { findUnique: mocks.member },
    tempFile: { findFirst: mocks.file }
  }
}));
vi.mock('@/lib/security/safe-fetch', () => ({ safePublicFetch: mocks.fetch }));
vi.mock('@/lib/auth-session', () => {
  throw new Error('Image execution must not depend on an HTTP session');
});
import { loadImageBytes } from './image-bytes';
import { imagePluginExecutor } from '@/features/plugins/builtin/image-plugin';
import { prepareAgentTransform } from '@/features/agent/server/modules';
import { executeAgentModule } from '@/features/agent/server/module-execution';

const scope = { userId: 'owner', workspaceId: 'workspace' };
const source = '/api/upload/temp/image-file';
let directory: string;
let image: Buffer;
let record: {
  id: string;
  sizeBytes: number;
  expiresAt: Date | null;
  encIv: string;
  encTag: string;
};

beforeEach(async () => {
  vi.clearAllMocks();
  directory = await mkdtemp(join(tmpdir(), 'paranod-image-scope-'));
  vi.stubEnv('APP_URL', 'https://paranod.example');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
  vi.stubEnv('TEMP_FILE_STORAGE_DIR', directory);
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('BETTER_AUTH_SECRET', '');
  const key = randomBytes(32);
  vi.stubEnv('TEMP_FILE_ENCRYPTION_KEY', key.toString('base64'));
  image = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#336699' }
  })
    .png()
    .toBuffer();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(image), cipher.final()]);
  record = {
    id: 'image-file',
    sizeBytes: image.length,
    expiresAt: null,
    encIv: iv.toString('base64'),
    encTag: cipher.getAuthTag().toString('base64')
  };
  await mkdir(join(directory, 'workspace'));
  await writeFile(join(directory, 'workspace', 'image-file'), encrypted);
  mocks.member.mockImplementation(async ({ where }) =>
    where.userId_workspaceId.userId === 'owner' ? { id: 'member' } : null
  );
  mocks.file.mockImplementation(async ({ where }) =>
    where.workspaceId === 'workspace' && where.id === record.id ? record : null
  );
  mocks.fetch.mockRejectedValue(new Error('Unexpected network request'));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe('explicit image file access', () => {
  it('decrypts the authenticated workspace file without HTTP headers or an auth secret', async () => {
    await expect(loadImageBytes(source, scope)).resolves.toEqual(image);
    expect(mocks.member).toHaveBeenCalledWith({
      where: { userId_workspaceId: scope },
      select: { id: true }
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('fails closed without a server scope and ignores identity in input config', async () => {
    await expect(loadImageBytes(source)).rejects.toThrow('Unauthorized');
    const result = await imagePluginExecutor.execute('image-hash', {
      entity: { id: 'input', type: 'media_url', value: source },
      config: { ...scope }
    });
    expect(result.success).toBe(false);
    expect(mocks.file).not.toHaveBeenCalled();
  });

  it('rejects revoked membership before looking up file metadata', async () => {
    mocks.member.mockResolvedValue(null);
    await expect(loadImageBytes(source, scope)).rejects.toThrow('Unauthorized');
    expect(mocks.file).not.toHaveBeenCalled();
  });

  it('does not cross workspaces, including concurrent background calls', async () => {
    const results = await Promise.allSettled([
      loadImageBytes(source, scope),
      loadImageBytes(source, { ...scope, workspaceId: 'other-workspace' })
    ]);
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: image });
    expect(results[1]).toMatchObject({ status: 'rejected' });
    expect(mocks.file).toHaveBeenCalledWith({
      where: { id: 'image-file', workspaceId: 'other-workspace' }
    });
  });

  it.each(['expired', 'oversized'] as const)(
    'rejects %s images before reading bytes',
    async (kind) => {
      if (kind === 'expired') record.expiresAt = new Date(0);
      else record.sizeBytes = 10_000_001;
      await expect(loadImageBytes(source, scope)).rejects.toThrow(
        'Image not found or too large'
      );
    }
  );

  it('rejects a missing encryption key and modified ciphertext', async () => {
    const key = process.env.TEMP_FILE_ENCRYPTION_KEY!;
    vi.stubEnv('TEMP_FILE_ENCRYPTION_KEY', '');
    await expect(loadImageBytes(source, scope)).rejects.toThrow(
      'File encryption key is not configured'
    );
    vi.stubEnv('TEMP_FILE_ENCRYPTION_KEY', key);
    await writeFile(
      join(directory, 'workspace', 'image-file'),
      Buffer.from('tampered')
    );
    await expect(loadImageBytes(source, scope)).rejects.toThrow();
  });

  it('keeps external image requests behind the bounded public fetcher', async () => {
    mocks.fetch.mockResolvedValue(new Response(new Uint8Array(image)));
    await expect(
      loadImageBytes('https://images.example/image.png')
    ).resolves.toEqual(image);
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://images.example/image.png',
      { maxBytes: 10_000_000 }
    );
    expect(mocks.member).not.toHaveBeenCalled();
  });

  it('runs the real image plugin through agent preparation and execution with a scoped local file', async () => {
    const tx = {
      workspacePluginSetting: { findUnique: async () => null }
    } as unknown as Prisma.TransactionClient;
    const { execution } = await prepareAgentTransform(
      tx,
      scope.workspaceId,
      'image-analysis',
      'image-hash',
      { id: 'input', type: 'media_url', value: source }
    );
    const beforeRequest = vi.fn(async () => {});
    const output = await executeAgentModule(
      execution,
      new AbortController().signal,
      beforeRequest,
      scope
    );
    expect(output.result.entities[0].type).toBe('hash');
    expect(output.result.entities[0].value).toMatch(/^[a-f0-9]{16}$/);
    expect(beforeRequest).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    'http://127.0.0.1/image.png',
    'https://private.internal/image.png',
    'file:///etc/passwd',
    'https://images.example/image.png?secret=value'
  ])('rejects an unsafe agent image source: %s', async (value) => {
    const tx = {
      workspacePluginSetting: { findUnique: async () => null }
    } as unknown as Prisma.TransactionClient;
    await expect(
      prepareAgentTransform(
        tx,
        scope.workspaceId,
        'image-analysis',
        'image-hash',
        { id: 'input', type: 'media_url', value }
      )
    ).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
