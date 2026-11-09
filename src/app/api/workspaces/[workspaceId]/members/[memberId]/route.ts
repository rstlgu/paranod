import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth-session';
import { db } from '@/lib/db';

type RouteContext = {
  params: Promise<{ workspaceId: string; memberId: string }>;
};

class MemberActionError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function lockAndAuthorize(
  tx: Prisma.TransactionClient,
  userId: string,
  workspaceId: string,
  memberId: string
) {
  // Serialize role changes before checking the final administrator. This also
  // ensures a request cannot keep using a role revoked by a concurrent request.
  await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${workspaceId} FOR UPDATE`;
  const actor = await tx.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } }
  });
  if (actor?.role !== 'admin') {
    throw new MemberActionError('Admin access required', 403);
  }
  const member = await tx.workspaceMember.findUnique({
    where: { id: memberId }
  });
  if (!member || member.workspaceId !== workspaceId) {
    throw new MemberActionError('Member not found', 404);
  }
  return member;
}

async function assertAnotherAdmin(
  tx: Prisma.TransactionClient,
  workspaceId: string
) {
  const count = await tx.workspaceMember.count({
    where: { workspaceId, role: 'admin' }
  });
  if (count <= 1)
    throw new MemberActionError('Cannot remove the last admin', 400);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await auth();
    if (!userId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { workspaceId, memberId } = await context.params;
    const { role } = await request.json();
    if (!['admin', 'user'].includes(role)) {
      return NextResponse.json(
        { error: 'Role must be "admin" or "user"' },
        { status: 400 }
      );
    }
    const member = await db.$transaction(async (tx) => {
      const current = await lockAndAuthorize(tx, userId, workspaceId, memberId);
      if (current.role === 'admin' && role === 'user')
        await assertAnotherAdmin(tx, workspaceId);
      const updated = await tx.workspaceMember.update({
        where: { id: memberId },
        data: { role }
      });
      await tx.user.update({ where: { id: current.userId }, data: { role } });
      await tx.session.deleteMany({ where: { userId: current.userId } });
      return updated;
    });
    return NextResponse.json({ member });
  } catch (error) {
    if (error instanceof MemberActionError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    return NextResponse.json(
      { error: 'Failed to update member' },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await auth();
    if (!userId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { workspaceId, memberId } = await context.params;
    await db.$transaction(async (tx) => {
      const member = await lockAndAuthorize(tx, userId, workspaceId, memberId);
      if (member.userId === userId) {
        throw new MemberActionError(
          'You cannot leave the shared workspace',
          403
        );
      }
      if (member.role === 'admin') await assertAnotherAdmin(tx, workspaceId);
      await tx.workspaceMember.delete({ where: { id: memberId } });
      // A removed member must lose global administration rights as well.
      await tx.user.update({
        where: { id: member.userId },
        data: { role: 'user' }
      });
      await tx.session.deleteMany({ where: { userId: member.userId } });
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof MemberActionError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    return NextResponse.json(
      { error: 'Failed to remove member' },
      { status: 500 }
    );
  }
}
