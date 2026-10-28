import { NextRequest, NextResponse } from 'next/server';
import { readFile, unlink } from 'fs/promises';
import {
  privateFilePath,
  fileDeliveryHeaders
} from '@/lib/security/file-delivery';
import { existsSync } from 'fs';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { getAuthContext } from '@/lib/auth-utils';

function tryGetEncryptionKey(): Buffer | null {
  const raw = process.env.TEMP_FILE_ENCRYPTION_KEY;
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) return null;
    return key;
  } catch {
    return null;
  }
}

function decryptBytes(args: {
  ciphertext: Buffer;
  key: Buffer;
  ivB64: string;
  tagB64: string;
}) {
  const iv = Buffer.from(args.ivB64, 'base64');
  const tag = Buffer.from(args.tagB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', args.key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(args.ciphertext), decipher.final()]);
}

async function requireAuthScope() {
  const { userId, workspaceId } = await getAuthContext();
  if (!workspaceId)
    return {
      ok: false as const,
      status: 400,
      error: 'Missing active workspace'
    };

  const membership = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: workspaceId } },
    select: { role: true }
  });
  if (!membership)
    return { ok: false as const, status: 403, error: 'Forbidden' };

  return { ok: true as const, userId, workspaceId };
}

interface TempFileDelegate {
  findFirst: (args: unknown) => Promise<any>;
  delete: (args: unknown) => Promise<any>;
}

function getTempFile() {
  return (db as unknown as { tempFile: TempFileDelegate }).tempFile;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const authRes = await requireAuthScope();
    if (!authRes.ok)
      return NextResponse.json(
        { error: authRes.error },
        { status: authRes.status }
      );

    const { filename } = await params;
    const fileId = filename;

    // Encrypted workspace-scoped path: lookup in DB by id + workspace
    const record = await getTempFile().findFirst({
      where: { id: fileId, workspaceId: authRes.workspaceId },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        encIv: true,
        encTag: true
      }
    });

    if (!record)
      return NextResponse.json({ error: 'File not found' }, { status: 404 });

    const filepath = privateFilePath(authRes.workspaceId, record.id);
    if (!existsSync(filepath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const ciphertext = await readFile(filepath);
    const key = tryGetEncryptionKey();
    if (!key) {
      console.error(
        '[upload-temp] Missing/invalid TEMP_FILE_ENCRYPTION_KEY (GET)',
        {
          hasKey: Boolean(process.env.TEMP_FILE_ENCRYPTION_KEY),
          workspaceId: authRes.workspaceId
        }
      );
      return NextResponse.json(
        { error: 'Failed to fetch file' },
        { status: 500 }
      );
    }

    const plaintext = decryptBytes({
      ciphertext,
      key,
      ivB64: record.encIv,
      tagB64: record.encTag
    });

    return new NextResponse(new Uint8Array(plaintext), {
      status: 200,
      headers: fileDeliveryHeaders(
        record.mimeType || 'application/octet-stream',
        record.originalName
      )
    });
  } catch (error) {
    console.error('Get file error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch file' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const authRes = await requireAuthScope();
    if (!authRes.ok)
      return NextResponse.json(
        { error: authRes.error },
        { status: authRes.status }
      );

    const { filename } = await params;
    const fileId = filename;

    const record = await getTempFile().findFirst({
      where: { id: fileId, workspaceId: authRes.workspaceId },
      select: { id: true }
    });

    if (!record) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const filepath = privateFilePath(authRes.workspaceId, record.id);
    if (existsSync(filepath)) await unlink(filepath);
    await getTempFile().delete({ where: { id: record.id } });

    return NextResponse.json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    console.error('Delete error:', error);
    return NextResponse.json(
      { error: 'Failed to delete file' },
      { status: 500 }
    );
  }
}
