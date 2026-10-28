import { beforeEach, describe, expect, it, vi } from 'vitest';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { admin } from 'better-auth/plugins';

const mocks = vi.hoisted(() => ({ count: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { user: { count: mocks.count } } }));
import { prepareUserCreation } from './setup';

const user = { id: 'candidate', email: 'owner@example.test', role: 'user' };

describe('initial account creation boundary', () => {
  beforeEach(() => vi.resetAllMocks());

  it('rejects a late signup after another request has completed setup', async () => {
    // This request may already have passed the route-level count before the
    // first signup committed. The database hook must still reject it.
    mocks.count.mockResolvedValue(1);
    await expect(
      prepareUserCreation(user, { path: '/sign-up/email' })
    ).rejects.toMatchObject({
      status: 'FORBIDDEN',
      body: { code: 'PUBLIC_SIGNUP_CLOSED' }
    });
  });

  it('makes every concurrent public signup claim the same database-unique bootstrap key', async () => {
    mocks.count.mockResolvedValue(0);
    const results = await Promise.all([
      prepareUserCreation(user, { path: '/sign-up/email' }),
      prepareUserCreation(
        { ...user, id: 'another', email: 'another@example.test' },
        { path: '/sign-up/email' }
      )
    ]);
    for (const result of results) {
      expect(result.data).toMatchObject({
        role: 'admin',
        bootstrapKey: 'oss-initial-admin'
      });
    }
  });

  it('preserves administrator-created roles without claiming the bootstrap key', async () => {
    expect(
      await prepareUserCreation(user, { path: '/admin/create-user' })
    ).toEqual({ data: user });
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it.each([null, { path: '/callback/google' }, { path: '/unexpected' }])(
    'rejects unrecognized creation contexts %s',
    async (context) => {
      await expect(prepareUserCreation(user, context)).rejects.toMatchObject({
        status: 'FORBIDDEN'
      });
      expect(mocks.count).not.toHaveBeenCalled();
    }
  );

  it('receives the expected context through the installed Better Auth signup and admin endpoints', async () => {
    const store: Record<string, any[]> = {
      user: [],
      account: [],
      session: [],
      verification: []
    };
    mocks.count.mockImplementation(async () => store.user.length);
    const before = vi.fn(prepareUserCreation);
    const service = betterAuth({
      baseURL: 'http://localhost:3000',
      secret: 'unit-test-auth-secret-with-at-least-thirty-two-characters',
      database: memoryAdapter(store),
      emailAndPassword: { enabled: true, minPasswordLength: 10 },
      user: {
        additionalFields: { bootstrapKey: { type: 'string', input: false } }
      },
      databaseHooks: { user: { create: { before } } },
      plugins: [admin()]
    });
    const owner = await service.api.signUpEmail({
      body: {
        name: 'Owner',
        email: 'owner@example.test',
        password: 'a-long-test-password'
      }
    });
    expect(before.mock.calls[0][1]).toMatchObject({ path: '/sign-up/email' });
    expect(owner.user.role).toBe('admin');
    expect(store.user).toHaveLength(1);
    expect(store.user[0].bootstrapKey).toBe('oss-initial-admin');

    const lateResponse = await service.api.signUpEmail({
      body: {
        name: 'Late',
        email: 'late@example.test',
        password: 'another-long-password'
      },
      asResponse: true
    });
    expect(lateResponse.status).toBe(403);
    expect(await lateResponse.json()).toMatchObject({
      code: 'PUBLIC_SIGNUP_CLOSED'
    });
    expect(store.user).toHaveLength(1);

    const member = await service.api.createUser({
      body: {
        name: 'Member',
        email: 'member@example.test',
        password: 'member-long-password',
        role: 'user'
      }
    });
    expect(before.mock.calls.at(-1)?.[1]).toMatchObject({
      path: '/admin/create-user'
    });
    expect(member.user.role).toBe('user');
    expect(store.user).toHaveLength(2);
    expect(store.user[1].bootstrapKey).toBeUndefined();
  });
});
