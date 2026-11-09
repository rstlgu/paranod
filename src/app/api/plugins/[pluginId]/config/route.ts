/**
 * Salva la configurazione di un plugin per l'workspace attiva
 * POST /api/plugins/[pluginId]/config
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getActiveWorkspaceAccess } from '@/lib/auth-utils';
import { getPlugin } from '@/features/plugins/registry';
import {
  getBuiltinConfigSchema,
  prepareConfigForStorage,
  sanitizeConfigForClient,
  safeParseConfig
} from '@/features/plugins/config-service';

type RouteContext = {
  params: Promise<{ pluginId: string }>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value) return false;
  if (typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  return true;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const access = await getActiveWorkspaceAccess();
    const { pluginId } = await context.params;

    if (!access) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (access.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only admins can change plugin settings' },
        { status: 403 }
      );
    }
    if (!getPlugin(pluginId)) {
      return NextResponse.json({ error: 'Plugin not found' }, { status: 404 });
    }
    const activeWorkspaceId = access.workspaceId;

    const body = (await request.json()) as unknown;
    const config = isPlainObject(body) ? body.config : undefined;

    if (!isPlainObject(config)) {
      return NextResponse.json(
        { error: 'config must be an object' },
        { status: 400 }
      );
    }

    // Valida contro lo schema del plugin, cifra i secret, gestisce il
    // sentinel "non cambiato" (vedi config-service.ts).
    const schema = getBuiltinConfigSchema(pluginId);
    const existingSetting = await db.workspacePluginSetting.findUnique({
      where: {
        workspaceId_pluginId: { workspaceId: activeWorkspaceId, pluginId }
      },
      select: { config: true }
    });
    const { config: prepared, errors } = prepareConfigForStorage({
      incoming: config,
      existing: safeParseConfig(existingSetting?.config),
      schema
    });

    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join(' ') }, { status: 400 });
    }

    const setting = await db.workspacePluginSetting.upsert({
      where: {
        workspaceId_pluginId: { workspaceId: activeWorkspaceId, pluginId }
      },
      update: { config: JSON.stringify(prepared) },
      create: {
        workspaceId: activeWorkspaceId,
        pluginId,
        enabled: true,
        config: JSON.stringify(prepared)
      }
    });

    return NextResponse.json({
      setting: {
        enabled: setting.enabled,
        // Mai rimandare i secret al client
        config: sanitizeConfigForClient(safeParseConfig(setting.config), schema)
      }
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to save plugin config' },
      { status: 500 }
    );
  }
}
