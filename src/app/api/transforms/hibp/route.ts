/**
 * HIBP Transform API Route
 * POST /api/transforms/hibp
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth-session';
import { db } from '@/lib/db';
import { hibpPluginExecutor } from '@/features/plugins/builtin/hibp-plugin';
import type {
  TransformInput,
  TransformResponse
} from '@/features/plugins/types';
import { withTransformGate } from '@/features/plugins/route-handler';
import { loadWorkspacePluginConfig } from '@/features/plugins/server-config';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  return withTransformGate('hibp', request, async () => {
    try {
      const body = await request.json();
      const { transformId, input } = body as {
        transformId: string;
        input: TransformInput;
      };

      if (!transformId) {
        return NextResponse.json(
          { success: false, error: 'transformId is required' },
          { status: 400 }
        );
      }
      if (!input?.entity?.value) {
        return NextResponse.json(
          { success: false, error: 'input.entity.value is required' },
          { status: 400 }
        );
      }

      // Config workspace: API key supplied by the workspace administrator.
      const { userId } = await auth();
      if (userId) {
        const pref = await db.userPreference.findUnique({
          where: { userId },
          select: { activeWorkspaceId: true }
        });
        const serverConfig = await loadWorkspacePluginConfig(
          pref?.activeWorkspaceId,
          'hibp'
        );
        input.config = { ...input.config, ...serverConfig };
      }

      const result = await hibpPluginExecutor.execute(transformId, input);

      const response: TransformResponse = {
        success: result.success,
        data: result,
        error: result.error,
        status: 'completed'
      };
      return NextResponse.json(response);
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
