/**
 * Job Status API
 * GET /api/jobs/[jobId]
 *
 * Returns current status of a transform job
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth-session';
import { db } from '@/lib/db';
import { getActiveWorkspaceId } from '@/lib/auth-utils';
import { coerceEntityType } from '@/features/osint/entity-types';
import { parseStoredAddonManifest } from '@/features/plugins/addon-storage';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { userId } = await auth();
    const workspaceId = await getActiveWorkspaceId();

    if (!userId || !workspaceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { jobId } = await params;

    // Get job with plugin info
    const job = await db.transformJob.findFirst({
      where: {
        id: jobId,
        graph: { workspaceId, OR: [{ userId }, { visibility: 'workspace' }] },
        workspaceId: workspaceId
      },
      include: {
        addon: {
          select: {
            addonId: true,
            manifestData: true
          }
        }
      }
    });

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const manifest = parseStoredAddonManifest(job.addon.manifestData);
    const inputEntity = JSON.parse(job.inputEntity);

    // Parse result if available and convert to internal format
    let result = null;
    if (job.result) {
      try {
        const externalResult = JSON.parse(job.result);
        const inputEntity = JSON.parse(job.inputEntity);

        // Validate and convert entities
        const entities = (externalResult.entities || []).map(
          (e: any, index: number) => {
            // Validate required fields
            if (!e.id) {
              console.error(`Entity at index ${index} missing id:`, e);
              throw new Error(
                `Entity at index ${index} is missing required field: id`
              );
            }
            if (!e.type) {
              throw new Error(`Entity ${e.id} is missing required field: type`);
            }
            if (!e.value) {
              throw new Error(
                `Entity ${e.id} is missing required field: value`
              );
            }

            const { type, originalType } = coerceEntityType(e.type);

            return {
              id: e.id,
              type,
              value: e.value,
              label: e.label || e.value,
              metadata: originalType
                ? { ...(e.metadata || {}), originalType }
                : e.metadata || {},
              source: job.addonId,
              timestamp: new Date().toISOString()
            };
          }
        );

        // Create set of valid entity IDs
        const entityIds = new Set(entities.map((e: any) => e.id));
        entityIds.add(inputEntity.id);

        // Validate and convert edges
        const edges = (externalResult.edges || []).map(
          (e: any, index: number) => {
            // Validate required fields
            if (!e.id) {
              throw new Error(
                `Edge at index ${index} is missing required field: id`
              );
            }
            if (!e.sourceId) {
              throw new Error(
                `Edge ${e.id} is missing required field: sourceId`
              );
            }
            if (!e.targetId) {
              throw new Error(
                `Edge ${e.id} is missing required field: targetId`
              );
            }
            if (!e.label) {
              throw new Error(`Edge ${e.id} is missing required field: label`);
            }

            // Validate entity references
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
          }
        );

        result = {
          ...externalResult,
          entities,
          edges
        };
      } catch (error) {
        console.error('Failed to parse/validate job result:', error);
        result = {
          error:
            error instanceof Error ? error.message : 'Failed to parse result'
        };
      }
    }

    // Calculate duration
    const duration = job.completedAt
      ? job.completedAt.getTime() - job.startedAt.getTime()
      : Date.now() - job.startedAt.getTime();

    return NextResponse.json({
      id: job.id,
      status: job.status,

      // Addon info
      addonId: job.addonId,
      addonName: manifest.plugin.name,
      transformId: job.transformId,

      // Input
      inputEntity,

      // Progress
      progress: job.progress,
      progressMessage: job.progressMessage,

      // Result/Error
      result,
      error: job.error,

      // Timestamps
      startedAt: job.startedAt,
      submittedAt: job.submittedAt,
      completedAt: job.completedAt,

      // Metadata
      externalJobId: job.externalJobId,
      duration: Math.round(duration / 1000), // seconds

      // Computed fields
      isActive: ['PENDING', 'SUBMITTED', 'PROCESSING'].includes(job.status),
      isCompleted: job.status === 'COMPLETED',
      isFailed: ['FAILED', 'TIMEOUT', 'CANCELLED'].includes(job.status)
    });
  } catch (error) {
    console.error('Get job error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
