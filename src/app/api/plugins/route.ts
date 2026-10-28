/**
 * API Route: List All Plugins
 * GET /api/plugins
 * Returns: built-in, community, custom, and external plugins
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parseStoredAddonManifest } from '@/features/plugins/addon-storage';
import { getAllPlugins } from '@/features/plugins/registry';
import { getActiveWorkspaceAccess } from '@/lib/auth-utils';
import {
  sanitizeConfigForClient,
  safeParseConfig
} from '@/features/plugins/config-service';

export async function GET(request: NextRequest) {
  try {
    const access = await getActiveWorkspaceAccess();
    if (!access) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { userId, workspaceId } = access;
    const isAdmin = access.role === 'admin';

    // Get built-in plugins from registry
    const builtinPlugins = getAllPlugins();

    console.log(`📦 Built-in plugins from registry: ${builtinPlugins.length}`);

    // Get plugin settings for this workspace
    const workspaceSettings = await db.workspacePluginSetting.findMany({
      where: { workspaceId: workspaceId },
      select: {
        pluginId: true,
        enabled: true,
        config: true
      }
    });

    console.log(`⚙️ Org settings found: ${workspaceSettings.length}`);

    const settingsMap = new Map(
      workspaceSettings.map((s) => [
        s.pluginId,
        { enabled: s.enabled, config: s.config }
      ])
    );

    // Get user-level plugin settings (for custom plugins, etc.)
    const userSettings = await db.userPluginSetting.findMany({
      where: { userId },
      select: {
        pluginId: true,
        enabled: true,
        config: true
      }
    });

    const userSettingsMap = new Map(
      userSettings.map((s) => [
        s.pluginId,
        { enabled: s.enabled, config: s.config }
      ])
    );

    // Format built-in plugins.
    // NB: i secret non lasciano mai il server — sanitizeConfigForClient li
    // sostituisce con un sentinel (vedi config-service.ts).
    const builtin = builtinPlugins.map((p) => {
      const settings = settingsMap.get(p.id);
      const schema = p.configSchema ?? {};
      const config = sanitizeConfigForClient(
        safeParseConfig(settings?.config),
        schema
      );

      return {
        id: p.id,
        name: p.name,
        description: p.description,
        version: p.version,
        author: p.author,
        icon: p.icon,
        logoUrl: p.logoUrl,
        category: p.category,
        inputTypes: p.inputTypes,
        outputTypes: p.outputTypes,
        transforms: p.transforms,
        isInstalled: true,
        enabled: settings?.enabled ?? p.enabled ?? true,
        requiresConfig: p.requiresConfig,
        configSchema: schema,
        config
      };
    });

    console.log(`✅ Formatted ${builtin.length} built-in plugins`);
    console.log(`✅ isAdmin: ${isAdmin}`);

    // Get community plugins (empty for now)
    const community: any[] = [];

    const custom = await db.customPlugin.findMany({
      where: {
        OR: [{ userId }, { isPublic: true }]
      },
      select: {
        id: true,
        name: true,
        description: true,
        version: true,
        inputTypes: true,
        isPublic: true,
        isVerified: true,
        installs: true,
        userId: true
      }
    });

    const formattedCustom = custom.map((p) => {
      const inputTypes = JSON.parse(p.inputTypes);
      const isOwner = p.userId === userId;
      const settings = userSettingsMap.get(p.id);

      return {
        id: p.id,
        name: p.name,
        description: p.description || '',
        version: p.version,
        author: isOwner ? 'You' : 'Community',
        icon: 'IconCode',
        logoUrl: undefined,
        category: 'other' as const,
        inputTypes,
        outputTypes: [] as string[],
        transforms: [],
        enabled: settings?.enabled ?? true,
        requiresConfig: false,
        configSchema: {},
        config: {},
        isOwner,
        isPublic: p.isPublic,
        isVerified: p.isVerified,
        installs: p.installs
      };
    });

    // Get addons for this workspace (installed, enabled or disabled)
    const installedAddons = await db.workspaceAddonInstall.findMany({
      where: {
        workspaceId: workspaceId,
        uninstalledAt: null
      },
      select: {
        id: true,
        addonId: true,
        manifestData: true,
        enabled: true,
        installedAt: true,
        config: true
      }
    });

    console.log(`🔌 Addons found: ${installedAddons.length}`);

    // Format addons to match the Plugin interface (plus a few management fields).
    // Deciso 2026-07-08: il manifest addon NON può dichiarare campi config da
    // mostrare in app (vettore phishing) — solo transforms. L'auth degli addon
    // passa dalla manifest URL personalizzata (stile Stremio).
    const formattedAddons = installedAddons.map((ep) => {
      const manifest = parseStoredAddonManifest(ep.manifestData);
      const plugin = manifest.plugin;

      return {
        id: ep.addonId,
        installationId: ep.id,
        name: plugin.name,
        description: plugin.description,
        version: plugin.version,
        author: plugin.author || 'Addon',
        icon: plugin.icon,
        logoUrl: undefined,
        category: plugin.category || 'other',
        inputTypes: plugin.capabilities.inputTypes,
        outputTypes: plugin.capabilities.outputTypes,
        transforms: (plugin.transforms || []).map(
          ({ endpoint: _endpoint, ...transform }: { endpoint?: string }) =>
            transform
        ),
        isInstalled: true,
        enabled: ep.enabled,
        installedAt: ep.installedAt,
        hasConfig: false,
        requiresConfig: false,
        configSchema: {},
        config: {},
        type: 'addon' // Marker per identificare gli addon
      };
    });

    const response = {
      builtin,
      community,
      custom: formattedCustom,
      addons: formattedAddons,
      isAdmin
    };

    console.log(
      `📤 Sending response with ${response.builtin.length} builtin, ${response.addons.length} addons`
    );

    return NextResponse.json(response);
  } catch (error) {
    console.error('❌ List plugins error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
