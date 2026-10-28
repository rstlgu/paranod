/**
 * API Routes per i membri dell'workspace
 * GET /api/workspaces/[workspaceId]/members - Lista membri
 * POST /api/workspaces/[workspaceId]/members - Crea utente
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth-session';
import { authService } from '@/lib/auth';
import { db } from '@/lib/db';

type RouteContext = {
  params: Promise<{ workspaceId: string }>;
};

// Verifica se l'utente è admin dell'workspace
async function isWorkspaceAdmin(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const membership = await db.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId, workspaceId: workspaceId }
    }
  });
  return membership?.role === 'admin';
}

// Verifica se l'utente è membro dell'workspace
async function isWorkspaceMember(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const membership = await db.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId, workspaceId: workspaceId }
    }
  });
  return !!membership;
}

// GET - Lista membri
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await auth();
    const { workspaceId } = await context.params;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verifica membership
    if (!(await isWorkspaceMember(userId, workspaceId))) {
      return NextResponse.json({ error: 'Not a member' }, { status: 403 });
    }

    const members = await db.workspaceMember.findMany({
      where: { workspaceId: workspaceId },
      orderBy: { createdAt: 'asc' }
    });

    const users = await db.user.findMany({
      where: { id: { in: members.map((member) => member.userId) } },
      select: { id: true, name: true, email: true, image: true }
    });
    const usersById = new Map(users.map((user) => [user.id, user]));
    const membersWithUsers = members.map((member) => ({
      ...member,
      user: usersById.get(member.userId) || null
    }));

    return NextResponse.json({ members: membersWithUsers });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch members' },
      { status: 500 }
    );
  }
}

// POST - Crea utente (solo admin)
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await auth();
    const { workspaceId } = await context.params;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verifica admin
    if (!(await isWorkspaceAdmin(userId, workspaceId))) {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { email, password, role = 'user' } = body;

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Verifica email valida
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    if (typeof password !== 'string' || password.length < 10) {
      return NextResponse.json(
        { error: 'Password must be at least 10 characters' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase();
    const existingUser = await db.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true }
    });
    if (existingUser) {
      return NextResponse.json(
        { error: 'A user with this email already exists' },
        { status: 400 }
      );
    }

    const created = await authService.api.createUser({
      headers: request.headers,
      body: {
        email: normalizedEmail,
        password,
        name: normalizedEmail.split('@')[0],
        role: role === 'admin' ? 'admin' : 'user'
      }
    });

    const membership = await db.workspaceMember.upsert({
      where: {
        userId_workspaceId: {
          userId: created.user.id,
          workspaceId
        }
      },
      update: { role: role === 'admin' ? 'admin' : 'user' },
      create: {
        userId: created.user.id,
        workspaceId,
        role: role === 'admin' ? 'admin' : 'user'
      }
    });

    await db.userPreference.upsert({
      where: { userId: created.user.id },
      update: { activeWorkspaceId: workspaceId },
      create: { userId: created.user.id, activeWorkspaceId: workspaceId }
    });

    return NextResponse.json(
      { member: { ...membership, user: created.user } },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { error: 'Failed to create user' },
      { status: 500 }
    );
  }
}
