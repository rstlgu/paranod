/**
 * API per impostare l'workspace attiva
 * PUT /api/workspaces/active
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth-session';
import { db } from '@/lib/db';

// PUT - Imposta workspace attiva
export async function PUT(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { workspaceId } = body;

    // Se workspaceId è null, rimuovi l'workspace attiva
    if (workspaceId === null) {
      await db.userPreference.upsert({
        where: { userId },
        update: { activeWorkspaceId: null },
        create: {
          userId,
          activeWorkspaceId: null
        }
      });

      return NextResponse.json({ activeWorkspaceId: null });
    }

    // Verifica che l'utente sia membro dell'workspace
    const membership = await db.workspaceMember.findUnique({
      where: {
        userId_workspaceId: { userId, workspaceId }
      }
    });

    if (!membership) {
      return NextResponse.json(
        { error: 'Not a member of this workspace' },
        { status: 403 }
      );
    }

    // Aggiorna preferenze
    await db.userPreference.upsert({
      where: { userId },
      update: { activeWorkspaceId: workspaceId },
      create: {
        userId,
        activeWorkspaceId: workspaceId
      }
    });

    return NextResponse.json({ activeWorkspaceId: workspaceId });
  } catch {
    return NextResponse.json(
      { error: 'Failed to set active workspace' },
      { status: 500 }
    );
  }
}
