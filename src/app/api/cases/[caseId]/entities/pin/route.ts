import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireActiveWorkspaceMember,
  requireCaseInWorkspace
} from '@/app/api/cases/_utils';
import { normalizeEntity } from '@/app/api/cases/_normalize';
import { extractFactualEvents } from '@/app/api/cases/_events';

type RouteContext = {
  params: Promise<{ caseId: string }>;
};

function parseConfidence(value: unknown): 'low' | 'medium' | 'confirmed' {
  return value === 'low' || value === 'confirmed' ? value : 'medium';
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
    if (!foundCase) return NextResponse.json({ error: 'Case not found' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const type = typeof body?.type === 'string' ? body.type.trim() : '';
    const value = typeof body?.value === 'string' ? body.value.trim() : '';

    if (!type || !value) {
      return NextResponse.json({ error: 'Missing type/value' }, { status: 400 });
    }

    const label = typeof body?.label === 'string' ? body.label.trim() : undefined;
    const confidence = parseConfidence(body?.confidence);
    const metadata =
      body?.metadata && typeof body.metadata === 'object'
        ? (body.metadata as Record<string, unknown>)
        : {};

    const targetIds = Array.isArray(body?.targetIds)
      ? body.targetIds.filter((x: unknown) => typeof x === 'string')
      : [];

    const { normalizedValue, warnings } = normalizeEntity({ type, value });
    if (!normalizedValue) {
      return NextResponse.json({ error: 'Invalid value' }, { status: 400 });
    }

    const now = new Date();

    // Upsert entity
    const existing = await db.caseEntity.findUnique({
      where: {
        caseId_type_normalizedValue: {
          caseId,
          type,
          normalizedValue
        }
      },
      select: { id: true, seenCount: true }
    });

    const entity = existing
      ? await db.caseEntity.update({
          where: { id: existing.id },
          data: {
            lastSeenAt: now,
            seenCount: { increment: 1 },
            ...(label ? { label } : {}),
            ...(confidence ? { confidence } : {})
          },
          select: {
            id: true,
            type: true,
            value: true,
            normalizedValue: true,
            label: true,
            confidence: true,
            seenCount: true,
            firstSeenAt: true,
            lastSeenAt: true
          }
        })
      : await db.caseEntity.create({
          data: {
            caseId,
            type,
            value,
            normalizedValue,
            label: label || null,
            confidence,
            metadata: JSON.stringify(metadata),
            createdByUserId: auth.ctx.userId,
            firstSeenAt: now,
            lastSeenAt: now,
            seenCount: 1
          },
          select: {
            id: true,
            type: true,
            value: true,
            normalizedValue: true,
            label: true,
            confidence: true,
            seenCount: true,
            firstSeenAt: true,
            lastSeenAt: true
          }
        });

    const isNew = !existing;

    // Snapshot source
    const sourceKind =
      typeof body?.source?.kind === 'string' ? body.source.kind : 'manual';
    const graphId =
      typeof body?.source?.graphId === 'string' ? body.source.graphId : null;
    const graphNodeId =
      typeof body?.source?.graphNodeId === 'string' ? body.source.graphNodeId : null;

    const source = await db.caseEntitySource.create({
      data: {
        caseEntityId: entity.id,
        kind: sourceKind,
        graphId,
        graphNodeId,
        pluginId: typeof body?.source?.pluginId === 'string' ? body.source.pluginId : null,
        transformId:
          typeof body?.source?.transformId === 'string' ? body.source.transformId : null,
        externalRef:
          typeof body?.source?.externalRef === 'string' ? body.source.externalRef : null,
        data: JSON.stringify({
          metadata,
          warnings,
          pinnedAt: now.toISOString()
        }),
        createdAt: now
      },
      select: { id: true }
    });

    // Auto-attach to sole target if none provided
    const effectiveTargetIds = targetIds.length
      ? targetIds
      : (
          await db.caseTarget.findMany({
            where: { caseId },
            select: { id: true }
          })
        ).length === 1
        ? (
            await db.caseTarget.findFirst({
              where: { caseId },
              select: { id: true }
            })
          )?.id
          ? [
              (
                await db.caseTarget.findFirst({
                  where: { caseId },
                  select: { id: true }
                })
              )!.id
            ]
          : []
        : [];

    if (effectiveTargetIds.length) {
      await db.caseTargetEntityLink.createMany({
        data: effectiveTargetIds.map((targetId: string) => ({
          targetId,
          caseEntityId: entity.id,
          createdByUserId: auth.ctx.userId
        })),
        skipDuplicates: true
      });
    }

    // Audit event
    await db.caseEvent.create({
      data: {
        caseId,
        kind: 'audit',
        type: isNew ? 'entity_added' : 'entity_seen_again',
        actorUserId: auth.ctx.userId,
        confidence: isNew ? 'medium' : 'medium',
        createdAt: now,
        data: JSON.stringify({
          caseEntityId: entity.id,
          sourceId: source.id,
          targetIds: effectiveTargetIds
        })
      }
    });

    // Factual events extracted from metadata
    const factual = extractFactualEvents({ entityType: type, metadata });
    if (factual.length) {
      await db.caseEvent.createMany({
        data: factual.map((e) => ({
          caseId,
          kind: 'factual',
          type: e.type,
          actorUserId: null,
          occurredAt: e.occurredAt,
          confidence: e.confidence,
          createdAt: now,
          message: e.message ?? null,
          data: JSON.stringify({
            caseEntityId: entity.id,
            sourceId: source.id,
            ...e.data
          })
        }))
      });
    }

    return NextResponse.json({
      entity: {
        ...entity,
        metadata,
        warnings
      },
      isNew
    });
  } catch (error) {
    console.error('POST /api/cases/[caseId]/entities/pin error:', error);
    return NextResponse.json({ error: 'Failed to pin entity' }, { status: 500 });
  }
}
