/**
 * Disposable Email Transform API Route
 * POST /api/transforms/disposable-email
 */

import { NextRequest, NextResponse } from 'next/server';
import { disposableEmailPluginExecutor } from '@/features/plugins/builtin/disposable-email-plugin';
import type {
  TransformInput,
  TransformResponse
} from '@/features/plugins/types';
import { withTransformGate } from '@/features/plugins/route-handler';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  return withTransformGate('disposable-email', request, async () => {
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

      const result = await disposableEmailPluginExecutor.execute(
        transformId,
        input
      );
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
