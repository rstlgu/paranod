import {
  SettingsSection,
  SettingsRow
} from '@/features/settings/settings-fields';
import { auth } from '@/lib/auth-session';
import { IconArrowLeft } from '@tabler/icons-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import PageContainer from '@/components/layout/page-container';
import { parseStoredAddonManifest } from '@/features/plugins/addon-storage';
import { PluginTransforms } from '@/features/plugins/components/plugin-transforms';
import { PluginManageActions } from '@/features/plugins/components/plugin-manage-actions';
import { sanitizeConfigForClient } from '@/features/plugins/config-service';
import { getPlugin } from '@/features/plugins/registry';
import { db } from '@/lib/db';

import { coerceEntityType } from '@/features/osint/entity-types';
import type { PluginDefinition } from '@/features/plugins/types';

type PageProps = {
  params: Promise<{ pluginId: string }>;
};

async function getActiveWorkspaceId(userId: string) {
  const prefs = await db.userPreference.findUnique({
    where: { userId },
    select: { activeWorkspaceId: true }
  });
  return prefs?.activeWorkspaceId ?? null;
}

async function getIsWorkspaceAdmin(userId: string, workspaceId: string) {
  const membership = await db.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId, workspaceId }
    },
    select: { role: true }
  });
  return membership?.role === 'admin';
}

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

export default async function Page(props: PageProps) {
  const { pluginId } = await props.params;
  const { userId } = await auth();

  if (!userId) notFound();

  // Try to get plugin from builtin registry first
  let plugin = getPlugin(pluginId);
  let isCustomPlugin = false;
  let isExternalPlugin = false;

  // If not found in builtin, check custom plugins
  if (!plugin) {
    const customPlugin = await db.customPlugin.findFirst({
      where: {
        id: pluginId,
        OR: [{ userId }, { isPublic: true }]
      }
    });

    if (customPlugin) {
      isCustomPlugin = true;
      const inputTypes = JSON.parse(customPlugin.inputTypes);

      // Convert CustomPlugin to Plugin format
      plugin = {
        id: customPlugin.id,
        name: customPlugin.name,
        description: customPlugin.description || '',
        version: customPlugin.version,
        author: customPlugin.userId === userId ? 'You' : 'Community',
        icon: 'IconCode',
        logoUrl: undefined,
        category: 'other' as const,
        inputTypes,
        outputTypes: [],
        transforms: [],
        enabled: true,
        requiresConfig: false,
        configSchema: undefined,
        estimatedTime: 'instant' as const,
        type: 'custom' as const,
        runtime: 'nextjs' as const
      };
    }
  }

  // If not found in builtin or custom, check installed addons
  if (!plugin) {
    const activeWorkspaceId = await getActiveWorkspaceId(userId);
    if (activeWorkspaceId) {
      const installedAddon = await db.workspaceAddonInstall.findFirst({
        where: {
          workspaceId: activeWorkspaceId,
          addonId: pluginId,
          uninstalledAt: null
        }
      });

      if (installedAddon) {
        isExternalPlugin = true;
        const manifest = parseStoredAddonManifest(installedAddon.manifestData);
        const pluginData = manifest.plugin;

        // Convert addon to Plugin format
        plugin = {
          id: installedAddon.addonId,
          name: pluginData.name,
          description: pluginData.description || '',
          version: pluginData.version,
          author: pluginData.author || 'Addon',
          icon: pluginData.icon,
          logoUrl: undefined,
          category: (pluginData.category ||
            'other') as PluginDefinition['category'],
          inputTypes: pluginData.capabilities.inputTypes,
          outputTypes: pluginData.capabilities.outputTypes.map(
            (type) => coerceEntityType(type).type
          ),
          transforms: pluginData.transforms.map((transform) => ({
            id: transform.id,
            name: transform.name,
            description: transform.description,
            inputType: transform.inputType,
            outputTypes: transform.outputTypes.map(
              (type) => coerceEntityType(type).type
            )
          })),
          enabled: installedAddon.enabled,
          // Addon: manifest = solo transforms, nessun campo config in-app
          requiresConfig: false,
          configSchema: undefined,
          estimatedTime: 'seconds' as const,
          type: 'addon' as const,
          runtime: 'external' as const
        };
      }
    }
  }

  // If still not found, return 404
  if (!plugin) notFound();

  const activeWorkspaceId = await getActiveWorkspaceId(userId);
  const [workspaceSetting, canEdit] = await Promise.all([
    activeWorkspaceId && !isCustomPlugin && !isExternalPlugin
      ? db.workspacePluginSetting.findUnique({
          where: {
            workspaceId_pluginId: { workspaceId: activeWorkspaceId, pluginId }
          },
          select: { enabled: true, config: true }
        })
      : Promise.resolve(null),
    activeWorkspaceId
      ? getIsWorkspaceAdmin(userId, activeWorkspaceId)
      : Promise.resolve(false)
  ]);

  const pluginEnabled = plugin.enabled ?? true;
  const isEnabled =
    isExternalPlugin || isCustomPlugin
      ? pluginEnabled
      : (workspaceSetting?.enabled ?? true);
  // Sanitize configuration before it reaches the client; secrets stay on the server.
  const effectiveSchema = plugin.configSchema ?? {};
  plugin = { ...plugin, configSchema: effectiveSchema };
  const initialConfig = sanitizeConfigForClient(
    workspaceSetting?.config
      ? safeParseJsonObject(workspaceSetting.config)
      : {},
    effectiveSchema
  );

  // Configuration is required while mandatory fields are still empty.
  const hasConfig = Object.keys(effectiveSchema).length > 0;
  const needsSetup = Object.entries(effectiveSchema).some(
    ([key, field]) => field.required && !initialConfig[key]
  );
  return (
    <PageContainer>
      <Link
        className='text-muted-foreground mb-7 inline-flex items-center gap-2 text-sm'
        href={isExternalPlugin ? '/plugins?tab=addons' : '/plugins'}
      >
        <IconArrowLeft className='size-4' />
        {isExternalPlugin ? 'Back to Addons' : 'Back to Plugins'}
      </Link>
      <SettingsSection title={plugin.name} description={plugin.description}>
        <SettingsRow
          label='Availability'
          description={
            needsSetup
              ? 'Complete the configuration before using this tool.'
              : 'Enable this tool for the workspace.'
          }
        >
          {!isCustomPlugin ? (
            <PluginManageActions
              pluginId={plugin.id}
              pluginName={plugin.name}
              initialEnabled={isEnabled}
              canEdit={canEdit}
              requiresConfig={hasConfig}
              configSchema={plugin.configSchema}
              initialConfig={initialConfig}
              isExternal={isExternalPlugin}
            />
          ) : (
            <span>Custom plugin</span>
          )}
        </SettingsRow>
        <SettingsRow label='Version'>
          <span>{plugin.version}</span>
        </SettingsRow>
        <SettingsRow label='Developer'>
          <span>{plugin.author}</span>
        </SettingsRow>
        <SettingsRow label='Category'>
          <span className='capitalize'>{plugin.category}</span>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title='Transforms'>
        <PluginTransforms transforms={plugin.transforms} />
      </SettingsSection>
    </PageContainer>
  );
}
