/**
 * Cifratura at-rest dei secret di configurazione (API key dei plugin/addon).
 *
 * AES-256-GCM con chiave da `SECRETS_ENCRYPTION_KEY`:
 * - 32 byte in base64/hex, oppure una passphrase qualsiasi (derivata SHA-256).
 * - Formato valore cifrato: `enc:v1:<iv b64>:<tag b64>:<ciphertext b64>`.
 *
 * Docker generates and persists the encryption key on first startup.
 * Outside Docker, configure SECRETS_ENCRYPTION_KEY or BETTER_AUTH_SECRET.
 * Missing keys are rejected before storing secrets.
 *
 * Server-only: mai importare da codice client.
 */

import crypto from 'crypto';

const PREFIX = 'enc:v1:';

let cachedKey: Buffer | null | undefined;

function loadKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;

  const raw =
    process.env.SECRETS_ENCRYPTION_KEY || process.env.BETTER_AUTH_SECRET;
  if (!raw) {
    cachedKey = null;
    return null;
  }

  // 32 byte esatti in base64 o hex, altrimenti passphrase → SHA-256
  try {
    const b64 = Buffer.from(raw, 'base64');
    if (b64.length === 32) {
      cachedKey = b64;
      return cachedKey;
    }
  } catch {
    // not base64
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    cachedKey = Buffer.from(raw, 'hex');
    return cachedKey;
  }
  cachedKey = crypto.createHash('sha256').update(raw, 'utf8').digest();
  return cachedKey;
}

function requireKey(): Buffer {
  const key = loadKey();
  if (key) return key;
  throw new Error(
    'SECRETS_ENCRYPTION_KEY or BETTER_AUTH_SECRET is required to encrypt secrets.'
  );
}

export function isEncryptedSecret(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** Encrypt a secret before persisting it. */
export function encryptSecret(plaintext: string): string {
  const key = requireKey();

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/**
 * Decifra un secret. Valori non cifrati preesistenti passano
 * invariati, così la migrazione è trasparente.
 */
export function decryptSecret(value: string): string {
  if (!isEncryptedSecret(value)) return value;

  const key = loadKey();
  if (!key) {
    throw new Error(
      'Cannot decrypt secret: SECRETS_ENCRYPTION_KEY is not set (or changed).'
    );
  }

  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Malformed encrypted secret.');
  const [ivB64, tagB64, dataB64] = parts;

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final()
  ]);
  return plain.toString('utf8');
}
