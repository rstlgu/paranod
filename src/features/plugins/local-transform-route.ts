import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireActiveWorkspaceMember } from '@/app/api/cases/_utils';
import { db } from '@/lib/db';
import { findTransform, matchesInputType } from './registry';
import type { EntityType, PluginExecutor } from './types';

const MAX_REQUEST_BYTES = 256 * 1024;
const requestSchema = z.object({
  transformId: z.string().min(1).max(100),
  input: z.object({
    entity: z.object({
      id: z.string().min(1).max(200),
      type: z.enum(['note', 'hash']),
      value: z.string().max(128 * 1024),
      metadata: z
        .object({
          content: z
            .string()
            .max(128 * 1024)
            .optional()
        })
        .optional()
    })
  })
});

async function readBoundedJson(request: NextRequest): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) {
    throw new RangeError('Request exceeds the 256 KiB limit');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Missing request body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new RangeError('Request exceeds the 256 KiB limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Authenticated, bounded route for free transforms that perform no network IO. */
export function createLocalTransformRoute(
  pluginId: string,
  executor: PluginExecutor
) {
  return async function POST(request: NextRequest) {
    const context = await requireActiveWorkspaceMember();
    if (!context.ok) {
      return NextResponse.json(
        { success: false, error: context.error },
        { status: context.status }
      );
    }
    try {
      const setting = await db.workspacePluginSetting.findUnique({
        where: {
          workspaceId_pluginId: {
            workspaceId: context.ctx.workspaceId,
            pluginId
          }
        },
        select: { enabled: true }
      });
      if (setting?.enabled === false) {
        return NextResponse.json(
          { success: false, error: 'Plugin is disabled' },
          { status: 403 }
        );
      }
      const parsed = requestSchema.safeParse(await readBoundedJson(request));
      if (!parsed.success) {
        return NextResponse.json(
          { success: false, error: 'Invalid transform input' },
          { status: 400 }
        );
      }
      const { transformId, input } = parsed.data;
      const found = findTransform(pluginId, transformId);
      if (
        !found ||
        !found.plugin.enabled ||
        !matchesInputType(
          input.entity.type as EntityType,
          found.transform.inputType
        )
      ) {
        return NextResponse.json(
          {
            success: false,
            error: 'Unknown transform or unsupported entity type'
          },
          { status: 400 }
        );
      }
      const result = await executor.execute(transformId, input);
      return NextResponse.json(
        {
          success: result.success,
          data: result,
          status: result.success ? 'completed' : 'failed'
        },
        { status: result.success ? 200 : 400 }
      );
    } catch (error) {
      if (error instanceof RangeError || error instanceof SyntaxError) {
        return NextResponse.json(
          {
            success: false,
            error:
              error instanceof RangeError ? error.message : 'Invalid JSON body'
          },
          { status: error instanceof RangeError ? 413 : 400 }
        );
      }
      return NextResponse.json(
        { success: false, error: 'Transform execution failed' },
        { status: 500 }
      );
    }
  };
}
