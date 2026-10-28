import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireActiveWorkspaceMember,
  requireCaseInWorkspace
} from '@/app/api/cases/_utils';
import {
  getLogoUrlForDomain,
  getNodeTypeUiLabel,
  nodeTypeByType,
  type NodeType
} from '@/features/osint/node-registry';

type RouteContext = { params: Promise<{ caseId: string }> };

const MAX_GRAPHS = 40;
const MAX_ENTITIES_PER_GRAPH = 250;
const MAX_TOTAL_ENTITIES = 2000;
const DEFAULT_ACCENT = '#94a3b8';
const GRAPH_ACCENT = '#6366f1';

type GraphNode = {
  id?: unknown;
  data?: {
    label?: unknown;
    value?: unknown;
    type?: unknown;
    metadata?: unknown;
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim());
}

function getEntityAccent(
  type: string,
  metadata: Record<string, unknown> | null
) {
  if (isHexColor(metadata?.customColor)) return metadata.customColor.trim();
  return nodeTypeByType[type as NodeType]?.colorHex ?? DEFAULT_ACCENT;
}

function getEntityFavicon(type: string, label: string) {
  if (!['domain', 'subdomain', 'hostname', 'url'].includes(type)) return null;

  let domain = '';
  try {
    domain = new URL(label.includes('://') ? label : `https://${label}`)
      .hostname;
  } catch {
    domain = label.replace(/^https?:\/\//i, '').split('/')[0] ?? '';
  }

  return domain ? (getLogoUrlForDomain({ domain, size: 32 }) ?? null) : null;
}

function getMetadataSearchText(metadata: Record<string, unknown> | null) {
  if (!metadata) return '';
  return Object.entries(metadata)
    .flatMap(([key, value]) => {
      if (typeof value === 'string' || typeof value === 'number') {
        return [key, String(value)];
      }
      if (Array.isArray(value)) {
        return [
          key,
          ...value
            .filter(
              (item) => typeof item === 'string' || typeof item === 'number'
            )
            .slice(0, 8)
            .map(String)
        ];
      }
      return [];
    })
    .slice(0, 40)
    .join(' ');
}

export async function GET(_request: NextRequest, context: RouteContext) {
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

  const graphResults = await db.graph.findMany({
    where: {
      caseId,
      OR: [
        { visibility: 'workspace' },
        { visibility: 'private', userId: auth.ctx.userId }
      ]
    },
    orderBy: { updatedAt: 'desc' },
    take: MAX_GRAPHS + 1,
    select: { id: true, name: true, nodes: true }
  });
  const graphs = graphResults.slice(0, MAX_GRAPHS);
  let remainingEntities = MAX_TOTAL_ENTITIES;
  let entitiesTruncated = false;

  const references = graphs.flatMap((graph) => {
    const graphReference = {
      id: `graph:${graph.id}`,
      label: graph.name,
      kind: 'graph' as const,
      graphId: graph.id,
      graphName: graph.name,
      subtitle: 'Graph',
      entityType: null,
      category: 'Graphs',
      accentColor: GRAPH_ACCENT,
      faviconUrl: null,
      iconUrl: '/api/public/entity-icons/graph',
      searchText: `${graph.name} graph`
    };

    const nodes = Array.isArray(graph.nodes)
      ? (graph.nodes as GraphNode[])
      : [];
    const graphEntityLimit = Math.min(
      MAX_ENTITIES_PER_GRAPH,
      remainingEntities
    );
    const limitedNodes = nodes.slice(0, graphEntityLimit);
    if (nodes.length > limitedNodes.length) entitiesTruncated = true;
    remainingEntities -= limitedNodes.length;

    const entityReferences = limitedNodes.flatMap((node) => {
      const nodeId = typeof node.id === 'string' ? node.id : '';
      const labelSource = node.data?.label ?? node.data?.value;
      const rawValue =
        typeof node.data?.value === 'string' ? node.data.value.trim() : '';
      const label =
        typeof labelSource === 'string' && labelSource.trim()
          ? labelSource.trim()
          : nodeId;
      if (!nodeId || !label) return [];

      const entityType =
        typeof node.data?.type === 'string' ? node.data.type : 'Entity';
      const metadata = asRecord(node.data?.metadata);
      const definition = nodeTypeByType[entityType as NodeType];
      const typeLabel = definition
        ? getNodeTypeUiLabel(entityType as NodeType)
        : entityType;
      const metadataSearchText = getMetadataSearchText(metadata);
      return [
        {
          id: `entity:${graph.id}:${encodeURIComponent(nodeId)}`,
          label,
          kind: 'entity' as const,
          graphId: graph.id,
          graphName: graph.name,
          subtitle: `${typeLabel} · ${graph.name}`,
          entityType,
          category: definition?.category ?? 'Other',
          accentColor: getEntityAccent(entityType, metadata),
          faviconUrl: getEntityFavicon(entityType, rawValue || label),
          iconUrl: definition
            ? `/api/public/entity-icons/${encodeURIComponent(entityType)}`
            : null,
          searchText:
            `${label} ${rawValue} ${entityType} ${typeLabel} ${graph.name} ${metadataSearchText}`.trim()
        }
      ];
    });

    return [graphReference, ...entityReferences];
  });

  return NextResponse.json(
    {
      references,
      limits: {
        graphs: MAX_GRAPHS,
        entitiesPerGraph: MAX_ENTITIES_PER_GRAPH,
        totalEntities: MAX_TOTAL_ENTITIES
      },
      truncated: graphResults.length > MAX_GRAPHS || entitiesTruncated
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
