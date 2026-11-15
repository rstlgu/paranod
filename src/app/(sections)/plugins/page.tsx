'use client';
import PageContainer from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { InstallAddonDialog } from '@/features/plugins/components/install-addon-dialog';
import { PluginConfigSheet } from '@/features/plugins/components/plugin-config-sheet';
import { usePlugins } from '@/features/plugins/hooks/use-plugins';
import type { ConfigField } from '@/features/plugins/types';
import {
  SettingsSection,
  SettingsRow,
  settingsStyles as ui
} from '@/features/settings/settings-fields';
import { useRouter } from 'next/navigation';
import { useQueryState, parseAsStringLiteral } from 'nuqs';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CaretDown } from '@phosphor-icons/react';

interface PluginTransform {
  id: string;
  name: string;
  description: string;
  inputType: string;
  outputTypes: string[];
  /** Richiede API key dell'utente (config del plugin). */
  requiresApiKey?: boolean;
}

type PluginCategory =
  | 'network'
  | 'identity'
  | 'media'
  | 'location'
  | 'blockchain'
  | 'ai'
  | 'osint'
  | 'social'
  | 'documents'
  | 'other';

interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  icon?: string;
  logoUrl?: string;
  category?: PluginCategory;
  inputTypes: string[];
  outputTypes: string[];
  transforms: PluginTransform[];
  enabled: boolean;
  requiresConfig?: boolean;
  configSchema?: Record<string, ConfigField>;
  config?: Record<string, unknown>;
  isExternal?: boolean;
}

const ADDON_STORE_URL = process.env.NEXT_PUBLIC_ADDON_STORE_URL;

