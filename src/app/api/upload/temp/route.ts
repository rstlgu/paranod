import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { privateFilePath } from '@/lib/security/file-delivery';
import { existsSync } from 'fs';
import crypto from 'crypto';
import Busboy from 'busboy';
import { Readable } from 'node:stream';
import { db } from '@/lib/db';
import { getAuthContext } from '@/lib/auth-utils';

// Increase body size limit to 50MB
export const runtime = 'nodejs';
export const maxDuration = 60; // 60 seconds timeout

function tryGetEncryptionKey(): Buffer | null {
  // 32 bytes base64 (AES-256-GCM)
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

function encryptBytes(args: { plaintext: Buffer; key: Buffer }) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', args.key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(args.plaintext),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return { iv, tag, ciphertext };
}

interface TempFileDelegate {
  create: (args: unknown) => Promise<unknown>;
}

function getTempFile() {
  return (db as unknown as { tempFile: TempFileDelegate }).tempFile;
}

async function parseSingleFileMultipart(
  req: NextRequest,
  maxSizeBytes: number
) {
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('multipart/form-data'))
    throw new Error('Invalid content-type');

  const bodyStream = req.body;
  if (!bodyStream) throw new Error('Missing request body');

  const busboy = Busboy({
    headers: { 'content-type': contentType },
    limits: { files: 1, fileSize: maxSizeBytes }
  });

  return await new Promise<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
    size: number;
  }>((resolve, reject) => {
    let hasFile = false;
    let totalSize = 0;
    const chunks: Buffer[] = [];
    let originalName = 'upload';
    let mimeType = 'application/octet-stream';

    busboy.on('file', (_field, file, info) => {
      hasFile = true;
      originalName = info.filename || originalName;
      mimeType = info.mimeType || mimeType;

      file.on('data', (data: Buffer) => {
        totalSize += data.length;
        chunks.push(data);
      });

      file.on('limit', () => {
        reject(new Error('FILE_TOO_LARGE'));
      });

      file.on('error', reject);
    });

    busboy.on('error', reject);

    busboy.on('finish', () => {
      if (!hasFile) return reject(new Error('No file provided'));
      resolve({
        buffer: Buffer.concat(chunks),
        filename: originalName,
        mimeType,
        size: totalSize
      });
    });

    Readable.fromWeb(bodyStream as any).pipe(busboy);
  });
}

export async function POST(req: NextRequest) {
  try {
    const { userId, workspaceId } = await getAuthContext();
    const hasWorkspace = Boolean(workspaceId);
    if (!hasWorkspace) {
      console.error('[upload-temp] Missing active workspace', { userId });
      return NextResponse.json(
        { error: 'Missing active workspace' },
        { status: 400 }
      );
    }

    const membership = await db.workspaceMember.findUnique({
      where: {
        userId_workspaceId: { userId, workspaceId: workspaceId as string }
      },
      select: { role: true }
    });
    if (!membership) {
      console.error('[upload-temp] Forbidden (not workspace member)', {
        userId,
        workspaceId
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const maxSize = 50 * 1024 * 1024; // 50MB
    const parsed = await parseSingleFileMultipart(req, maxSize);

    const key = tryGetEncryptionKey();
    if (!key) {
      console.error('[upload-temp] Missing/invalid TEMP_FILE_ENCRYPTION_KEY', {
        hasKey: Boolean(process.env.TEMP_FILE_ENCRYPTION_KEY),
        userId,
        workspaceId
      });
      return NextResponse.json(
        { error: 'Failed to upload file' },
        { status: 500 }
      );
    }

    // Encrypted workspace-scoped storage.
    const fileId = crypto.randomUUID();
    const filepath = privateFilePath(workspaceId as string, fileId);
    const tempDir = dirname(filepath);
    if (!existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }

    // Opaque ID, no extension

    // Encrypt and save
    const plaintext = parsed.buffer;
    const { iv, tag, ciphertext } = encryptBytes({ plaintext, key });
    await writeFile(filepath, ciphertext);

    await getTempFile().create({
      data: {
        id: fileId,
        workspaceId: workspaceId,
        createdByUserId: userId,
        originalName: parsed.filename,
        mimeType: parsed.mimeType || 'application/octet-stream',
        sizeBytes: parsed.size,
        encIv: iv.toString('base64'),
        encTag: tag.toString('base64'),
        storagePath: `private/temp/${workspaceId}/${fileId}`
      }
    });

    const apiUrl = `/api/upload/temp/${fileId}`;

    return NextResponse.json({
      success: true,
      url: apiUrl,
      path: apiUrl,
      fileId,
      filename: parsed.filename,
      size: parsed.size,
      type: parsed.mimeType
    });
  } catch (error) {
    console.error('[upload-temp] Upload error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message === 'FILE_TOO_LARGE')
      return NextResponse.json(
        { error: 'File is too large. Maximum size is 50MB.' },
        { status: 413 }
      );
    if (
      message.includes('Unexpected end of multipart data') ||
      message.includes('Invalid content-type')
    )
      return NextResponse.json(
        { error: 'Upload interrupted. Please retry.' },
        { status: 400 }
      );
    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 }
    );
  }
}
