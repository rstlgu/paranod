/**
 * API Routes per la gestione dei grafi
 * GET /api/graphs - Lista grafi dell'workspace
 * POST /api/graphs - Crea nuovo grafo
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth-session';
import { db } from '@/lib/db';

// Helper per ottenere l'workspace attiva
async function getActiveWorkspace(userId: string) {
  const prefs = await db.userPreference.findUnique({
    where: { userId },
    select: { activeWorkspaceId: true }
  });
  return prefs?.activeWorkspaceId || null;
}

// GET - Lista grafi dell'workspace
export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const activeWorkspaceId = await getActiveWorkspace(userId);

    if (!activeWorkspaceId) {
      // Utente non ha un'workspace attiva
      return NextResponse.json({
        graphs: [],
        requiresWorkspace: true
      });
    }

    // Mostra tutti i grafi dell'workspace:
    // - Grafi condivisi (visibility = workspace)
    // - Grafi privati dell'utente corrente (visibility = private E userId = current user)
    const graphs = await db.graph.findMany({
      where: {
        workspaceId: activeWorkspaceId,
        OR: [{ visibility: 'workspace' }, { visibility: 'private', userId }]
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        nodeCount: true,
        edgeCount: true,
        thumbnail: true,
        createdAt: true,
        updatedAt: true,
        lastOpenedAt: true,
        userId: true,
        visibility: true,
        caseId: true,
        case: { select: { id: true, name: true } }
      }
    });

    return NextResponse.json({ graphs });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch graphs' },
      { status: 500 }
    );
  }
}

// POST - Crea nuovo grafo
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const activeWorkspaceId = await getActiveWorkspace(userId);

    if (!activeWorkspaceId) {
      return NextResponse.json(
        { error: 'You must be part of an workspace to create graphs' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { name, description, visibility = 'workspace', caseId } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    if (!caseId || typeof caseId !== 'string') {
      return NextResponse.json(
        { error: 'A case is required to create a graph' },
        { status: 400 }
      );
    }

    const graphCase = await db.case.findFirst({
      where: { id: caseId, workspaceId: activeWorkspaceId },
      select: { id: true }
    });
    if (!graphCase) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }

    // Valida visibility
    const validVisibility = visibility === 'private' ? 'private' : 'workspace';

    const graph = await db.graph.create({
      data: {
        userId,
        workspaceId: activeWorkspaceId,
        caseId,
        visibility: validVisibility,
        name: name.trim(),
        description: description?.trim() || null,
        nodes: [],
        edges: [],
        nodeCount: 0,
        edgeCount: 0
      }
    });

    return NextResponse.json({ graph }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create graph' },
      { status: 500 }
    );
  }
}
