/**
 * Active Jobs API
 * GET /api/jobs/active
 *
 * Returns all active jobs for the workspace
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth-session';
import { getActiveJobs } from '@/lib/jobs/timeout-handler';
import { getActiveWorkspaceId } from '@/lib/auth-utils';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    const workspaceId = await getActiveWorkspaceId();

    if (!userId || !workspaceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const jobs = await getActiveJobs(workspaceId, userId);

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('Get active jobs error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
