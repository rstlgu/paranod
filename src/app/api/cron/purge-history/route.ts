import { isCronAuthorized } from '@/lib/security/cron-auth';
import { NextRequest, NextResponse } from 'next/server';
import { purgeAllExpiredFlowRuns } from '@/lib/history-retention';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await purgeAllExpiredFlowRuns();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('purge-history cron error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
