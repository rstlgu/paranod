/**
 * API Routes per singola workspace
 * GET /api/workspaces/[workspaceId] - Dettagli workspace
 * PUT /api/workspaces/[workspaceId] - Aggiorna workspace
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth-session';
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

// GET - Dettagli workspace
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

    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        members: {
          select: {
            id: true,
            userId: true,
            role: true,
            createdAt: true
          }
        },
        _count: {
          select: {
            graphs: true,
            pluginSettings: true
          }
        }
      }
    });

    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    // Ottieni il ruolo dell'utente corrente
    const currentMembership = workspace.members.find(
      (m) => m.userId === userId
    );

    return NextResponse.json({
      workspace: {
        ...workspace,
        currentUserRole: currentMembership?.role || 'user',
        graphCount: workspace._count.graphs,
        pluginSettingCount: workspace._count.pluginSettings
      }
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch workspace' },
      { status: 500 }
    );
  }
}

// PUT - Aggiorna workspace (solo admin)
export async function PUT(request: NextRequest, context: RouteContext) {
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
    const { name, description, logo } = body;

    if (name !== undefined && name !== 'Your Workspace') {
      return NextResponse.json(
        { error: 'The shared workspace name is fixed to Your Workspace' },
        { status: 403 }
      );
    }

    const updateData: Record<string, unknown> = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length < 2) {
        return NextResponse.json(
          { error: 'Name must be at least 2 characters' },
          { status: 400 }
        );
      }
      updateData.name = name.trim();
    }

    if (description !== undefined) {
      updateData.description = description?.trim() || null;
    }

    if (logo !== undefined) {
      updateData.logo = logo || null;
    }

    const workspace = await db.workspace.update({
      where: { id: workspaceId },
      data: updateData
    });

    return NextResponse.json({ workspace });
  } catch {
    return NextResponse.json(
      { error: 'Failed to update workspace' },
      { status: 500 }
    );
  }
}
