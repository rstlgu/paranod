/**
 * Location Intelligence Transform API
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth-session';
import { locationPluginExecutor } from '@/features/plugins/builtin/location-plugin';
import type {
  TransformInput,
  TransformResponse
} from '@/features/plugins/types';
import { withTransformGate } from '@/features/plugins/route-handler';

export async function POST(request: NextRequest) {
  return withTransformGate('location-intelligence', request, async () => {
    try {
      const { userId } = await auth();
      if (!userId) {
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

      const result = await locationPluginExecutor.execute(transformId, input);

      const response: TransformResponse = {
        success: result.success,
        data: result,
        error: result.error,
        status: 'completed'
      };

      return NextResponse.json(response);
    } catch (error) {
      console.error('Location transform error:', error);
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
