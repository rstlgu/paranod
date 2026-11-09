/**
 * Subdomain Transform API Route
 * POST /api/transforms/subdomain
 */

import { NextRequest, NextResponse } from 'next/server';
import { subdomainPluginExecutor } from '@/features/plugins/builtin/subdomain-plugin';
import type {
  TransformInput,
  TransformResponse
} from '@/features/plugins/types';
import { withTransformGate } from '@/features/plugins/route-handler';

export async function POST(request: NextRequest) {
  return withTransformGate('subdomain-finder', request, async () => {
    try {
      const body = await request.json();
      const { transformId, input } = body as {
        transformId: string;
        input: TransformInput;
      };

      // Validazione input
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

      // Esegui transform
      const result = await subdomainPluginExecutor.execute(transformId, input);

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
