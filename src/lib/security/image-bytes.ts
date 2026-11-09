import { readFile } from 'node:fs/promises';
import { createDecipheriv } from 'node:crypto';
import { db } from '@/lib/db';
import type { PluginExecutionContext } from '@/features/plugins/types';
import { privateFilePath } from './file-delivery';
import { safePublicFetch } from './safe-fetch';
import { buildAppUrl } from '@/lib/url';

export function localImageFileId(value: string): string | null {
  const base = new URL(buildAppUrl('/'));
  const url = new URL(value, base);
  return url.origin === base.origin &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^\/api\/upload\/temp\/[a-zA-Z0-9_-]+$/.test(url.pathname)
    ? url.pathname.split('/').pop()!
    : null;
}

export async function loadImageBytes(
  value: string,
  context?: PluginExecutionContext
): Promise<Buffer> {
  const base = new URL(buildAppUrl('/'));
  const url = new URL(value, base);
  const fileId = localImageFileId(value);
  if (!fileId) {
    const response = await safePublicFetch(url.toString(), {
      maxBytes: 10_000_000
    });
    if (!response.ok) throw new Error('Unable to fetch image');
    return Buffer.from(await response.arrayBuffer());
  }
  // Callers supply their authenticated request or persisted agent-run scope.
  // Recheck membership here so background work cannot use revoked access.
  if (!context?.userId || !context.workspaceId) throw new Error('Unauthorized');
  const { userId, workspaceId } = context;
  const membership = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { id: true }
  });
  if (!membership) throw new Error('Unauthorized');
  const record = await db.tempFile.findFirst({
    where: { id: fileId, workspaceId }
  });
  if (
    !record ||
    record.sizeBytes > 10_000_000 ||
    (record.expiresAt && record.expiresAt < new Date())
  )
    throw new Error('Image not found or too large');
  const key = Buffer.from(process.env.TEMP_FILE_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32)
    throw new Error('File encryption key is not configured');
  const bytes = await readFile(privateFilePath(workspaceId, record.id));
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(record.encIv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(record.encTag, 'base64'));
  return Buffer.concat([decipher.update(bytes), decipher.final()]);
}
