'use client';

import PageContainer from '@/components/layout/page-container';
import {
  Accordion,
  AccordionContent,
  AccordionItem
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Heading } from '@/components/ui/heading';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getEntityConfig } from '@/features/graph/config/entity-config';
import { InstallAddonDialog } from '@/features/plugins/components/install-addon-dialog';
import { PluginConfigSheet } from '@/features/plugins/components/plugin-config-sheet';
import { PluginIcon } from '@/features/plugins/components/plugin-icon';
import { usePlugins } from '@/features/plugins/hooks/use-plugins';
import type { ConfigField } from '@/features/plugins/types';
import { getBuiltInPluginStyle } from '@/features/plugins/utils/plugin-style';
import { cn } from '@/lib/utils';
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCheck,
  IconDotsVertical,
  IconFileText,
  IconInfoCircle,
  IconKey,
  IconLayoutGrid,
  IconList,
  IconLock,
  IconMapPin,
  IconPackage,
  IconPhoto,
  IconPlug,
  IconPuzzle,
  IconSearch,
  IconServer,
  IconSettings,
  IconSparkles,
  IconTrash,
  IconUsers,
  IconWallet,
  IconX
} from '@tabler/icons-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

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

type ViewMode = 'grid' | 'table';

const STORAGE_KEY_VIEW = 'plugins-view-mode';
const ADDON_STORE_URL = process.env.NEXT_PUBLIC_ADDON_STORE_URL;

