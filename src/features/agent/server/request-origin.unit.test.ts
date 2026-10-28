import { afterEach, expect, it, vi } from 'vitest';
import { agentMutationOriginError } from './request-origin';
afterEach(() => vi.unstubAllEnvs());
it('rejects cross-site and mismatched origins before agent mutations', () => {
  const origins: HeadersInit[] = [
    { origin: 'https://other.example' },
    { origin: 'null' },
    { 'sec-fetch-site': 'cross-site' }
  ];
  for (const headers of origins)
    expect(
      agentMutationOriginError(
        new Request('https://app.example/api/agent/runs', { headers })
      )?.status
    ).toBe(403);
  expect(
    agentMutationOriginError(
      new Request('https://app.example/api/agent/runs', {
        headers: { origin: 'https://app.example' }
      })
    )
  ).toBeNull();
});
it('supports configured reverse-proxy origins without trusting forwarded headers', () => {
  vi.stubEnv('BETTER_AUTH_URL', 'https://app.example');
  expect(
    agentMutationOriginError(
      new Request('http://localhost:3000/api/agent/runs', {
        headers: { origin: 'https://app.example' }
      })
    )
  ).toBeNull();
  expect(
    agentMutationOriginError(
      new Request('http://localhost:3000/api/agent/runs', {
        headers: {
          origin: 'https://other.example',
          'x-forwarded-host': 'other.example'
        }
      })
    )?.status
  ).toBe(403);
});
