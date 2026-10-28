import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { HMACVerifier } from '@/lib/security/hmac';
import { decryptSecret } from '@/lib/security/secrets';
import { ExternalTransformResultSchema } from '@/features/plugins/addon-payload';
import { readBoundedBody } from '@/lib/security/bounded-body';
import { parseAddonResult } from '@/lib/validators/addon-result';

const MAX_WEBHOOK_BYTES = 5 * 1024 * 1024;
const MAX_WEBHOOK_AGE_MS = 5 * 60_000;
const ACTIVE_JOB_STATUSES = ['PENDING', 'SUBMITTED', 'PROCESSING'];

const WebhookSchema = z
  .object({
    eventId: z.string().uuid(),
    jobId: z.string().min(1),
    status: z.enum(['processing', 'completed', 'failed']),
    progress: z.number().int().min(0).max(100).optional(),
    progressMessage: z.string().max(1000).optional(),
    result: ExternalTransformResultSchema.optional(),
    error: z.string().max(4000).optional(),
    timestamp: z.string().datetime()
  })
  .strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_WEBHOOK_BYTES) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }

    const { jobId } = await params;
    const job = await db.transformJob.findUnique({
      where: { id: jobId },
      include: {
        addon: {
          select: {
            webhookSecret: true,
            addonId: true
          }
        }
      }
    });
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const rawBody = await readBoundedBody(request, MAX_WEBHOOK_BYTES);
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_WEBHOOK_BYTES) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }

    const signature = HMACVerifier.extractSignature(
      request.headers.get('X-Plugin-Signature')
    );
    if (
      !signature ||
      !HMACVerifier.verifySignature(
        rawBody,
        signature,
        decryptSecret(job.addon.webhookSecret)
      )
    ) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON payload' },
        { status: 400 }
      );
    }
    const parsed = WebhookSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid webhook payload' },
        { status: 400 }
      );
    }
    const body = parsed.data;
    if (body.jobId !== jobId) {
      return NextResponse.json({ error: 'Job ID mismatch' }, { status: 400 });
    }
    if (
      Math.abs(Date.now() - new Date(body.timestamp).getTime()) >
      MAX_WEBHOOK_AGE_MS
    ) {
      return NextResponse.json(
        { error: 'Expired webhook event' },
        { status: 401 }
      );
    }
    if (body.status === 'completed' && !body.result) {
      return NextResponse.json(
        { error: 'Result required for completed status' },
        { status: 400 }
      );
    }

    if (body.result) {
      try {
        parseAddonResult(body.result, JSON.parse(job.inputEntity).id);
      } catch {
        return NextResponse.json(
          { error: 'Invalid addon result' },
          { status: 400 }
        );
      }
    }

    const duplicate = await db.transformWebhookEvent.findUnique({
      where: { eventId: body.eventId },
      select: { jobId: true }
    });
    if (duplicate) {
      if (duplicate.jobId !== jobId) {
        return NextResponse.json(
          { error: 'Webhook event ID already used' },
          { status: 409 }
        );
      }
      return NextResponse.json({ success: true, duplicate: true });
    }

    const targetStatus = body.status.toUpperCase();
    const updateData: Record<string, unknown> = {
      status: targetStatus
    };
    if (body.progress !== undefined) updateData.progress = body.progress;
    if (body.progressMessage !== undefined) {
      updateData.progressMessage = body.progressMessage;
    }
    if (body.status === 'completed') {
      updateData.result = JSON.stringify(body.result);
      updateData.completedAt = new Date();
      updateData.progress = 100;
    }
    if (body.status === 'failed') {
      updateData.error = body.error || 'Unknown error from addon';
      updateData.completedAt = new Date();
    }

    try {
      await db.$transaction(async (tx) => {
        await tx.transformWebhookEvent.create({
          data: {
            eventId: body.eventId,
            jobId,
            status: targetStatus
          }
        });
        const updated = await tx.transformJob.updateMany({
          where: {
            id: jobId,
            status: { in: ACTIVE_JOB_STATUSES }
          },
          data: updateData
        });
        if (updated.count !== 1) {
          throw new Error('INVALID_JOB_TRANSITION');
        }
      });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        const existing = await db.transformWebhookEvent.findUnique({
          where: { eventId: body.eventId },
          select: { jobId: true }
        });
        if (existing?.jobId !== jobId) {
          return NextResponse.json(
            { error: 'Webhook event ID already used' },
            { status: 409 }
          );
        }
        return NextResponse.json({ success: true, duplicate: true });
      }
      if (
        error instanceof Error &&
        error.message === 'INVALID_JOB_TRANSITION'
      ) {
        return NextResponse.json(
          { error: `Job is already in terminal state ${job.status}` },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RangeError)
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    console.error('Webhook handler error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
