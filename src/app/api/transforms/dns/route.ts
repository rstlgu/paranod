/**
 * DNS Transform API Route
 * POST /api/transforms/dns
 */

import { NextRequest, NextResponse } from 'next/server';
import { dnsPluginExecutor } from '@/features/plugins/builtin/dns-plugin';
import type {
  TransformInput,
  TransformResponse
} from '@/features/plugins/types';
import { withTransformGate } from '@/features/plugins/route-handler';

export async function POST(request: NextRequest) {
  return withTransformGate('dns-lookup', request, async () => {
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

      // Valida che sia un dominio valido
      const domainRegex =
        /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
      if (!domainRegex.test(input.entity.value)) {
        return NextResponse.json(
          { success: false, error: 'Invalid domain format' },
          { status: 400 }
        );
      }

      // Esegui transform
      const result = await dnsPluginExecutor.execute(transformId, input);

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
