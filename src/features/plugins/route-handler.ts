/** Server-only authorization and bounded response handling for builtin transforms. */
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { getActiveWorkspaceAccess } from '@/lib/auth-utils';
import type { TransformProgress, TransformResponse } from './types';
import { readBoundedBody } from '@/lib/security/bounded-body';
import { manualTransformGraphError } from '@/features/graph/server/manual-transform-guard';

/** Validate the caller, graph and plugin before dispatching any transform. */
export async function gateTransformRoute(
  pluginId: string,
  request: NextRequest
): Promise<NextResponse | null> {
  const access = await getActiveWorkspaceAccess();
  if (!access) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized or no active workspace' },
      { status: 401 }
    );
  }
  let rawBody: string;
  try {
    rawBody = await readBoundedBody(request.clone());
  } catch {
    return NextResponse.json(
      { success: false, error: 'Payload too large' },
      { status: 413 }
    );
  }
  let body: { graphId?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON payload' },
      { status: 400 }
    );
  }
  const graphError = await manualTransformGraphError(body?.graphId, access);
  if (graphError) return graphError;
  const setting = await db.workspacePluginSetting.findUnique({
    where: {
      workspaceId_pluginId: { workspaceId: access.workspaceId, pluginId }
    },
    select: { enabled: true }
  });
  if (setting?.enabled === false) {
    return NextResponse.json(
      { success: false, error: 'Plugin is disabled' },
      { status: 403 }
    );
  }
  return null;
}

export async function withTransformGate(
  pluginId: string,
  request: NextRequest,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const denied = await gateTransformRoute(pluginId, request);
  if (denied) return denied;
  return handler();
}

/** Stream progress as NDJSON, followed by exactly one terminal result. */
export async function withStreamingTransformGate(
  pluginId: string,
  request: NextRequest,
  run: (
    onProgress: (update: TransformProgress) => void
  ) => Promise<TransformResponse>
): Promise<Response> {
  const denied = await gateTransformRoute(pluginId, request);
  if (denied) return denied;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Closing a browser tab must not cause an unhandled stream exception.
      const send = (line: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        } catch {}
      };
      let response: TransformResponse;
      try {
        response = await run((update) => send({ type: 'progress', ...update }));
      } catch (error) {
        response = {
          success: false,
          error:
            error instanceof Error ? error.message : 'Internal server error',
          status: 'failed'
        };
      }
      send({ type: 'result', response });
      try {
        controller.close();
      } catch {}
    }
  });
  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no'
    }
  });
}
