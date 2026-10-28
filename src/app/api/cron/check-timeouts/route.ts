/**
 * Cron: Check for timed-out transform jobs
 * GET /api/cron/check-timeouts
 *
 * Marks async jobs stuck in SUBMITTED/PROCESSING past the timeout as TIMEOUT,
 * so the graph UI stops waiting on them. Intended to be called on a schedule
 * (see vercel.json crons). Protected by CRON_SECRET when set.
 */

import { isCronAuthorized } from '@/lib/security/cron-auth';
import { NextRequest, NextResponse } from 'next/server';
import { checkTimeouts } from '@/lib/jobs/timeout-handler';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await checkTimeouts();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('check-timeouts cron error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