export default function PluginsPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<'plugins' | 'addons'>('plugins');
  const [togglingPlugin, setTogglingPlugin] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  // Plugin configuration state
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [configPlugin, setConfigPlugin] = useState<Plugin | null>(null);
  const [tempConfig, setTempConfig] = useState<Record<string, unknown>>({});
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
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

  console.log('🖥️ PluginsPage render:', {
    builtinPlugins: builtinPlugins.length,
    communityPlugins: communityPlugins.length,
    customPlugins: customPlugins.length,
    addons: addons.length,
    isWorkspaceAdmin,
    loading
  });

  // Avoid hydration mismatch with Radix UI
  useEffect(() => {
    setMounted(true);
  }, []);

  // Carica preferenza vista da localStorage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY_VIEW);
    if (saved === 'grid' || saved === 'table') {
      setViewMode(saved);
    }
  }, []);

  // Salva preferenza vista
  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(STORAGE_KEY_VIEW, mode);
  };

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

  function getCategoryIcon(value: string) {
    const v = value.toLowerCase();
    if (v === 'network') return IconServer;
    if (v === 'identity') return IconUsers;
    if (v === 'media') return IconPhoto;
    if (v === 'location') return IconMapPin;
    if (v === 'blockchain') return IconWallet;
    if (v === 'ai') return IconSparkles;
    if (v === 'osint') return IconInfoCircle;
    if (v === 'social') return IconUsers;
    if (v === 'documents') return IconFileText;
    return IconPlug;
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
      router.push(`/plugins/${pluginId}`);
    },
    [router]
  );

  function toggleExpandedPlugin(pluginId: string) {
    setExpandedItems((prev) =>
      prev.includes(pluginId)
        ? prev.filter((id) => id !== pluginId)
        : [...prev, pluginId]
    );
  }

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

  // Vista raggruppata per categoria (grid o list) con header di sezione.
  const GroupedCollection = ({ list }: { list: Plugin[] }) => {
    const groups = groupByCategory(list);
    return (
      <div className='space-y-8'>
        {groups.map(([category, items]) => {
          const Icon = getCategoryIcon(category);
          return (
            <section key={category} className='space-y-3'>
              <div className='flex items-center gap-2.5'>
                <div className='flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800'>
                  <Icon className='text-muted-foreground h-4 w-4' />
                </div>
                <h3 className='text-sm font-semibold tracking-tight'>
                  {formatCategoryLabel(category)}
                </h3>
                <Badge variant='secondary' className='rounded-full text-xs'>
                  {items.length}
                </Badge>
                <div className='ml-1 h-px flex-1 bg-zinc-200/70 dark:bg-zinc-800/70' />
              </div>
              {viewMode === 'grid' ? (
                <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
                  {items.map((plugin) => (
                    <PluginCard key={plugin.id} plugin={plugin} />
                  ))}
                </div>
              ) : (
                <Accordion
                  type='multiple'
                  className='w-full'
                  value={expandedItems}
                  onValueChange={setExpandedItems}
                >
                  {items.map((plugin) => (
                    <PluginAccordionItem key={plugin.id} plugin={plugin} />
                  ))}
                </Accordion>
              )}
            </section>
          );
        })}
      </div>
    );
  };

  // Card Plugin per vista Grid (Restyled)
  const PluginCard = ({ plugin }: { plugin: Plugin }) => {
    const { logoUrl, headerBg, headerText } = getBuiltInPluginStyle(
      plugin.inputTypes,
      plugin.icon,
      plugin.logoUrl ?? undefined
    );
    const isToggling = togglingPlugin === plugin.id;
    const needsSetup = needsConfiguration(plugin);

    return (
      <motion.div
        layout
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
      >
        <Card
          className='group hover:border-primary/20 dark:hover:shadow-primary/5 relative cursor-pointer overflow-hidden rounded-2xl border border-zinc-200/50 bg-white/50 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg dark:border-zinc-800/50 dark:bg-zinc-900/50'
          onClick={() => openPluginDetail(plugin.id)}
        >
          <div className='p-3.5'>
            <div className='flex items-center justify-between gap-3'>
              <div className='flex min-w-0 flex-1 items-center gap-3'>
                <div
                  className={cn(
                    'relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border shadow-sm transition-transform duration-300 group-hover:scale-105',
                    headerBg
                  )}
                >
                  <PluginIcon
                    inputTypes={plugin.inputTypes}
                    icon={plugin.icon}
                    logoUrl={logoUrl}
                    size={24}
                    iconClassName={cn('h-5 w-5', headerText)}
                  />
                </div>
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-2'>
                    <CardTitle className='truncate text-sm font-bold tracking-tight'>
                      {plugin.name}
                    </CardTitle>
                    {needsSetup ? (
                      <div className='flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'>
                        <IconAlertTriangle className='h-3 w-3' />
                      </div>
                    ) : null}
                  </div>
                  <CardDescription className='text-muted-foreground mt-0.5 line-clamp-1 text-xs'>
                    {plugin.description}
                  </CardDescription>
                  <div className='mt-0.5 flex items-center gap-2'>
                    <p className='text-muted-foreground text-xs font-medium'>
                      v{plugin.version}
                    </p>
                    <span className='text-muted-foreground text-[10px] font-medium whitespace-nowrap'>
                      • {plugin.transforms.length} transforms
                    </span>
                  </div>
                </div>
              </div>
              <div
                className='flex shrink-0 items-center gap-0.5 rounded-full bg-zinc-100/80 p-0.5 backdrop-blur-md dark:bg-zinc-800/80'
                onClick={(e) => e.stopPropagation()}
              >
                {hasConfigSchema(plugin) && (
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-7 w-7 rounded-full hover:bg-white hover:shadow-sm dark:hover:bg-zinc-700'
                    onClick={() => openConfigDialog(plugin)}
                    title='Configure plugin'
                  >
                    <IconSettings className='h-3.5 w-3.5 text-zinc-500' />
                  </Button>
                )}
                {plugin.isExternal && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant='ghost'
                        size='icon'
                        className='h-7 w-7 rounded-full hover:bg-white hover:shadow-sm dark:hover:bg-zinc-700'
                        title='More options'
                      >
                        <IconDotsVertical className='h-3.5 w-3.5 text-zinc-500' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      <DropdownMenuItem
                        onClick={() => handleUninstall(plugin.id, plugin.name)}
                        className='text-red-600 focus:text-red-700 dark:text-red-400 dark:focus:text-red-300'
                      >
                        <IconTrash className='mr-2 h-4 w-4' />
                        Uninstall
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <Switch
                  checked={plugin.enabled}
                  onCheckedChange={(checked) => handleToggle(plugin, checked)}
                  disabled={isToggling || !canTogglePlugin(plugin)}
                />
              </div>
            </div>
          </div>
        </Card>
      </motion.div>
    );
  };

  // Accordion Plugin per vista Table/List
  const PluginAccordionItem = ({ plugin }: { plugin: Plugin }) => {
    const { logoUrl, headerBg, headerText } = getBuiltInPluginStyle(
      plugin.inputTypes,
      plugin.icon,
      plugin.logoUrl ?? undefined
    );
    const isToggling = togglingPlugin === plugin.id;
    const needsSetup = needsConfiguration(plugin);

    return (
      <AccordionItem
        value={plugin.id}
        className='group dark:hover:shadow-primary/5 mb-3 overflow-hidden rounded-[20px] border border-zinc-200/50 bg-white/50 shadow-sm transition-all duration-300 hover:shadow-lg dark:border-zinc-800/50 dark:bg-zinc-900/50'
      >
        <div
          className='relative flex cursor-pointer items-center'
          onClick={() => openPluginDetail(plugin.id)}
        >
          <div className='flex-1 py-4 pr-32 pl-5'>
            <div className='flex items-center gap-4'>
              <div
                className={cn(
                  'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-sm transition-transform duration-300 group-hover:scale-105',
                  headerBg
                )}
              >
                <PluginIcon
                  inputTypes={plugin.inputTypes}
                  icon={plugin.icon}
                  logoUrl={logoUrl}
                  size={28}
                  iconClassName={cn('h-6 w-6', headerText)}
                />
              </div>
              <div className='min-w-0 text-left'>
                <div className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1'>
                  <button
                    type='button'
                    className='min-w-0 flex-1 truncate text-left text-base font-bold tracking-tight'
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleExpandedPlugin(plugin.id);
                    }}
                  >
                    {plugin.name}
                  </button>

                  {needsSetup && (
                    <Badge
                      variant='outline'
                      className='border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/30 dark:bg-amber-900/10 dark:text-amber-400'
                    >
                      Setup Required
                    </Badge>
                  )}
                </div>
                <p className='text-muted-foreground mt-0.5 line-clamp-1 text-xs'>
                  {plugin.description}
                </p>
                <div className='mt-1 flex items-center gap-2'>
                  <p className='text-muted-foreground text-xs font-medium'>
                    v{plugin.version}
                  </p>
                  <span className='text-muted-foreground text-[10px] whitespace-nowrap'>
                    • {plugin.transforms.length} transforms
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className='absolute top-1/2 right-5 z-10 flex -translate-y-1/2 items-center gap-3'>
            <div
              className='flex items-center gap-1 rounded-full bg-zinc-100/80 p-1 backdrop-blur-md dark:bg-zinc-800/80'
              onClick={(e) => e.stopPropagation()}
            >
              {hasConfigSchema(plugin) && (
                <Button
                  variant='ghost'
                  size='icon'
                  className='h-8 w-8 rounded-full hover:bg-white hover:shadow-sm dark:hover:bg-zinc-700'
                  onClick={() => openConfigDialog(plugin)}
                  title='Configure plugin'
                >
                  <IconSettings className='h-4 w-4 text-zinc-500' />
                </Button>
              )}
              {plugin.isExternal && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='h-8 w-8 rounded-full hover:bg-white hover:shadow-sm dark:hover:bg-zinc-700'
                      title='More options'
                    >
                      <IconDotsVertical className='h-4 w-4 text-zinc-500' />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end'>
                    <DropdownMenuItem
                      onClick={() => handleUninstall(plugin.id, plugin.name)}
                      className='text-red-600 focus:text-red-700 dark:text-red-400 dark:focus:text-red-300'
                    >
                      <IconTrash className='mr-2 h-4 w-4' />
                      Uninstall
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Switch
                className='scale-90'
                checked={plugin.enabled}
                onCheckedChange={(checked) => handleToggle(plugin, checked)}
                disabled={isToggling || !canTogglePlugin(plugin)}
              />
            </div>
          </div>
        </div>
        <AccordionContent className='px-5 pb-5'>
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

                      {transform.requiresApiKey && (
                        <Badge
                          variant='outline'
                          className='gap-1 border-zinc-200 bg-zinc-50 px-1.5 text-[10px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400'
                          title='Requires your API key (plugin configuration)'
                        >
                          <IconKey className='h-3 w-3' />
                          API key
                        </Badge>
                      )}
                      <span className='text-muted-foreground text-xs'>—</span>
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
        </AccordionContent>
      </AccordionItem>
    );
  };

  return (
    <PageContainer>
      <div className='w-full space-y-4'>
        <div className='flex items-start justify-between'>
          <div>
            <Heading
              title='Plugins & Addons'
              description='Manage OSINT transformation plugins and addons.'
            />
            {!isWorkspaceAdmin && (
              <Badge variant='secondary' className='mt-2 gap-1'>
                <IconLock className='h-3 w-3' />
                View only (admin required to change settings)
              </Badge>
            )}
          </div>
        </div>
        <Separator />

        {mounted && (
          <Tabs
            value={activeTab}
            onValueChange={(value) =>
              setActiveTab(value === 'addons' ? 'addons' : 'plugins')
            }
            className='w-full space-y-6'
          >
            <div className='flex items-center justify-between gap-4'>
              <TabsList className='bg-zinc-100 p-1 dark:bg-zinc-800'>
                <TabsTrigger
                  value='plugins'
                  className='data-[state=active]:text-foreground gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-all data-[state=active]:bg-white data-[state=active]:shadow-sm'
                >
                  <IconPlug className='h-4 w-4' />
                  Plugins ({filteredPlugins.length})
                </TabsTrigger>
                <TabsTrigger
                  value='addons'
                  className='data-[state=active]:text-foreground gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-all data-[state=active]:bg-white data-[state=active]:shadow-sm'
                >
                  <IconPuzzle className='h-4 w-4' />
                  Addons ({filteredAddons.length})
                </TabsTrigger>
              </TabsList>

              <div className='flex items-center gap-3'>
                {ADDON_STORE_URL && (
                  <Button asChild variant='outline'>
                    <a
                      href={ADDON_STORE_URL}
                      target='_blank'
                      rel='noopener noreferrer'
                    >
                      Visit Store
                      <IconArrowRight className='h-4 w-4' />
                    </a>
                  </Button>
                )}
                {activeTab === 'addons' && isWorkspaceAdmin && (
                  <Button onClick={() => setShowInstallDialog(true)}>
                    <IconPuzzle className='h-4 w-4' />
                    Install from URL
                  </Button>
                )}

                <div className='relative w-72'>
                  <IconSearch className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
                  <Input
                    placeholder='Search'
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className='focus-visible:ring-primary/20 h-10 rounded-xl border-zinc-200 bg-white pr-9 pl-9 shadow-sm transition-all dark:border-zinc-800 dark:bg-zinc-900/50'
                  />
                  {searchQuery && (
                    <Button
                      variant='ghost'
                      size='icon'
                      className='absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2'
                      onClick={() => setSearchQuery('')}
                    >
                      <IconX className='h-4 w-4' />
                    </Button>
                  )}
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='outline'
                      className='h-10 rounded-xl border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50'
                      type='button'
                    >
                      {selectedLabel}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='w-56'>
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        setSelectedCategories([]);
                      }}
                      className='text-xs'
                    >
                      <div className='flex w-full items-center justify-between gap-2'>
                        <div className='flex min-w-0 items-center gap-2'>
                          <IconList className='text-muted-foreground h-4 w-4' />
                          <span className='truncate'>
                            All ({categoryStats.total})
                          </span>
                        </div>
                        <IconCheck
                          className={cn(
                            'text-muted-foreground h-4 w-4',
                            selectedCategories.length === 0
                              ? 'opacity-100'
                              : 'opacity-0'
                          )}
                        />
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {categoryStats.options.map((opt) => (
                      <DropdownMenuItem
                        key={opt.value}
                        onSelect={(e) => {
                          e.preventDefault();
                          toggleCategory(opt.value);
                        }}
                      >
                        <div className='flex w-full items-center justify-between gap-2'>
                          <div className='flex min-w-0 items-center gap-2'>
                            {(() => {
                              const Icon = getCategoryIcon(opt.value);
                              return (
                                <Icon className='text-muted-foreground h-4 w-4' />
                              );
                            })()}
                            <span className='truncate'>
                              {opt.label} ({opt.count})
                            </span>
                          </div>
                          <IconCheck
                            className={cn(
                              'text-muted-foreground h-4 w-4',
                              selectedCategories.includes(opt.value)
                                ? 'opacity-100'
                                : 'opacity-0'
                            )}
                          />
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <div className='flex items-center rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800'>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => handleViewModeChange('grid')}
                    className={cn(
                      'h-7 w-7 rounded-md p-0 hover:bg-transparent',
                      viewMode === 'grid' &&
                        'bg-white shadow-sm dark:bg-zinc-700'
                    )}
                  >
                    <IconLayoutGrid className='h-4 w-4' />
                  </Button>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => handleViewModeChange('table')}
                    className={cn(
                      'h-7 w-7 rounded-md p-0 hover:bg-transparent',
                      viewMode === 'table' &&
                        'bg-white shadow-sm dark:bg-zinc-700'
                    )}
                  >
                    <IconList className='h-4 w-4' />
                  </Button>
                </div>
              </div>
            </div>

            <TabsContent value='plugins' className='mt-0'>
              {loading ? (
                <LoadingSkeleton viewMode={viewMode} />
              ) : filteredPlugins.length === 0 ? (
                <EmptyState
                  icon={IconPackage}
                  title={searchQuery ? 'No plugins found' : 'No plugins'}
                  description={
                    searchQuery
                      ? 'Try a different search term.'
                      : 'Built-in and store plugins will appear here.'
                  }
                />
              ) : (
                <AnimatePresence mode='wait'>
                  <motion.div
                    key={`plugins-${viewMode}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <GroupedCollection list={filteredPlugins} />
                  </motion.div>
                </AnimatePresence>
              )}
            </TabsContent>

            <TabsContent value='addons' className='mt-0'>
              {loading ? (
                <LoadingSkeleton viewMode={viewMode} />
              ) : filteredAddons.length === 0 ? (
                <EmptyState
                  icon={IconPuzzle}
                  title={
                    searchQuery ? 'No addons found' : 'No addons installed'
                  }
                  description={
                    searchQuery
                      ? 'Try a different search term.'
                      : 'Addons are external providers installed from a manifest URL (Stremio-style).'
                  }
                  action={
                    !searchQuery && isWorkspaceAdmin ? (
                      <Button onClick={() => setShowInstallDialog(true)}>
                        <IconPuzzle className='h-4 w-4' />
                        Install from URL
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <AnimatePresence mode='wait'>
                  <motion.div
                    key={`addons-${viewMode}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <GroupedCollection list={filteredAddons} />
                  </motion.div>
                </AnimatePresence>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>

      {configPlugin ? (
        <PluginConfigSheet
          open={configDialogOpen}
          onOpenChange={setConfigDialogOpen}
          pluginId={configPlugin.id}
          title={`Configure ${configPlugin.name}`}
          configSchema={configPlugin.configSchema ?? {}}
          value={tempConfig}
          onChange={setTempConfig}
          onSave={savePluginConfig}
          saveLabel='Save Configuration'
        />
      ) : null}

      {/* Install Addon Dialog */}
      <InstallAddonDialog
        open={showInstallDialog}
        onOpenChange={setShowInstallDialog}
        onSuccess={() => {
          refreshPlugins();
        }}
      />
    </PageContainer>
  );
}

function LoadingSkeleton({ viewMode }: { viewMode: ViewMode }) {
  if (viewMode === 'table') {
    return (
      <div className='w-full space-y-3'>
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className='group dark:hover:shadow-primary/5 relative mb-3 overflow-hidden rounded-[20px] border border-zinc-200/50 bg-white/50 shadow-sm transition-all duration-300 dark:border-zinc-800/50 dark:bg-zinc-900/50'
          >
            <div className='flex items-center py-4 pr-32 pl-5'>
              <div className='flex items-center gap-4'>
                <Skeleton className='h-12 w-12 shrink-0 rounded-2xl' />
                <div className='min-w-0 space-y-2'>
                  <div className='flex items-center gap-3'>
                    <Skeleton className='h-4 w-32' />
                    <Skeleton className='h-5 w-24 rounded-full' />
                  </div>
                  <div className='flex items-center gap-2'>
                    <Skeleton className='h-3 w-12' />
                    <Skeleton className='h-3 w-20' />
                  </div>
                </div>
              </div>
            </div>
            <div className='absolute top-1/2 right-5 -translate-y-1/2'>
              <div className='flex items-center gap-1 rounded-full bg-zinc-100/80 p-1 backdrop-blur-md dark:bg-zinc-800/80'>
                <Skeleton className='h-8 w-8 rounded-full' />
                <Skeleton className='h-8 w-10 rounded-full' />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Card
          key={i}
          className='group hover:border-primary/20 dark:hover:shadow-primary/5 relative overflow-hidden rounded-[24px] border border-zinc-200/50 bg-white/50 shadow-sm transition-all duration-300 dark:border-zinc-800/50 dark:bg-zinc-900/50'
        >
          <div className='p-5'>
            <div className='flex items-center justify-between gap-4'>
              <div className='flex items-center gap-4'>
                <Skeleton className='h-14 w-14 shrink-0 rounded-2xl' />
                <div className='min-w-0 flex-1 space-y-2'>
                  <div className='flex items-center gap-2'>
                    <Skeleton className='h-4 w-32' />
                  </div>
                  <div className='flex items-center gap-2'>
                    <Skeleton className='h-3 w-12' />
                    <Skeleton className='h-3 w-20' />
                  </div>
                </div>
              </div>
              <div className='flex items-center gap-1 rounded-full bg-zinc-100/80 p-1 backdrop-blur-md dark:bg-zinc-800/80'>
                <Skeleton className='h-8 w-8 rounded-full' />
                <Skeleton className='h-8 w-10 rounded-full' />
              </div>
            </div>
            <Skeleton className='mt-4 h-10 w-full rounded-md' />
          </div>
        </Card>
      ))}
    </div>
  );
}

interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}

function EmptyState({
  icon: Icon,
  title,
  description,
  action
}: EmptyStateProps) {
  return (
    <div className='flex min-h-[200px] flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center'>
      <Icon className='text-muted-foreground mb-4 h-10 w-10' />
      <h3 className='mb-1 text-sm font-semibold'>{title}</h3>
      <p className='text-muted-foreground mb-4 max-w-sm text-xs'>
        {description}
      </p>
      {action}
    </div>
  );
}
