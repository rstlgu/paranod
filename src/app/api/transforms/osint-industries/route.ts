/**
 * OSINT Industries Transform API
 * POST /api/transforms/osint-industries
 *
 * Answers with NDJSON progress lines and a final result line when the client
 * accepts `application/x-ndjson`, and with plain JSON otherwise.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth-session';
import { db } from '@/lib/db';
import { osintIndustriesPluginExecutor } from '@/features/plugins/builtin/osint-industries-plugin';
import type {
  TransformInput,
  TransformProgress,
  TransformResponse
} from '@/features/plugins/types';
import {
  withStreamingTransformGate,
  withTransformGate
} from '@/features/plugins/route-handler';
import { loadWorkspacePluginConfig } from '@/features/plugins/server-config';

export const runtime = 'nodejs';
export const maxDuration = 80;

async function runTransform(
  request: NextRequest,
  onProgress?: (update: TransformProgress) => void
): Promise<{ status: number; response: TransformResponse }> {
  const body = await request.json();
  const { transformId, input } = body as {
    transformId: string;
    input: TransformInput;
  };

  if (!transformId) {
    return {
      status: 400,
      response: { success: false, error: 'transformId is required' }
    };
  }
  if (!input?.entity?.value) {
    return {
      status: 400,
      response: { success: false, error: 'input.entity.value is required' }
    };
  }

  const { userId } = await auth();
  if (userId) {
    const pref = await db.userPreference.findUnique({
      where: { userId },
      select: { activeWorkspaceId: true }
    });
    const serverConfig = await loadWorkspacePluginConfig(
      pref?.activeWorkspaceId,
      'osint-industries'
    );
    input.config = { ...input.config, ...serverConfig };
  }

  const result = await osintIndustriesPluginExecutor.execute(
    transformId,
    input,
    onProgress
  );
  return {
    status: 200,
    response: {
      success: result.success,
      data: result,
      error: result.error,
      status: 'completed'
    }
  };
}

export async function POST(request: NextRequest) {
  if (request.headers.get('accept')?.includes('application/x-ndjson')) {
    return withStreamingTransformGate(
      'osint-industries',
      request,
      async (onProgress) => (await runTransform(request, onProgress)).response
    );
  }

  return withTransformGate('osint-industries', request, async () => {
    try {
      const { status, response } = await runTransform(request);
      return NextResponse.json(response, { status });
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error:
            error instanceof Error ? error.message : 'Internal server error'
        },
        { status: 500 }
      );
    }
  });
}
