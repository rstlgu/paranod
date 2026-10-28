import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  get: vi.fn(),
  post: vi.fn()
}));
vi.mock('@/lib/db', () => ({ db: { user: { count: mocks.count } } }));
vi.mock('@/lib/auth', () => ({ authService: {} }));
vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: () => ({ GET: mocks.get, POST: mocks.post })
}));
import { GET, POST } from './route';

const request = (path: string) =>
  new NextRequest(`http://localhost/api/auth/${path}`);

describe('public authentication boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.get.mockResolvedValue(NextResponse.json({ ok: true }));
    mocks.post.mockResolvedValue(NextResponse.json({ ok: true }));
    mocks.count.mockResolvedValue(1);
  });
  it('allows the initial administrator signup', async () => {
    mocks.count.mockResolvedValue(0);
    expect((await POST(request('sign-up/email'))).status).toBe(200);
    expect(mocks.post).toHaveBeenCalledOnce();
  });
  it('closes public signup after initial setup', async () => {
    expect((await POST(request('sign-up/email'))).status).toBe(403);
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it.each(['set-role', 'remove-user', 'create-user'])(
    'blocks public admin/%s from bypassing workspace controls',
    async (method) => {
      expect((await POST(request(`admin/${method}`))).status).toBe(403);
      expect(mocks.post).not.toHaveBeenCalled();
    }
  );
  it('allows ordinary account session management', async () => {
    expect((await GET(request('list-sessions'))).status).toBe(200);
    expect((await POST(request('revoke-session'))).status).toBe(200);
    expect(mocks.get).toHaveBeenCalledOnce();
    expect(mocks.post).toHaveBeenCalledOnce();
  });
});
