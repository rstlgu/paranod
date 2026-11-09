/**
 * API Routes: Addon Management
 * GET /api/addons/[addonId] - Get addon details
 * PATCH /api/addons/[addonId] - Update addon config/enabled
 * DELETE /api/addons/[addonId] - Uninstall addon
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getActiveWorkspaceAccess } from '@/lib/auth-utils';
import { sanitizeAddonManifestForClient } from '@/features/plugins/addon-public';
import { safeFetch } from '@/lib/security/safe-fetch';
import {
  createAddonRequestHeaders,
  redactAddonUrl
} from '@/lib/security/addon-request';
import { decryptSecret } from '@/lib/security/secrets';
import { parseStoredAddonManifest } from '@/features/plugins/addon-storage';
import { readBoundedBody } from '@/lib/security/bounded-body';

// ============================================
// GET - Addon Details
// ============================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ addonId: string }> }
) {
  try {
    const access = await getActiveWorkspaceAccess();
    if (!access) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { workspaceId } = access;

    const { addonId } = await params;

    const addon = await db.workspaceAddonInstall.findUnique({
      where: {
        workspaceId_addonId: {
          workspaceId: workspaceId,
          addonId
        }
      },
      include: {
        jobs: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            transformId: true,
            status: true,
            createdAt: true,
            completedAt: true,
            error: true
          }
        }
      }
    });

    if (!addon || addon.uninstalledAt) {
      return NextResponse.json({ error: 'Addon not found' }, { status: 404 });
    }

    const manifest = parseStoredAddonManifest(addon.manifestData);

    return NextResponse.json({
      id: addon.id,
      addonId: addon.addonId,
      manifest: sanitizeAddonManifestForClient(manifest),
      enabled: addon.enabled,
      installedAt: addon.installedAt,
      hasConfig: !!addon.config,
      recentJobs: addon.jobs
    });
  } catch (error) {
    console.error('Get addon error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ============================================
// PATCH - Update Addon Configuration
// ============================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ addonId: string }> }
) {
  try {
    const access = await getActiveWorkspaceAccess();
    if (!access) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (access.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only admins can change addon settings' },
        { status: 403 }
      );
    }
    const { workspaceId } = access;

    const { addonId } = await params;
    const body = JSON.parse(await readBoundedBody(request, 64 * 1024));
    const { enabled } = body;

    const updateData: any = {};

    if (enabled !== undefined) {
      if (typeof enabled !== 'boolean') {
        return NextResponse.json(
          { error: 'enabled must be a boolean' },
          { status: 400 }
        );
      }
      updateData.enabled = enabled;
    }
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No supported fields to update' },
        { status: 400 }
      );
    }

    const updated = await db.workspaceAddonInstall.updateMany({
      where: {
        workspaceId,
        addonId,
        uninstalledAt: null
      },
      data: updateData
    });
    if (updated.count !== 1) {
      return NextResponse.json({ error: 'Addon not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      addon: { addonId }
    });
  } catch (error) {
    if (error instanceof RangeError)
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    console.error('Update addon error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ============================================
// DELETE - Uninstall Addon
// ============================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ addonId: string }> }
) {
  try {
    const access = await getActiveWorkspaceAccess();
    if (!access) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (access.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only admins can uninstall addons' },
        { status: 403 }
      );
    }
    const { workspaceId } = access;

    const { addonId } = await params;

    // Get addon details before deletion (for unregister call)
    const addon = await db.workspaceAddonInstall.findUnique({
      where: {
        workspaceId_addonId: {
          workspaceId: workspaceId,
          addonId
        }
      }
    });

    if (!addon || addon.uninstalledAt) {
      return NextResponse.json({ error: 'Addon not found' }, { status: 404 });
    }

    const activeJobCount = await db.transformJob.count({
      where: {
        workspaceId,
        addonId,
        status: { in: ['PENDING', 'SUBMITTED', 'PROCESSING'] }
      }
    });
    if (activeJobCount > 0) {
      return NextResponse.json(
        {
          error: `Addon has ${activeJobCount} active job(s) and cannot be uninstalled`
        },
        { status: 409 }
      );
    }

    // Historical jobs are preserved for audit and troubleshooting.
    const jobCount = await db.transformJob.count({
      where: {
        workspaceId: workspaceId,
        addonId
      }
    });

    // Call unregister endpoint on addon server (best effort)
    try {
      const manifestUrlObj = new URL(decryptSecret(addon.manifestUrl));
      const unregisterEndpoint = new URL('unregister', manifestUrlObj)
        .toString()
        .split('?')[0];

      console.log(
        `📝 Unregistering workspace from addon: ${redactAddonUrl(unregisterEndpoint)}`
      );

      const unregisterBody = JSON.stringify({ workspaceId });
      const unregisterResponse = await safeFetch(unregisterEndpoint, {
        method: 'POST',
        headers: createAddonRequestHeaders(
          unregisterBody,
          workspaceId,
          decryptSecret(addon.webhookSecret)
        ),
        body: unregisterBody,
        timeoutMs: 5_000,
        maxResponseBytes: 128 * 1024
      });

      if (unregisterResponse.ok) {
        console.log(`✅ Workspace unregistered from addon`);
      } else {
        console.warn(
          `⚠️  Addon unregister returned ${unregisterResponse.status}`
        );
      }
    } catch (error) {
      // Non-blocking: continue with deletion even if unregister fails
      console.warn(
        '⚠️  Failed to unregister from addon; continuing with local removal.'
      );
    }

    await db.workspaceAddonInstall.update({
      where: {
        workspaceId_addonId: {
          workspaceId: workspaceId,
          addonId
        }
      },
      data: {
        enabled: false,
        uninstalledAt: new Date()
      }
    });

    console.log(`✅ Addon uninstalled: ${addonId}`);
    console.log(`   Preserved ${jobCount} associated jobs`);

    return NextResponse.json({
      success: true,
      message: `Addon uninstalled. ${jobCount} historical jobs preserved.`
    });
  } catch (error) {
    console.error('Uninstall addon failed.');

    if ((error as any).code === 'P2025') {
      return NextResponse.json({ error: 'Addon not found' }, { status: 404 });
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
