/**
 * API Routes per singolo grafo
 * GET /api/graphs/[graphId] - Dettagli grafo
 * PUT /api/graphs/[graphId] - Aggiorna grafo
 * DELETE /api/graphs/[graphId] - Elimina grafo
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth-session';
import { db } from '@/lib/db';
import {
  assertGraphEditable,
  getGraphWriteState
} from '@/features/graph/server/graph-agent-lease';
import { graphWriteErrorResponse } from '@/features/graph/server/graph-write-response';

type RouteContext = {
  params: Promise<{ graphId: string }>;
};

// GET - Dettagli grafo con nodi e edges
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await auth();
    const { graphId } = await context.params;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const graph = await db.graph.findFirst({
      where: { id: graphId, userId }
    });

    if (!graph) {
      return NextResponse.json({ error: 'Graph not found' }, { status: 404 });
    }

    const snapshot = await db.$transaction(async (tx) => {
      const writeState = await getGraphWriteState(tx, graphId);
      const current = await tx.graph.update({
        where: { id: graphId },
        data: { lastOpenedAt: new Date() }
      });
      return { ...current, writeState };
    });

    return NextResponse.json(
      {
        graph: {
          ...snapshot,
          activeCase: await db.case.findUnique({
            where: { id: snapshot.caseId },
            select: { id: true, name: true }
          })
        }
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch graph' },
      { status: 500 }
    );
  }
}

// PUT - Aggiorna grafo (nome, descrizione, nodi, edges)
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await auth();
    const { graphId } = await context.params;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verifica proprietà
    const existing = await db.graph.findFirst({
      where: { id: graphId, userId }
    });

    if (!existing) {
      return NextResponse.json({ error: 'Graph not found' }, { status: 404 });
    }

    const body = await request.json();
    const { name, description, nodes, edges, thumbnail, visibility } = body;

    const updateData: Record<string, unknown> = {};

    if (name !== undefined) {
      updateData.name = name.trim();
    }
    if (description !== undefined) {
      updateData.description = description?.trim() || null;
    }
    if (nodes !== undefined) {
      updateData.nodes = nodes;
      updateData.nodeCount = Array.isArray(nodes) ? nodes.length : 0;
    }
    if (edges !== undefined) {
      updateData.edges = edges;
      updateData.edgeCount = Array.isArray(edges) ? edges.length : 0;
    }
    if (thumbnail !== undefined) {
      updateData.thumbnail = thumbnail;
    }
    if (
      visibility !== undefined &&
      (visibility === 'private' || visibility === 'workspace')
    ) {
      updateData.visibility = visibility;
    }

    // Forza l'aggiornamento di updatedAt
    updateData.updatedAt = new Date();

    const graph = await db.$transaction(async (tx) => {
      await assertGraphEditable(tx, graphId, {
        snapshot: nodes !== undefined || edges !== undefined,
        expectedWriteVersion: body.expectedWriteVersion
      });
      return tx.graph.update({ where: { id: graphId }, data: updateData });
    });

    return NextResponse.json({
      graph: {
        ...graph,
        nodes: graph.nodes,
        edges: graph.edges
      }
    });
  } catch (error) {
    const blocked = graphWriteErrorResponse(error);
    if (blocked) return blocked;
    return NextResponse.json(
      { error: 'Failed to update graph' },
      { status: 500 }
    );
  }
}

// DELETE - Elimina grafo
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await auth();
    const { graphId } = await context.params;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verifica proprietà
    const existing = await db.graph.findFirst({
      where: { id: graphId, userId }
    });

    if (!existing) {
      return NextResponse.json({ error: 'Graph not found' }, { status: 404 });
    }

    await db.$transaction(async (tx) => {
      await assertGraphEditable(tx, graphId);
      await tx.graph.delete({ where: { id: graphId } });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const blocked = graphWriteErrorResponse(error);
    if (blocked) return blocked;
    return NextResponse.json(
      { error: 'Failed to delete graph' },
      { status: 500 }
    );
  }
}
