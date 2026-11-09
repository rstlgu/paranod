import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/security/cron-auth';
import { pollAddonJobs } from '@/lib/jobs/poll-addons';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(
      { success: true, ...(await pollAddonJobs()) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json(
      { error: 'Addon polling temporarily unavailable' },
      { status: 503 }
    );
  }
}
