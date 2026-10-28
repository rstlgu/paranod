import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  addon: vi.fn(),
  update: vi.fn(),
  validate: vi.fn(),
  endpoints: vi.fn()
}));
vi.mock('@/lib/auth-utils', () => ({
  getActiveWorkspaceAccess: async () => ({
    userId: 'admin',
    workspaceId: 'workspace',
    role: 'admin'
  })
}));
vi.mock('@/lib/db', () => ({
  db: {
    customPlugin: { findUnique: async () => null },
    workspaceAddonInstall: { findUnique: mocks.addon, update: mocks.update },
    workspace: { findUnique: async () => ({ name: 'Workspace' }) },
    transformJob: { count: async () => 0 }
  }
}));
vi.mock('@/features/plugins/registry', () => ({ getPlugin: () => undefined }));
vi.mock('@/lib/security/safe-fetch', () => ({ safeFetch: mocks.fetch }));
vi.mock('@/lib/security/secrets', () => ({
  decryptSecret: (v: string) => v,
  encryptSecret: (v: string) => v
}));
vi.mock('@/lib/url', () => ({ buildAppUrl: () => 'http://localhost/' }));
vi.mock('@/lib/validators/manifest-validator', () => ({
  ManifestValidator: {
    fetchAndValidate: mocks.validate,
    validateAllEndpoints: mocks.endpoints
  }
}));
import { POST } from './install/route';
import { DELETE } from './[addonId]/route';
const secret = 'synthetic-personalized-install-token-123';
const manifestUrl = `https://addon.example/${secret}/manifest.json?installToken=${secret}`;
let logged: unknown[][];
beforeEach(() => {
  vi.resetAllMocks();
  logged = [];
  for (const method of ['log', 'error', 'warn'] as const)
    vi.spyOn(console, method).mockImplementation((...args) => {
      logged.push(args);
    });
  mocks.addon.mockResolvedValue(null);
  mocks.validate.mockResolvedValue({
    valid: true,
    manifest: {
      manifestVersion: '1.0',
      plugin: { id: 'example-addon', name: 'Example', version: '1.0.0' }
    }
  });
  mocks.endpoints.mockResolvedValue({ valid: true });
  mocks.fetch.mockRejectedValue(new Error(`Failed request ${manifestUrl}`));
  mocks.update.mockResolvedValue({});
});
afterEach(() => {
  vi.restoreAllMocks();
});
describe('personalized addon endpoint diagnostics', () => {
  it('keeps registration credentials out of logs and failure responses', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/addons/install', {
        method: 'POST',
        body: JSON.stringify({ manifestUrl })
      })
    );
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(secret);
    expect(JSON.stringify(logged)).not.toContain(secret);
    expect(mocks.fetch.mock.calls[0][0]).toContain(secret);
  });
  it('keeps unregister credentials out of logs while preserving local removal after an upstream failure', async () => {
    mocks.addon.mockResolvedValue({
      manifestUrl,
      webhookSecret: 'synthetic-signing-key'
    });
    const response = await DELETE(
      new NextRequest('http://localhost/api/addons/example-addon', {
        method: 'DELETE'
      }),
      {
        params: Promise.resolve({ addonId: 'example-addon' })
      }
    );
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(secret);
    expect(JSON.stringify(logged)).not.toContain(secret);
    expect(mocks.update).toHaveBeenCalledOnce();
  });
});
