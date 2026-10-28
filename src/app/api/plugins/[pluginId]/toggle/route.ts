/**
 * Toggle plugin enabled/disabled
 * POST /api/plugins/[pluginId]/toggle
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth-session';
import { db } from '@/lib/db';
import { getPlugin } from '@/features/plugins/registry';

type RouteContext = {
  params: Promise<{ pluginId: string }>;
};

// Helper per ottenere l'workspace attiva
async function getActiveWorkspace(userId: string) {
  const prefs = await db.userPreference.findUnique({
    where: { userId },
    select: { activeWorkspaceId: true }
  });
  return prefs?.activeWorkspaceId || null;
}

// Verifica se l'utente è admin dell'workspace
async function isWorkspaceAdmin(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const membership = await db.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId, workspaceId: workspaceId }
    }
  });
  return membership?.role === 'admin';
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await auth();
    const { pluginId } = await context.params;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled must be a boolean' },
        { status: 400 }
      );
    }

    // Custom plugins are user-scoped: allow toggling without workspace-admin privileges
    const customPlugin = await db.customPlugin.findUnique({
      where: { id: pluginId },
      select: { id: true, userId: true, isPublic: true }
    });

    if (customPlugin) {
      // allow owner or public plugin (user enabling/disabling locally)
      if (customPlugin.userId !== userId && !customPlugin.isPublic) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      const setting = await db.userPluginSetting.upsert({
        where: {
          userId_pluginId: { userId, pluginId }
        },
        update: { enabled },
        create: {
          userId,
          pluginId,
          enabled
        }
      });

      return NextResponse.json({ setting, scope: 'user' });
    }

    const activeWorkspaceId = await getActiveWorkspace(userId);

    if (!activeWorkspaceId) {
      return NextResponse.json(
        { error: 'No active workspace' },
        { status: 400 }
      );
    }

    // Verifica che l'utente sia admin dell'workspace
    if (!(await isWorkspaceAdmin(userId, activeWorkspaceId))) {
      return NextResponse.json(
        { error: 'Only admins can change plugin settings' },
        { status: 403 }
      );
    }

    // NB: gli addon (install-from-URL) si abilitano via /api/addons/[addonId]/toggle.
    // Qui gestiamo solo i plugin built-in (impostazioni workspace).
    if (!getPlugin(pluginId)) {
      return NextResponse.json({ error: 'Plugin not found' }, { status: 404 });
    }

    // Aggiorna le impostazioni dell'workspace
    const setting = await db.workspacePluginSetting.upsert({
      where: {
        workspaceId_pluginId: { workspaceId: activeWorkspaceId, pluginId }
      },
      update: { enabled },
      create: {
        workspaceId: activeWorkspaceId,
        pluginId,
        enabled
      }
    });

    return NextResponse.json({ setting });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to toggle plugin' },
      { status: 500 }
    );
  }
}
