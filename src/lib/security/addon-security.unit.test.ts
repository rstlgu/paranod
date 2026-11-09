import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADDON_NONCE_HEADER,
  ADDON_SIGNATURE_HEADER,
  ADDON_TIMESTAMP_HEADER,
  ADDON_WORKSPACE_HEADER,
  createAddonRequestHeaders,
  getAddonInstallToken,
  redactAddonUrl
} from './addon-request';
import { HMACVerifier } from './hmac';
import { safeFetch } from './safe-fetch';
import { isPrivateIp, resolvePublicUrl } from './ssrf';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('addon request authentication', () => {
  it('signs the complete canonical request', () => {
    const body = JSON.stringify({ transformId: 'lookup' });
    const workspaceId = 'workspace-1';
    const secret = 's'.repeat(64);
    const headers = createAddonRequestHeaders(body, workspaceId, secret);
    const canonical = `${headers[ADDON_TIMESTAMP_HEADER]}.${headers[ADDON_NONCE_HEADER]}.${headers[ADDON_WORKSPACE_HEADER]}.${body}`;
    const signature = HMACVerifier.extractSignature(
      headers[ADDON_SIGNATURE_HEADER]
    );

    expect(signature).not.toBeNull();
    expect(
      HMACVerifier.verifySignature(canonical, signature as string, secret)
    ).toBe(true);
    expect(
      HMACVerifier.verifySignature(
        `${canonical}tampered`,
        signature as string,
        secret
      )
    ).toBe(false);
  });

  it('redacts credentials from URL paths, queries, fragments and user info', () => {
    const secret = 'private-installation-token';
    expect(
      redactAddonUrl(
        `https://user:${secret}@addon.example/${secret}/manifest.json?token=${secret}#${secret}`
      )
    ).toBe('https://addon.example/[REDACTED]');
    expect(redactAddonUrl(`not a URL ${secret}`)).not.toContain(secret);
  });

  it('requires a strong personalized token and redacts query parameters', () => {
    const token = 'a'.repeat(32);
    const url = `https://addon.example/manifest.json?installToken=${token}&account=42`;

    expect(getAddonInstallToken(url)).toBe(token);
    expect(redactAddonUrl(url)).not.toContain(token);
    expect(() =>
      getAddonInstallToken('https://addon.example/manifest.json?token=short')
    ).toThrow(/at least 32/);
  });
});

describe('addon SSRF controls', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '::1',
    '::ffff:7f00:1'
  ])('rejects private or reserved address %s', (address) => {
    expect(isPrivateIp(address)).toBe(true);
  });

  it('allows local destinations only through the explicit allowlist', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PARANOD_ADDON_ALLOWED_HOSTS', '');
    await expect(resolvePublicUrl('http://127.0.0.1:3000')).rejects.toThrow(
      /not allowed/
    );

    vi.stubEnv('PARANOD_ADDON_ALLOWED_HOSTS', '127.0.0.1');
    await expect(
      resolvePublicUrl('http://127.0.0.1:3000')
    ).resolves.toMatchObject({
      addresses: [{ address: '127.0.0.1', family: 4 }]
    });
  });
});

describe('safe addon HTTP client', () => {
  it('pins allowed DNS results and blocks POST redirects', async () => {
    vi.stubEnv('PARANOD_ADDON_ALLOWED_HOSTS', '127.0.0.1');
    const server = http.createServer((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(307, { Location: '/ok' });
        response.end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Test server did not bind to a TCP port');
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const response = await safeFetch(`${baseUrl}/ok`, {
        maxResponseBytes: 1024
      });
      await expect(response.json()).resolves.toEqual({ ok: true });
      await expect(
        safeFetch(`${baseUrl}/redirect`, {
          method: 'POST',
          body: '{}',
          maxResponseBytes: 1024
        })
      ).rejects.toThrow(/Redirects are not allowed/);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
