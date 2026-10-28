import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { assertGraphEditable } from '@/features/graph/server/graph-agent-lease';
import { graphWriteErrorResponse } from '@/features/graph/server/graph-write-response';
import {
  requireActiveWorkspaceMember,
  requireCaseInWorkspace
} from '@/app/api/cases/_utils';

type RouteContext = {
  params: Promise<{ caseId: string }>;
};

interface PreviewNode {
  id: string;
  x: number;
  y: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildGraphPreview(nodesValue: unknown, edgesValue: unknown) {
  const sourceNodes = Array.isArray(nodesValue) ? nodesValue.slice(0, 48) : [];
  const positionedNodes = sourceNodes.flatMap((value, index) => {
    const node = asRecord(value);
    if (!node || typeof node.id !== 'string') return [];

    const position =
      asRecord(node.positionAbsolute) ?? asRecord(node.position) ?? {};
    return [
      {
        id: node.id,
        rawX: finiteNumber(position.x) ?? (index % 8) * 140,
        rawY: finiteNumber(position.y) ?? Math.floor(index / 8) * 90
      }
    ];
  });

  const minX = positionedNodes.length
    ? Math.min(...positionedNodes.map((node) => node.rawX))
    : 0;
  const maxX = positionedNodes.length
    ? Math.max(...positionedNodes.map((node) => node.rawX))
    : 0;
  const minY = positionedNodes.length
    ? Math.min(...positionedNodes.map((node) => node.rawY))
    : 0;
  const maxY = positionedNodes.length
    ? Math.max(...positionedNodes.map((node) => node.rawY))
    : 0;
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  const nodes: PreviewNode[] = positionedNodes.map((node) => ({
    id: node.id,
    x: spanX ? 16 + ((node.rawX - minX) / spanX) * 168 : 100,
    y: spanY ? 16 + ((node.rawY - minY) / spanY) * 70 : 48
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));

  const edges = (Array.isArray(edgesValue) ? edgesValue : [])
    .flatMap((value) => {
      const edge = asRecord(value);
      if (
        !edge ||
        typeof edge.source !== 'string' ||
        typeof edge.target !== 'string' ||
        !nodeIds.has(edge.source) ||
        !nodeIds.has(edge.target)
      ) {
        return [];
      }
      return [{ source: edge.source, target: edge.target }];
    })
    .slice(0, 72);

  return { nodes, edges };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireActiveWorkspaceMember();
    if (!auth.ok)
      return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { caseId } = await context.params;
    const foundCase = await requireCaseInWorkspace({
      caseId,
      workspaceId: auth.ctx.workspaceId
    });
    if (!foundCase)
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });

    const graphs = await db.graph.findMany({
      where: {
        caseId,
        OR: [
          { visibility: 'workspace' },
          { visibility: 'private', userId: auth.ctx.userId }
        ]
      },
      orderBy: [
        { lastOpenedAt: { sort: 'desc', nulls: 'last' } },
        { updatedAt: 'desc' }
      ],
      select: {
        id: true,
        name: true,
        description: true,
        updatedAt: true,
        createdAt: true,
        visibility: true,
        userId: true,
        nodeCount: true,
        edgeCount: true,
        thumbnail: true,
        lastOpenedAt: true,
        nodes: true,
        edges: true
      }
    });

    return NextResponse.json({
      graphs: graphs.map(({ nodes, edges, ...graph }) => ({
        ...graph,
        preview: buildGraphPreview(nodes, edges)
      }))
    });
  } catch (error) {
    console.error('GET /api/cases/[caseId]/graphs error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch case graphs' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireActiveWorkspaceMember();
    if (!auth.ok)
      return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { caseId } = await context.params;
    const foundCase = await requireCaseInWorkspace({
      caseId,
      workspaceId: auth.ctx.workspaceId
    });
    if (!foundCase)
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const graphId = typeof body?.graphId === 'string' ? body.graphId : '';

    if (graphId) {
      const existing = await db.graph.findFirst({
        where: {
          id: graphId,
          workspaceId: auth.ctx.workspaceId,
          OR: [
            { visibility: 'workspace' },
            { visibility: 'private', userId: auth.ctx.userId }
          ]
        },
        select: { id: true }
      });
      if (!existing)
        return NextResponse.json({ error: 'Graph not found' }, { status: 404 });

      const graph = await db.$transaction(async (tx) => {
        await assertGraphEditable(tx, graphId);
        const updatedGraph = await tx.graph.update({
          where: { id: graphId },
          data: { caseId },
          select: { id: true, caseId: true, updatedAt: true }
        });
        await tx.caseArtifact.updateMany({
          where: { graphId },
          data: { caseId }
        });
        return updatedGraph;
      });
      return NextResponse.json({ graph });
    }

    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const graph = await db.graph.create({
      data: {
        userId: auth.ctx.userId,
        workspaceId: auth.ctx.workspaceId,
        caseId,
        name,
        description:
          typeof body?.description === 'string'
            ? body.description.trim() || null
            : null,
        visibility: body?.visibility === 'private' ? 'private' : 'workspace',
        nodes: [],
        edges: []
      }
    });

    return NextResponse.json({ graph }, { status: 201 });
  } catch (error) {
    const blocked = graphWriteErrorResponse(error);
    if (blocked) return blocked;
    console.error('POST /api/cases/[caseId]/graphs error:', error);
    return NextResponse.json(
      { error: 'Failed to create or move graph' },
      { status: 500 }
    );
  }
}
