/**
 * Image Analysis Transform API
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActiveWorkspaceAccess } from '@/lib/auth-utils';
import { imagePluginExecutor } from '@/features/plugins/builtin/image-plugin';
import type {
  TransformInput,
  TransformResponse
} from '@/features/plugins/types';
import { withTransformGate } from '@/features/plugins/route-handler';
import { loadWorkspacePluginConfig } from '@/features/plugins/server-config';

export async function POST(request: NextRequest) {
  return withTransformGate('image-analysis', request, async () => {
    try {
      const access = await getActiveWorkspaceAccess();
      if (!access) {
        return NextResponse.json(
          { success: false, error: 'Unauthorized' },
          { status: 401 }
        );
      }

      const body = await request.json();
      const { transformId, input } = body as {
        transformId: string;
        input: TransformInput;
      };

      if (!transformId || !input) {
        return NextResponse.json(
          { success: false, error: 'Missing transformId or input' },
          { status: 400 }
        );
      }

      // Config server (secret decifrati, es. ocrApiKey) con precedenza su
      // quella client, che non contiene mai secret.
      const serverConfig = await loadWorkspacePluginConfig(
        access.workspaceId,
        'image-analysis'
      );
      input.config = { ...input.config, ...serverConfig };

      const result = await imagePluginExecutor.execute(
        transformId,
        input,
        undefined,
        access
      );

      const response: TransformResponse = {
        success: result.success,
        data: result,
        error: result.error,
        status: 'completed'
      };

      return NextResponse.json(response);
    } catch (error) {
      console.error('Image transform error:', error);
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
