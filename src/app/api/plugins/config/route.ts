/**
 * Plugin Configuration API
 * Restituisce le configurazioni di tutti i plugin per l'workspace attiva
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getActiveWorkspaceAccess } from '@/lib/auth-utils';
import {
  stripSecrets,
  getBuiltinConfigSchema
} from '@/features/plugins/config-service';

function safeParseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function GET(request: NextRequest) {
  try {
    const access = await getActiveWorkspaceAccess();
    if (!access) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const activeWorkspaceId = access.workspaceId;

    // Carica tutte le configurazioni dei plugin per questa workspace
    const pluginSettings = await db.workspacePluginSetting.findMany({
      where: {
        workspaceId: activeWorkspaceId,
        enabled: true
      },
      select: {
        pluginId: true,
        config: true
      }
    });

    // Costruisci l'oggetto di configurazione.
    // SOLO campi non-secret: questo endpoint alimenta il client (input.config
    // dei transform); i secret vengono iniettati server-side dalle route di
    // esecuzione (vedi config-service.resolveConfigForExecution).
    const configs: Record<string, Record<string, unknown>> = {};
    for (const setting of pluginSettings) {
      if (setting.config) {
        configs[setting.pluginId] = stripSecrets(
          safeParseJsonObject(setting.config),
          getBuiltinConfigSchema(setting.pluginId)
        );
      }
    }

    return NextResponse.json({
      success: true,
      data: configs
    });
  } catch (error) {
    console.error('Error fetching plugin configurations:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    );
  }
}
