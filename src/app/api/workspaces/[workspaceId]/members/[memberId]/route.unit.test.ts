import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  lock: vi.fn(),
  findUnique: vi.fn(),
  count: vi.fn(),
  remove: vi.fn(),
  updateMembership: vi.fn(),
  updateUser: vi.fn(),
  revokeSessions: vi.fn(),
  transaction: vi.fn()
}));
vi.mock('@/lib/auth-session', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({
  db: {
    workspaceMember: { findUnique: mocks.findUnique, count: mocks.count },
    $transaction: mocks.transaction
  }
}));
import { DELETE, PUT } from './route';

const context = {
  params: Promise.resolve({ workspaceId: 'workspace', memberId: 'member' })
};
const request = () =>
  new NextRequest('http://localhost/api/workspaces/workspace/members/member');

describe('single-workspace member authorization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ userId: 'admin-user' });
    mocks.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(
        where.id
          ? {
              id: 'member',
              userId: 'other-user',
              workspaceId: 'workspace',
              role: 'admin'
            }
          : { userId: 'admin-user', workspaceId: 'workspace', role: 'admin' }
      )
    );
    mocks.count.mockResolvedValue(2);
    mocks.transaction.mockImplementation((callback) =>
      callback({
        workspaceMember: {
          delete: mocks.remove,
          update: mocks.updateMembership,
          findUnique: mocks.findUnique,
          count: mocks.count
        },
        $queryRaw: mocks.lock,
        user: { update: mocks.updateUser },
        session: { deleteMany: mocks.revokeSessions }
      })
    );
  });

  it('removes membership, global admin rights and sessions within one transaction', async () => {
    const response = await DELETE(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.findUnique.mock.invocationCallOrder[0]
    );
    expect(mocks.count.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.remove.mock.invocationCallOrder[0]
    );
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: 'member' } });
    expect(mocks.updateUser).toHaveBeenCalledWith({
      where: { id: 'other-user' },
      data: { role: 'user' }
    });
    expect(mocks.revokeSessions).toHaveBeenCalledWith({
      where: { userId: 'other-user' }
    });
  });

  it('refreshes sessions after changing a role', async () => {
    const response = await PUT(
      new NextRequest(request(), {
        method: 'PUT',
        body: JSON.stringify({ role: 'user' })
      }),
      context
    );
    expect(response.status).toBe(200);
    expect(mocks.updateMembership).toHaveBeenCalledWith({
      where: { id: 'member' },
      data: { role: 'user' }
    });
    expect(mocks.updateUser).toHaveBeenCalledWith({
      where: { id: 'other-user' },
      data: { role: 'user' }
    });
    expect(mocks.revokeSessions).toHaveBeenCalledWith({
      where: { userId: 'other-user' }
    });
  });

  it('preserves the last administrator', async () => {
    mocks.count.mockResolvedValue(1);
    expect((await DELETE(request(), context)).status).toBe(400);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.revokeSessions).not.toHaveBeenCalled();
  });

  it('does not allow leaving the shared workspace', async () => {
    mocks.auth.mockResolvedValue({ userId: 'other-user' });
    expect((await DELETE(request(), context)).status).toBe(403);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.revokeSessions).not.toHaveBeenCalled();
  });

  it('rejects a user without administrative membership', async () => {
    mocks.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(
        where.id
          ? {
              id: 'member',
              userId: 'other-user',
              workspaceId: 'workspace',
              role: 'user'
            }
          : { role: 'user' }
      )
    );
    expect((await DELETE(request(), context)).status).toBe(403);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.revokeSessions).not.toHaveBeenCalled();
  });
});
