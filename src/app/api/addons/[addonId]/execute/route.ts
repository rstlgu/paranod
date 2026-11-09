/**
 * API Route: Execute Addon Transform
 * POST /api/addons/[addonId]/execute
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActiveWorkspaceAccess } from '@/lib/auth-utils';
import { AddonExecutor } from '@/features/plugins/addon-executor';
import { AddonExecutionRequestSchema } from '@/features/plugins/addon-payload';
import { coerceEntityType } from '@/features/osint/entity-types';
import { db } from '@/lib/db';
import { readBoundedBody } from '@/lib/security/bounded-body';
import { manualTransformGraphError } from '@/features/graph/server/manual-transform-guard';

const MAX_EXECUTION_REQUEST_BYTES = 256 * 1024;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ addonId: string }> }
) {
  try {
    const access = await getActiveWorkspaceAccess();
    if (!access) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { workspaceId } = access;

    const { addonId } = await params;
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_EXECUTION_REQUEST_BYTES) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }

    const rawBody = await readBoundedBody(request, MAX_EXECUTION_REQUEST_BYTES);
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_EXECUTION_REQUEST_BYTES) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON payload' },
        { status: 400 }
      );
    }
    const parsed = AddonExecutionRequestSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid addon execution request' },
        { status: 400 }
      );
    }
    const { transformId, input, graphId } = parsed.data;
    const graphError = await manualTransformGraphError(graphId, access);
    if (graphError) return graphError;

    const graph = await db.graph.findFirst({
      where: {
        id: graphId,
        workspaceId,
        OR: [{ userId: access.userId }, { visibility: 'workspace' }]
      },
      select: { id: true }
    });
    if (!graph) {
      return NextResponse.json(
        { error: 'Graph not found in active workspace' },
        { status: 404 }
      );
    }

    console.log(`🚀 Executing addon transform: ${addonId}/${transformId}`);

    // Convert TransformInput to OSINTEntity format
    const normalizedInputType = coerceEntityType(input.entity.type);
    const entity = {
      id: input.entity.id,
      type: normalizedInputType.type,
      value: input.entity.value,
      label: input.entity.value,
      metadata: normalizedInputType.originalType
        ? {
            ...(input.entity.metadata || {}),
            originalType: normalizedInputType.originalType
          }
        : input.entity.metadata || {},
      timestamp: new Date().toISOString()
    };

    // Execute the transform using the addon executor
    const result = await AddonExecutor.executeTransform(
      workspaceId,
      addonId,
      transformId,
      entity,
      graphId,
      input.config,
      access.userId
    );

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          entities: [],
          edges: [],
          error: result.error
        },
        { status: result.async ? 202 : 400 }
      );
    }

    // If async, return job ID
    if (result.async && result.jobId) {
      return NextResponse.json(
        {
          success: true,
          data: {
            success: true,
            async: true,
            jobId: result.jobId,
            entities: [],
            edges: [],
            message: 'Transform started, check job status'
          },
          status: 'processing'
        },
        { status: 202 }
      );
    }

    // Sync result - validate and convert to internal format
    const externalEntities = result.result?.entities || [];
    const externalEdges = result.result?.edges || [];

    // Validate and convert entities
    const entities = externalEntities.map((e: any, index: number) => {
      // Validate required fields
      if (!e.id) {
        throw new Error(
          `Entity at index ${index} is missing required field: id`
        );
      }
      if (!e.type) {
        throw new Error(`Entity ${e.id} is missing required field: type`);
      }
      if (!e.value) {
        throw new Error(`Entity ${e.id} is missing required field: value`);
      }

      // Normalize unknown types to 'custom' so the graph can always render them
      const { type, originalType } = coerceEntityType(e.type);

      return {
        id: e.id,
        type,
        value: e.value,
        label: e.label || e.value,
        metadata: originalType
          ? { ...(e.metadata || {}), originalType }
          : e.metadata || {},
        source: addonId,
        timestamp: new Date().toISOString()
      };
    });

    // Create set of valid entity IDs for edge validation
    const entityIds = new Set(entities.map((e: any) => e.id));
    entityIds.add(entity.id); // Include input entity ID

    // Validate and convert edges
    const edges = externalEdges.map((e: any, index: number) => {
      // Validate required fields
      if (!e.id) {
        throw new Error(`Edge at index ${index} is missing required field: id`);
      }
      if (!e.sourceId) {
        throw new Error(`Edge ${e.id} is missing required field: sourceId`);
      }
      if (!e.targetId) {
        throw new Error(`Edge ${e.id} is missing required field: targetId`);
      }
      if (!e.label) {
        throw new Error(`Edge ${e.id} is missing required field: label`);
      }

      // Validate that referenced entities exist
      if (!entityIds.has(e.sourceId)) {
        console.warn(
          `⚠️ Edge ${e.id} references non-existent sourceId: ${e.sourceId}`
        );
      }
      if (!entityIds.has(e.targetId)) {
        throw new Error(
          `Edge ${e.id} references non-existent targetId: ${e.targetId}`
        );
      }

      return {
        id: e.id,
        sourceId: e.sourceId,
        targetId: e.targetId,
        label: e.label,
        relationship: e.relationship || e.label,
        metadata: e.metadata || {}
      };
    });

    console.log(
      `✅ Validated and converted: ${entities.length} entities, ${edges.length} edges`
    );

    return NextResponse.json({
      success: true,
      data: {
        success: true,
        entities,
        edges,
        message: result.result?.message
      },
      status: 'completed'
    });
  } catch (error) {
    if (error instanceof RangeError)
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    console.error('Execute addon error:', error);
    return NextResponse.json(
      {
        success: false,
        entities: [],
        edges: [],
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    );
  }
}
