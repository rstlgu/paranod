import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('persisted secret encryption', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('SECRETS_ENCRYPTION_KEY', '');
    vi.stubEnv('BETTER_AUTH_SECRET', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects secret persistence without a key', async () => {
    const { encryptSecret } = await import('./secrets');
    expect(() => encryptSecret('a-private-value')).toThrow(
      'required to encrypt'
    );
  });

  it('encrypts with a fresh nonce and authenticates round trips', async () => {
    vi.stubEnv('SECRETS_ENCRYPTION_KEY', 'unit-test-encryption-secret');
    const { encryptSecret, decryptSecret } = await import('./secrets');
    const first = encryptSecret('a-private-value');
    const second = encryptSecret('a-private-value');
    expect(first).not.toContain('a-private-value');
    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe('a-private-value');
    const parts = first.split(':');
    parts[4] = Buffer.from('tampered ciphertext').toString('base64');
    expect(() => decryptSecret(parts.join(':'))).toThrow();
  });

  it('supports an explicitly configured authentication secret as fallback', async () => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'unit-test-authentication-secret');
    const { encryptSecret, decryptSecret } = await import('./secrets');
    expect(decryptSecret(encryptSecret('a-private-value'))).toBe(
      'a-private-value'
    );
  });
});
