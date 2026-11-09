import { join } from 'node:path';

export function privateFilePath(workspaceId: string, fileId: string): string {
  if (![workspaceId, fileId].every((v) => /^[a-zA-Z0-9_-]+$/.test(v)))
    throw new Error('Invalid file identifier');
  return join(
    process.env.TEMP_FILE_STORAGE_DIR || join(process.cwd(), 'private', 'temp'),
    workspaceId,
    fileId
  );
}

export function fileDeliveryHeaders(
  mime: string,
  filename: string
): Record<string, string> {
  const type = mime.toLowerCase().split(';')[0].trim();
  const inline = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain'
  ].includes(type);
  return {
    'Content-Type': inline ? type : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename).replace(/'/g, '%27')}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'Cache-Control': 'private, no-store'
  };
}
