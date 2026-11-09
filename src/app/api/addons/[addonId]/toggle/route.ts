/**
 * Toggle addon enabled/disabled (workspace-scoped, admin only)
 * POST /api/addons/[addonId]/toggle
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getActiveWorkspaceAccess } from '@/lib/auth-utils';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ addonId: string }> }
) {
  try {
    const access = await getActiveWorkspaceAccess();
    const { addonId } = await params;

    if (!access) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { workspaceId } = access;

    const body = await request.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled must be a boolean' },
        { status: 400 }
      );
    }

    if (access.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only admins can change addon settings' },
        { status: 403 }
      );
    }

    const existing = await db.workspaceAddonInstall.findUnique({
      where: { workspaceId_addonId: { workspaceId: workspaceId, addonId } },
      select: { id: true, uninstalledAt: true }
    });

    if (!existing || existing.uninstalledAt) {
      return NextResponse.json({ error: 'Addon not found' }, { status: 404 });
    }

    const addon = await db.workspaceAddonInstall.update({
      where: { workspaceId_addonId: { workspaceId: workspaceId, addonId } },
      data: { enabled }
    });

    return NextResponse.json({
      addon: { id: addon.id, enabled: addon.enabled }
    });
  } catch (error) {
    console.error('Toggle addon error:', error);
    return NextResponse.json(
      { error: 'Failed to toggle addon' },
      { status: 500 }
    );
  }
}
