import { NextRequest, NextResponse } from 'next/server';
import { blockchainPluginExecutor } from '@/features/plugins/builtin/blockchain-plugin';
import type {
  TransformRequest,
  TransformResponse
} from '@/features/plugins/types';
import { withTransformGate } from '@/features/plugins/route-handler';

export async function POST(request: NextRequest) {
  return withTransformGate('blockchain', request, async () => {
    try {
      const body: TransformRequest = await request.json();
      const { transformId, input } = body;

      if (!transformId || !input) {
        return NextResponse.json(
          { success: false, error: 'Missing transformId or input' },
          { status: 400 }
        );
      }

      const result = await blockchainPluginExecutor.execute(transformId, input);

      const response: TransformResponse = {
        success: result.success,
        data: result,
        status: 'completed',
        error: result.error
      };

      return NextResponse.json(response);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Internal server error';
      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: 500 }
      );
    }
  });
}
