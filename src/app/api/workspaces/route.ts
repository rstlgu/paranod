/**
 * API Routes per le workspace
 * GET /api/workspaces - Lista workspace dell'utente
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth-session';
import { db } from '@/lib/db';

// GET - Lista workspace dell'utente
export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Trova tutte le membership dell'utente
    const memberships = await db.workspaceMember.findMany({
      where: { userId },
      include: {
        workspace: {
          include: {
            members: {
              select: { id: true }
            }
          }
        }
      }
    });

    const workspaces = memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      slug: m.workspace.slug,
      description: m.workspace.description,
      logo: m.workspace.logo,
      role: m.role,
      memberCount: m.workspace.members.length,
      createdAt: m.workspace.createdAt,
      updatedAt: m.workspace.updatedAt
    }));

    // Ottieni preferenze utente per workspace attiva
    const preferences = await db.userPreference.findUnique({
      where: { userId },
      select: { activeWorkspaceId: true }
    });

    return NextResponse.json({
      workspaces,
      activeWorkspaceId: preferences?.activeWorkspaceId || null
    });
  } catch (error) {
    console.error('GET /api/workspaces error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch workspaces', details: String(error) },
      { status: 500 }
    );
  }
}
