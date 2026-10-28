/**
 * breach.vip Transform API Route
 * POST /api/transforms/breach-vip
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth-session';
import { db } from '@/lib/db';
import { breachVipPluginExecutor } from '@/features/plugins/builtin/breach-vip-plugin';
import type {
  TransformInput,
  TransformResponse
} from '@/features/plugins/types';
import { withTransformGate } from '@/features/plugins/route-handler';
import { loadWorkspacePluginConfig } from '@/features/plugins/server-config';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  return withTransformGate('breach-vip', request, async () => {
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

      // Config workspace (OSS: proxyUrl per aggirare il blocco IP di Cloudflare).
      const { userId } = await auth();
      if (userId) {
        const pref = await db.userPreference.findUnique({
          where: { userId },
          select: { activeWorkspaceId: true }
        });
        const serverConfig = await loadWorkspacePluginConfig(
          pref?.activeWorkspaceId,
          'breach-vip'
        );
        input.config = { ...input.config, ...serverConfig };
      }

      const result = await breachVipPluginExecutor.execute(transformId, input);

      const response: TransformResponse = {
        success: result.success,
        data: result,
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