export default function PluginsPage() {
  const router = useRouter();
  const [activeTab] = useQueryState(
    'tab',
    parseAsStringLiteral(['plugins', 'addons'] as const)
      .withDefault('plugins')
      .withOptions({ shallow: true })
  );
  const [togglingPlugin, setTogglingPlugin] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  // Plugin configuration state
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [configPlugin, setConfigPlugin] = useState<Plugin | null>(null);
  const [tempConfig, setTempConfig] = useState<Record<string, unknown>>({});
  const [showInstallDialog, setShowInstallDialog] = useState(false);

  // Usa SWR per il caching dei plugin - caricamento istantaneo dalla cache
  const {
    builtinPlugins,
    communityPlugins,
    customPlugins,
    addons,
    isWorkspaceAdmin,
    isLoading: loading,
    refresh: refreshPlugins
  } = usePlugins();

  // Filtro condiviso: ricerca testo + categoria
  const matchesFilters = useCallback(
    (p: {
      name: string;
      description?: string | null;
      category?: string;
      inputTypes?: string[];
    }) => {
      const q = searchQuery.toLowerCase();
      const category = (p.category ?? 'other') as string;
      const matchesCategory =
        selectedCategories.length === 0 ||
        selectedCategories.includes(category);
      if (!matchesCategory) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q) ||
        (p.inputTypes ?? []).some((t) => t.toLowerCase().includes(q))
      );
    },
    [searchQuery, selectedCategories]
  );

  // Convert external plugins to Plugin format
  const formattedAddons = useMemo(() => {
    return addons.map(
      (plugin): Plugin => ({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        version: plugin.version,
        author: plugin.author,
        icon: plugin.icon || 'IconPlug',
        logoUrl: plugin.logoUrl,
        category: (plugin.category as PluginCategory) || 'other',
        inputTypes: plugin.inputTypes || [],
        outputTypes: plugin.outputTypes || [],
        transforms: (plugin.transforms || []).map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          inputType: t.inputType,
          outputTypes: t.outputTypes
        })),
        enabled: plugin.enabled,
        requiresConfig: !!plugin.requiresConfig,
        configSchema: plugin.configSchema ?? {},
        config: plugin.config ?? {},
        isExternal: true
      })
    );
  }, [addons]);

  // Convert community plugins to Plugin format
  const formattedCommunityPlugins = useMemo(() => {
    return communityPlugins.map(
      (plugin): Plugin => ({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description || '',
        version: plugin.version,
        author: 'Community',
        icon: plugin.iconUrl,
        category: 'other',
        inputTypes: plugin.inputTypes,
        outputTypes: [],
        transforms: [],
        enabled: plugin.enabled,
        requiresConfig: false,
        configSchema: {},
        config: {}
      })
    );
  }, [communityPlugins]);

  // PLUGIN = inclusi (built-in) + installabili dallo store (community/custom)
  const pluginsList = useMemo<Plugin[]>(
    () => [
      ...(builtinPlugins as unknown as Plugin[]),
      ...formattedCommunityPlugins,
      ...(customPlugins as unknown as Plugin[])
    ],
    [builtinPlugins, formattedCommunityPlugins, customPlugins]
  );

  const filteredPlugins = useMemo(
    () => pluginsList.filter((p) => matchesFilters(p)),
    [pluginsList, matchesFilters]
  );

  // ADDON = installati da URL (manifest, stile Stremio)
  const filteredAddons = useMemo(
    () => formattedAddons.filter((p) => matchesFilters(p)),
    [formattedAddons, matchesFilters]
  );

  function formatCategoryLabel(value: string) {
    const v = String(value || 'other');
    if (v.toLowerCase() === 'ai') return 'AI';
    if (v.toLowerCase() === 'osint') return 'OSINT';
    return v.charAt(0).toUpperCase() + v.slice(1);
  }

  const categoryStats = useMemo(() => {
    const source: Plugin[] =
      activeTab === 'plugins' ? pluginsList : formattedAddons;
    const q = searchQuery.toLowerCase();

    const base = source.filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q) ||
        (p.inputTypes || []).some((t: string) => t.toLowerCase().includes(q))
      );
    });

    const counts = new Map<string, number>();
    for (const p of base) {
      const c = (p.category as string | undefined) ?? 'other';
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }

    const options = Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([value, count]) => ({
        value,
        label: formatCategoryLabel(value),
        count
      }));

    return { total: base.length, options };
  }, [activeTab, pluginsList, formattedAddons, searchQuery]);

  const selectedLabel = useMemo(() => {
    if (selectedCategories.length === 0) return `All (${categoryStats.total})`;
    if (selectedCategories.length === 1) {
      const value = selectedCategories[0] ?? '';
      const item = categoryStats.options.find((o) => o.value === value);
      const count = item?.count ?? 0;
      return `${formatCategoryLabel(value)} (${count})`;
    }
    return `${selectedCategories.length} selected`;
  }, [categoryStats.options, categoryStats.total, selectedCategories]);

  function toggleCategory(value: string) {
    setSelectedCategories((prev) => {
      if (prev.includes(value)) return prev.filter((v) => v !== value);
      return [...prev, value];
    });
  }

  // Plugin/addon con settings configurabili (schema non vuoto)
  const hasConfigSchema = useCallback((plugin: Plugin): boolean => {
    return Object.keys(plugin.configSchema ?? {}).length > 0;
  }, []);

  // Check if plugin needs configuration (required fields mancanti;
  // il sentinel dei secret conta come impostato)
  const needsConfiguration = useCallback((plugin: Plugin): boolean => {
    if (!plugin.configSchema) return false;
    const config = plugin.config || {};
    for (const [key, field] of Object.entries(plugin.configSchema)) {
      if (field.required && !config[key]) {
        return true;
      }
    }
    return false;
  }, []);

  // Open config dialog
  const openConfigDialog = useCallback((plugin: Plugin) => {
    setConfigPlugin(plugin);
    setTempConfig(plugin.config || {});
    setConfigDialogOpen(true);
  }, []);

  // Save plugin config (i secret non toccati viaggiano come sentinel).
  // Solo builtin/store: gli addon non hanno settings in-app (manifest = solo
  // transforms; auth via manifest URL personalizzata, stile Stremio).
  const savePluginConfig = useCallback(async () => {
    if (!configPlugin) return;
    try {
      const response = await fetch(`/api/plugins/${configPlugin.id}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: tempConfig })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save config');
      }

      refreshPlugins();
      setConfigDialogOpen(false);
      toast.success(`Configuration saved for ${configPlugin.name}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to save plugin config'
      );
    }
  }, [configPlugin, tempConfig, refreshPlugins]);

  // Verifica se l'utente può modificare le impostazioni (solo admin)
  const canToggle = isWorkspaceAdmin;

  function canTogglePlugin(plugin: Plugin) {
    const isCustom = (plugin as any).isOwner !== undefined;
    if (isCustom) return true;
    return canToggle;
  }

  // Toggle plugin
  const handleToggle = async (plugin: Plugin, enabled: boolean) => {
    if (!canTogglePlugin(plugin)) {
      toast.error('Only workspace admins can change plugin settings');
      return;
    }

    setTogglingPlugin(plugin.id);
    try {
      const toggleUrl = plugin.isExternal
        ? `/api/addons/${plugin.id}/toggle`
        : `/api/plugins/${plugin.id}/toggle`;
      const response = await fetch(toggleUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to toggle');
      }

      // Force revalidation con SWR
      await refreshPlugins();

      toast.success(enabled ? 'Enabled' : 'Disabled');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to toggle plugin'
      );
    } finally {
      setTogglingPlugin(null);
    }
  };

  // Uninstall external plugin
  const handleUninstall = async (pluginId: string, pluginName: string) => {
    if (!canToggle) {
      toast.error('Only administrators can uninstall plugins');
      return;
    }

    if (
      !confirm(
        `Are you sure you want to uninstall ${pluginName}? This action will remove the plugin and all associated transforms.`
      )
    ) {
      return;
    }

    try {
      const response = await fetch(`/api/addons/${pluginId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Unable to uninstall the addon');
      }

      // Rivalidate i dati con SWR
      refreshPlugins();

      toast.success(`${pluginName} uninstalled successfully`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to uninstall the plugin'
      );
    }
  };

  const openPluginDetail = useCallback(
    (pluginId: string) => {
      router.push(
        `/plugins/${encodeURIComponent(pluginId)}${activeTab === 'addons' ? '?tab=addons' : ''}`,
        { scroll: false }
      );
    },
    [router, activeTab]
  );

  // Raggruppa la lista per categoria (sezioni ordinate alfabeticamente,
  // 'other' sempre in fondo).
  const groupByCategory = useCallback(
    (list: Plugin[]): [string, Plugin[]][] => {
      const map = new Map<string, Plugin[]>();
      for (const p of list) {
        const c = (p.category as string | undefined) ?? 'other';
        const bucket = map.get(c);
        if (bucket) bucket.push(p);
        else map.set(c, [p]);
      }
      return Array.from(map.entries()).sort(([a], [b]) => {
        if (a === 'other') return 1;
        if (b === 'other') return -1;
        return a.localeCompare(b);
      });
    },
    []
  );

  const displayed = activeTab === 'addons' ? filteredAddons : filteredPlugins;
  return (
    <PageContainer>
      <SettingsSection
        title={activeTab === 'addons' ? 'External addons' : 'Installed plugins'}
        description={
          activeTab === 'addons'
            ? 'Connect tools hosted by external providers using their manifest URL.'
            : 'Choose which tools are available in your investigations.'
        }
        action={
          ADDON_STORE_URL && (
            <a
              className={ui.action}
              href={ADDON_STORE_URL}
              target='_blank'
              rel='noopener noreferrer'
            >
              Browse store
            </a>
          )
        }
      >
        {activeTab === 'addons' && (
          <SettingsRow
            label='Install an addon'
            description='Use the HTTPS manifest URL supplied by the provider.'
          >
            <Button
              className={ui.action}
              disabled={!isWorkspaceAdmin}
              onClick={() => setShowInstallDialog(true)}
            >
              Install from URL
            </Button>
          </SettingsRow>
        )}
        {!isWorkspaceAdmin && (
          <p className={ui.notice}>
            Only workspace administrators can change these settings.
          </p>
        )}
        <div className={`${ui.toolbar} pt-5`}>
          <Input
            aria-label='Search extensions'
            placeholder={
              activeTab === 'addons' ? 'Search addons' : 'Search plugins'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className={ui.action}>
                {selectedLabel}
                <CaretDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onSelect={() => setSelectedCategories([])}>
                All categories
              </DropdownMenuItem>
              {categoryStats.options.map((opt) => (
                <DropdownMenuCheckboxItem
                  key={opt.value}
                  checked={selectedCategories.includes(opt.value)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => toggleCategory(opt.value)}
                >
                  {opt.label} ({opt.count})
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </SettingsSection>
      {loading ? (
        <p className={ui.notice} role='status'>
          Loading extensions…
        </p>
      ) : !displayed.length ? (
        <SettingsRow
          label={
            activeTab === 'addons' ? 'No addons found' : 'No plugins found'
          }
          description={
            searchQuery || selectedCategories.length
              ? 'Try another search or category.'
              : 'Installed addons will appear here.'
          }
        />
      ) : (
        groupByCategory(displayed).map(([category, plugins]) => (
          <SettingsSection key={category} title={formatCategoryLabel(category)}>
            {plugins.map((plugin) => (
              <SettingsRow
                key={plugin.id}
                label={
                  <button
                    className={ui.link}
                    onClick={() => openPluginDetail(plugin.id)}
                  >
                    {plugin.name}
                  </button>
                }
                description={
                  <>
                    <span className='line-clamp-2'>{plugin.description}</span>
                    <span className='mt-1 block text-xs'>
                      {plugin.transforms.length}{' '}
                      {plugin.transforms.length === 1 ? 'action' : 'actions'} ·
                      v{plugin.version}
                      {needsConfiguration(plugin)
                        ? ' · Configuration required'
                        : ''}
                    </span>
                  </>
                }
              >
                {hasConfigSchema(plugin) && (
                  <Button
                    className={ui.action}
                    aria-label={`Configure ${plugin.name}`}
                    onClick={() => openConfigDialog(plugin)}
                    disabled={!canToggle}
                  >
                    Configure
                  </Button>
                )}
                {plugin.isExternal && (
                  <Button
                    className={ui.action}
                    onClick={() => handleUninstall(plugin.id, plugin.name)}
                    disabled={!canToggle}
                  >
                    Remove
                  </Button>
                )}
                <Switch
                  aria-label={`Enable ${plugin.name}`}
                  checked={plugin.enabled}
                  disabled={
                    !canTogglePlugin(plugin) || togglingPlugin === plugin.id
                  }
                  onCheckedChange={(enabled) => handleToggle(plugin, enabled)}
                />
              </SettingsRow>
            ))}
          </SettingsSection>
        ))
      )}
      {configPlugin && (
        <PluginConfigSheet
          open={configDialogOpen}
          onOpenChange={setConfigDialogOpen}
          pluginId={configPlugin.id}
          title={`Configure ${configPlugin.name}`}
          configSchema={configPlugin.configSchema ?? {}}
          value={tempConfig}
          onChange={setTempConfig}
          onSave={savePluginConfig}
          saveLabel='Save changes'
        />
      )}
      <InstallAddonDialog
        open={showInstallDialog}
        onOpenChange={setShowInstallDialog}
        onSuccess={() => refreshPlugins()}
      />
    </PageContainer>
  );
}
