import crypto from 'node:crypto';
import { HMACVerifier } from './hmac';

export const ADDON_SIGNATURE_HEADER = 'X-Relazio-Signature';
export const ADDON_TIMESTAMP_HEADER = 'X-Relazio-Timestamp';
export const ADDON_NONCE_HEADER = 'X-Relazio-Nonce';
export const ADDON_WORKSPACE_HEADER = 'X-Relazio-Workspace-Id';

export function createAddonRequestHeaders(
  body: string,
  workspaceId: string,
  secret: string
): Record<string, string> {
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const canonical = `${timestamp}.${nonce}.${workspaceId}.${body}`;

  return {
    'Content-Type': 'application/json',
    [ADDON_WORKSPACE_HEADER]: workspaceId,
    [ADDON_TIMESTAMP_HEADER]: timestamp,
    [ADDON_NONCE_HEADER]: nonce,
    [ADDON_SIGNATURE_HEADER]: HMACVerifier.createSignatureHeader(
      canonical,
      secret
    )
  };
}

export function getAddonInstallToken(manifestUrl: string): string {
  const url = new URL(manifestUrl);
  const token =
    url.searchParams.get('installToken') || url.searchParams.get('token');
  if (!token || token.length < 32) {
    throw new Error(
      'Manifest URL must include an installToken query parameter of at least 32 characters'
    );
  }
  return token;
}

/** Log only the destination origin: paths and queries can both carry credentials. */
export function redactAddonUrl(rawUrl: string): string {
  try {
    return `${new URL(rawUrl).origin}/[REDACTED]`;
  } catch {
    return '[invalid addon URL]';
  }
}
