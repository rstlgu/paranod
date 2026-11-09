import { auth } from '@/lib/auth-session';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconKey
} from '@tabler/icons-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { getEntityConfig } from '@/features/graph/config/entity-config';
import { parseStoredAddonManifest } from '@/features/plugins/addon-storage';
import { PluginManageActions } from '@/features/plugins/components/plugin-manage-actions';
import { PluginIcon } from '@/features/plugins/components/plugin-icon';
import { sanitizeConfigForClient } from '@/features/plugins/config-service';
import { getPlugin } from '@/features/plugins/registry';
import { getBuiltInPluginStyle } from '@/features/plugins/utils/plugin-style';
import { db } from '@/lib/db';
import { cn } from '@/lib/utils';

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

import { PageAnimation } from '@/components/layout/page-animation';

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
  const { logoUrl, headerBg, headerText } = getBuiltInPluginStyle(
    plugin.inputTypes,
    plugin.icon,
    plugin.logoUrl
  );

  return (
    <PageContainer containerClassName='max-w-5xl'>
      <PageAnimation className='w-full space-y-8 pb-10'>
        {/* Navigation */}
        <div className='flex items-center justify-between'>
          <Button
            asChild
            variant='ghost'
            size='sm'
            className='text-muted-foreground hover:text-foreground shrink-0 pl-0'
          >
            <Link href='/plugins'>
              <IconArrowLeft className='mr-2 h-4 w-4' />
              Back to Plugins
            </Link>
          </Button>
        </div>

        {/* Hero Header */}
        <div className='flex flex-col gap-6 md:flex-row md:items-start md:justify-between'>
          <div className='flex items-start gap-5'>
            <div
              className={cn(
                'flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[24px] border shadow-lg transition-transform hover:scale-105',
                headerBg
              )}
            >
              <PluginIcon
                inputTypes={plugin.inputTypes}
                icon={plugin.icon}
                logoUrl={logoUrl}
                size={48}
                iconClassName={cn('h-10 w-10', headerText)}
              />
            </div>
            <div className='space-y-2'>
              <div>
                <div className='flex items-center gap-3'>
                  <h1 className='text-3xl font-bold tracking-tight'>
                    {plugin.name}
                  </h1>
                  {needsSetup ? (
                    <Badge
                      variant='outline'
                      className='border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/30 dark:bg-amber-900/10 dark:text-amber-400'
                    >
                      Setup Required
                    </Badge>
                  ) : null}
                </div>
                <p className='text-muted-foreground text-base'>
                  v{plugin.version} • by{' '}
                  <span className='text-foreground font-medium'>
                    {plugin.author}
                  </span>
                </p>
              </div>
              <div className='flex flex-wrap gap-2'>
                <Badge
                  variant={isEnabled ? 'default' : 'secondary'}
                  className={cn(
                    'rounded-full px-3',
                    isEnabled
                      ? 'bg-emerald-500 hover:bg-emerald-600'
                      : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                  )}
                >
                  {isEnabled ? 'Enabled' : 'Disabled'}
                </Badge>
                <Badge
                  variant='outline'
                  className='rounded-full border-zinc-200 bg-zinc-50 px-3 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400'
                >
                  {plugin.category}
                </Badge>
              </div>
            </div>
          </div>

          {!isCustomPlugin && !isExternalPlugin && (
            <div className='flex h-full shrink-0 flex-col items-end justify-center gap-3'>
              <PluginManageActions
                pluginId={plugin.id}
                pluginName={plugin.name}
                initialEnabled={isEnabled}
                canEdit={canEdit}
                requiresConfig={hasConfig}
                configSchema={plugin.configSchema}
                initialConfig={initialConfig}
              />
            </div>
          )}
          {isCustomPlugin && (
            <div className='flex h-full shrink-0 flex-col items-end justify-center gap-3'>
              <Badge variant='outline' className='text-xs'>
                Custom Plugin
              </Badge>
            </div>
          )}
          {isExternalPlugin && (
            <div className='flex h-full shrink-0 flex-col items-end justify-center gap-3'>
              <PluginManageActions
                pluginId={plugin.id}
                pluginName={plugin.name}
                initialEnabled={isEnabled}
                canEdit={canEdit}
                requiresConfig={hasConfig}
                configSchema={plugin.configSchema}
                initialConfig={initialConfig}
                isExternal={true}
              />
            </div>
          )}
        </div>

        <Separator className='bg-zinc-200 dark:bg-zinc-800' />

        <div className='grid gap-8 lg:grid-cols-[2fr_1fr]'>
          <div className='space-y-8'>
            {/* Description */}
            <section className='space-y-4'>
              <h3 className='text-lg font-semibold tracking-tight'>About</h3>
              <p className='text-muted-foreground text-sm leading-relaxed'>
                {plugin.description}
              </p>
            </section>

            {/* Transforms List */}
            <section className='space-y-4'>
              <div className='flex items-center justify-between'>
                <h3 className='text-lg font-semibold tracking-tight'>
                  Available Actions
                </h3>
                <Badge variant='secondary' className='rounded-full'>
                  {plugin.transforms.length}
                </Badge>
              </div>
              <div className='space-y-1 rounded-xl border border-zinc-100 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50'>
                {plugin.transforms.map((transform, index) => {
                  const inputConfig = getEntityConfig(transform.inputType);
                  const isLast = index === plugin.transforms.length - 1;
                  return (
                    <div
                      key={transform.id}
                      className='flex items-start gap-2 py-1.5'
                    >
                      {/* Tree line */}
                      <div className='flex flex-col items-center pt-1'>
                        <div
                          className={cn(
                            'flex h-4 w-4 items-center justify-center',
                            isLast
                              ? 'text-muted-foreground'
                              : 'text-muted-foreground'
                          )}
                        >
                          {isLast ? '└' : '├'}
                        </div>
                      </div>
                      {/* Transform content */}
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center gap-2'>
                          <span className='text-sm font-medium'>
                            {transform.name}
                          </span>

                          {(transform as { requiresApiKey?: boolean })
                            .requiresApiKey &&
                            hasConfig && (
                              <Badge
                                variant='outline'
                                className='gap-1 border-zinc-200 bg-zinc-50 px-1.5 text-[10px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400'
                              >
                                <IconKey className='h-3 w-3' />
                                API key
                              </Badge>
                            )}
                          <span className='text-muted-foreground text-xs'>
                            —
                          </span>
                          <span className='text-muted-foreground truncate text-xs'>
                            {transform.description}
                          </span>
                        </div>
                        <div className='mt-1 flex items-center gap-1.5'>
                          <Badge
                            variant='secondary'
                            className={cn(
                              'gap-1 text-xs',
                              inputConfig.headerBg,
                              inputConfig.headerText
                            )}
                          >
                            <inputConfig.icon className='h-3 w-3' />
                            {transform.inputType}
                          </Badge>
                          <IconArrowRight className='text-muted-foreground h-3 w-3' />
                          {transform.outputTypes.map((out) => {
                            const outConfig = getEntityConfig(out);
                            return (
                              <Badge
                                key={out}
                                variant='secondary'
                                className={cn(
                                  'gap-1 text-xs',
                                  outConfig.headerBg,
                                  outConfig.headerText
                                )}
                              >
                                <outConfig.icon className='h-3 w-3' />
                                {out}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          <div className='space-y-6'>
            {/* Information Card */}
            <Card className='overflow-hidden rounded-3xl border-zinc-200/50 bg-zinc-50/50 shadow-none dark:border-zinc-800/50 dark:bg-zinc-900/50'>
              <CardContent className='space-y-4 p-5 pt-4'>
                <h4 className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                  Information
                </h4>
                <div className='space-y-4'>
                  <div className='flex items-center justify-between text-sm'>
                    <span className='text-muted-foreground'>Version</span>
                    <span className='font-medium'>{plugin.version}</span>
                  </div>
                  <div className='flex items-center justify-between text-sm'>
                    <span className='text-muted-foreground'>Category</span>
                    <span className='font-medium text-blue-600 dark:text-blue-400'>
                      {plugin.category}
                    </span>
                  </div>
                  <div className='flex items-center justify-between text-sm'>
                    <span className='text-muted-foreground'>Source code</span>
                    <span className='font-medium text-blue-600 dark:text-blue-400'>
                      Public
                    </span>
                  </div>
                  <div className='flex items-center justify-between text-sm'>
                    <span className='text-muted-foreground'>Developed by</span>
                    <div className='flex items-center gap-2'>
                      <span className='font-medium text-blue-600 dark:text-blue-400'>
                        {plugin.author}
                      </span>
                      <Badge
                        variant='secondary'
                        className='rounded-full px-2 text-xs font-normal'
                      >
                        1 app
                      </Badge>
                    </div>
                  </div>
                  <div className='flex items-center justify-between text-sm'>
                    <span className='text-muted-foreground'>Submitted by</span>
                    <div className='flex items-center gap-2'>
                      <span className='font-medium text-blue-600 dark:text-blue-400'>
                        OSINT Team
                      </span>
                      <Badge
                        variant='secondary'
                        className='rounded-full px-2 text-xs font-normal'
                      >
                        47 apps
                      </Badge>
                    </div>
                  </div>
                  <div className='flex items-center justify-between text-sm'>
                    <span className='text-muted-foreground'>
                      Compatible with
                    </span>
                    <span className='font-medium'>PARANOD 1.0+</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Configuration Status */}
            <Card className='overflow-hidden rounded-3xl border-zinc-200/50 bg-zinc-50/50 shadow-none dark:border-zinc-800/50 dark:bg-zinc-900/50'>
              <CardContent className='space-y-4 p-5 pt-4'>
                <h4 className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                  Configuration
                </h4>
                {needsSetup ? (
                  <div className='flex items-start gap-3 rounded-xl bg-amber-50 p-3 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200'>
                    <IconAlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
                    <div className='space-y-1'>
                      <p className='text-sm font-medium'>Setup Required</p>
                      <p className='text-xs opacity-90'>
                        Configuration is needed before using this plugin.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className='flex items-start gap-3 rounded-xl bg-emerald-50 p-3 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200'>
                    <IconCheck className='mt-0.5 h-4 w-4 shrink-0' />
                    <div className='space-y-1'>
                      <p className='text-sm font-medium'>Ready to Use</p>
                      <p className='text-xs opacity-90'>
                        No configuration needed. Enable and start using.
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </PageAnimation>
    </PageContainer>
  );
}
