'use client';
import { useGraphCanEdit } from '@/features/graph/contexts/graph-mutation-context';

import {
  CaretRightIcon as IconChevronRight,
  CopyIcon as IconCopy,
  PenIcon as IconPencil,
  LightningIcon as IconTransform,
  TrashIcon as IconTrash
} from '@/components/icons';
import { useAdaptiveContextMenu } from '@/components/ui/adaptive-context-menu';
import { useEnabledPluginsContext } from '@/features/graph/contexts/enabled-plugins-context';
import {
  getGroupedPaletteItems,
  nodeTypeByType
} from '@/features/osint/node-registry';
import { getPhosphorIconByKey } from '@/features/osint/phosphor-icon-by-key';
import { cn } from '@/lib/utils';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { LogoOrIcon } from '../../components/logo-or-icon';

import { useTransformLogger } from '@/features/graph/contexts/transform-logger-context';
import {
  createTransformInput,
  executeTransform,
  getTransformsForEntityType,
  matchesInputType,
  type EntityType,
  type PluginDefinition,
  type TransformDefinition
} from '@/features/plugins';

const groupedNodeTypes = getGroupedPaletteItems();

export interface AnalysisNodeContextMenuProps {
  position: { x: number; y: number };
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  nodeMetadata?: Record<string, unknown> | null;
  sourcePosition: { x: number; y: number };
  onClose: () => void;
  onRename: () => void;
  onChangeType: (type: string) => void;
  onDelete: () => void;
}

export function AnalysisNodeContextMenu(props: AnalysisNodeContextMenuProps) {
  const canEdit = useGraphCanEdit();
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [showTypeSubmenu, setShowTypeSubmenu] = React.useState(false);
  const [showTransformsSubmenu, setShowTransformsSubmenu] =
    React.useState(false);
  const [activeCategory, setActiveCategory] = React.useState<string | null>(
    null
  );
  const [activeSocialPlatform, setActiveSocialPlatform] = React.useState<
    string | null
  >(null);
  const [activeTransformPluginId, setActiveTransformPluginId] = React.useState<
    string | null
  >(null);
  const submenuTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const categoryTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const socialTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const { enabledPluginIds, addons, graphId, pluginConfigs } =
    useEnabledPluginsContext();
  const { addLog, updateLog, onAddResults } = useTransformLogger();

  const availableTransforms = React.useMemo(() => {
    const entityType = props.nodeType as EntityType;
    const builtin = getTransformsForEntityType(
      entityType,
      enabledPluginIds ?? undefined
    );

    const addonTransforms: Array<{
      plugin: PluginDefinition;
      transform: TransformDefinition;
    }> = [];
    for (const addon of addons as any[]) {
      if (!addon?.enabled) continue;
      if (enabledPluginIds && !enabledPluginIds.includes(addon.id)) continue;

      const pluginDef: PluginDefinition = {
        id: addon.id,
        name: addon.name,
        description: addon.description,
        version: addon.version,
        author: addon.author,
        icon: addon.icon,
        category: addon.category,
        type: 'addon',
        runtime: 'external',
        inputTypes: addon.inputTypes as EntityType[],
        outputTypes: addon.outputTypes as EntityType[],
        transforms: (addon.transforms ?? []).map((t: any) => ({
          ...t,
          outputTypes: t.outputTypes as EntityType[]
        })),
        enabled: addon.enabled,
        estimatedTime: 'instant'
      };

      for (const transform of addon.transforms ?? []) {
        if (
          matchesInputType(props.nodeType as EntityType, transform.inputType)
        ) {
          addonTransforms.push({
            plugin: pluginDef,
            transform: {
              ...transform,
              outputTypes: transform.outputTypes as EntityType[]
            }
          });
        }
      }
    }

    return [...builtin, ...addonTransforms];
  }, [props.nodeType, enabledPluginIds, addons]);

  const groupedTransforms = React.useMemo(() => {
    const groups = new Map<
      string,
      { plugin: PluginDefinition; items: TransformDefinition[] }
    >();
    for (const item of availableTransforms) {
      const existing = groups.get(item.plugin.id);
      if (existing) {
        existing.items.push(item.transform);
        continue;
      }
      groups.set(item.plugin.id, {
        plugin: item.plugin,
        items: [item.transform]
      });
    }
    return Array.from(groups.values());
  }, [availableTransforms]);

  async function pollAsyncJob(args: { jobId: string; logId: string }) {
    const maxAttempts = 60;
    let attempts = 0;

    async function poll() {
      if (attempts >= maxAttempts) {
        updateLog(args.logId, {
          status: 'failed',
          error: 'Timeout: Job took too long to complete',
          endTime: new Date()
        });
        return;
      }
      attempts++;

      const res = await fetch(`/api/jobs/${args.jobId}`);
      if (!res.ok) throw new Error(`job_${res.status}`);
      const job = await res.json();

      if (job.progress !== undefined && job.progressMessage) {
        updateLog(args.logId, {
          progress: job.progress,
          message: job.progressMessage
        });
      }

      if (job.isCompleted && job.result) {
        updateLog(args.logId, {
          status: 'completed',
          resultCount: job.result.entities?.length || 0,
          endTime: new Date(),
          message: job.result.message,
          results: {
            entities: job.result.entities || [],
            edges: job.result.edges || []
          }
        });

        if (
          canEdit() &&
          onAddResults &&
          (job.result.entities?.length || 0) > 0
        ) {
          const entities = job.result.entities || [];
          const edges = job.result.edges || [];
          if (entities.length > 3) {
            // Non aggiungere automaticamente: verrà mostrato lo sheet globale per la conferma.
            return;
          }
          const allIds = entities.map((e: any) => String(e.id));
          onAddResults(
            entities,
            edges,
            { position: props.sourcePosition, nodeId: props.nodeId },
            allIds
          );
        }
        return;
      }

      if (job.isFailed) {
        updateLog(args.logId, {
          status: 'failed',
          error: job.error || 'Unknown error',
          endTime: new Date()
        });
        return;
      }

      if (job.isActive) setTimeout(poll, 5000);
    }

    poll();
  }

  async function runTransform(item: {
    plugin: PluginDefinition;
    transform: TransformDefinition;
  }) {
    if (!canEdit()) return;
    const effectiveValue =
      (props.nodeMetadata?.hash as string) ||
      (props.nodeMetadata?.address as string) ||
      (props.nodeMetadata?.value as string) ||
      props.nodeLabel.split('\n')[0];

    const logId = addLog({
      pluginName: item.plugin.name,
      transformName: item.transform.name,
      entityValue: effectiveValue,
      status: 'running',
      progress: 0,
      message: 'Starting...',
      sourceNodeId: props.nodeId,
      sourcePosition: props.sourcePosition
    });

    try {
      const pluginConfig: Record<string, unknown> =
        (pluginConfigs as any)[item.plugin.id] || {};
      const input = createTransformInput(
        props.nodeId,
        props.nodeType,
        effectiveValue,
        props.nodeMetadata ?? undefined,
        pluginConfig
      );
      const result = await executeTransform(
        item.plugin.id,
        item.transform.id,
        input,
        graphId,
        {
          onProgress: (update) => updateLog(logId, update)
        }
      );

      if (!result.success) {
        updateLog(logId, {
          status: 'failed',
          error: result.error || 'Transform failed',
          endTime: new Date()
        });
        return;
      }

      if ((result as any).async && (result as any).jobId) {
        updateLog(logId, { message: 'Queued…', progress: 0 });
        await pollAsyncJob({ jobId: (result as any).jobId, logId });
        return;
      }

      updateLog(logId, {
        status: 'completed',
        resultCount: result.entities?.length || 0,
        endTime: new Date(),
        message: (result as any).message,
        results: { entities: result.entities || [], edges: result.edges || [] }
      });

      if (canEdit() && onAddResults && (result.entities?.length || 0) > 0) {
        const entities = result.entities || [];
        const edges = result.edges || [];
        if (entities.length > 3) {
          // Non aggiungere automaticamente: verrà mostrato lo sheet globale per la conferma.
          return;
        }
        const allIds = entities.map((e: any) => String(e.id));
        onAddResults(
          entities,
          edges,
          { position: props.sourcePosition, nodeId: props.nodeId },
          allIds
        );
      }
    } catch (err: any) {
      updateLog(logId, {
        status: 'failed',
        error: String(err?.message ?? 'Transform error'),
        endTime: new Date()
      });
    }
  }

  React.useEffect(() => {
    const handlePointer = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node))
        props.onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handlePointer, true);
      document.addEventListener('contextmenu', handlePointer, true);
      document.addEventListener('keydown', handleKeyDown);
    }, 0);

    return () => {
      clearTimeout(timer);
      if (submenuTimeoutRef.current) clearTimeout(submenuTimeoutRef.current);
      if (categoryTimeoutRef.current) clearTimeout(categoryTimeoutRef.current);
      if (socialTimeoutRef.current) clearTimeout(socialTimeoutRef.current);
      document.removeEventListener('mousedown', handlePointer, true);
      document.removeEventListener('contextmenu', handlePointer, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [props]);

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: props.position.x,
    top: props.position.y,
    zIndex: 99999
  };
  useAdaptiveContextMenu(menuRef, props.position);

  function openTypeSubmenu() {
    if (submenuTimeoutRef.current) clearTimeout(submenuTimeoutRef.current);
    setShowTransformsSubmenu(false);
    setShowTypeSubmenu(true);
  }
  function closeTypeSubmenuWithDelay() {
    submenuTimeoutRef.current = setTimeout(() => {
      setShowTypeSubmenu(false);
      setActiveCategory(null);
      setActiveSocialPlatform(null);
    }, 150);
  }
  function cancelCloseTypeSubmenu() {
    if (submenuTimeoutRef.current) clearTimeout(submenuTimeoutRef.current);
  }

  function openTransformsSubmenu() {
    if (!canEdit()) return;
    if (submenuTimeoutRef.current) clearTimeout(submenuTimeoutRef.current);
    setShowTypeSubmenu(false);
    setShowTransformsSubmenu(true);
  }
  function closeTransformsSubmenuWithDelay() {
    submenuTimeoutRef.current = setTimeout(() => {
      setShowTransformsSubmenu(false);
      setActiveTransformPluginId(null);
    }, 150);
  }
  function cancelCloseTransformsSubmenu() {
    if (submenuTimeoutRef.current) clearTimeout(submenuTimeoutRef.current);
  }

  function openCategorySubmenu(category: string) {
    if (categoryTimeoutRef.current) clearTimeout(categoryTimeoutRef.current);
    setActiveCategory(category);
    setActiveSocialPlatform(null);
  }
  function closeCategorySubmenuWithDelay() {
    categoryTimeoutRef.current = setTimeout(() => {
      setActiveCategory(null);
      setActiveSocialPlatform(null);
    }, 150);
  }
  function cancelCloseCategorySubmenu() {
    if (categoryTimeoutRef.current) clearTimeout(categoryTimeoutRef.current);
  }

  function openSocialPlatformSubmenu(platform: string) {
    if (socialTimeoutRef.current) clearTimeout(socialTimeoutRef.current);
    setActiveSocialPlatform(platform);
  }
  function closeSocialPlatformSubmenuWithDelay() {
    socialTimeoutRef.current = setTimeout(() => {
      setActiveSocialPlatform(null);
    }, 150);
  }
  function cancelCloseSocialPlatformSubmenu() {
    if (socialTimeoutRef.current) clearTimeout(socialTimeoutRef.current);
  }

  return createPortal(
    <>
      <div
        ref={menuRef}
        className='bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 w-56 rounded-md border p-1 shadow-md duration-100'
        style={menuStyle}
        onContextMenu={(e) => e.stopPropagation()}
      >
        <button
          className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
          onClick={() => {
            void navigator.clipboard.writeText(props.nodeLabel).catch(() => {
              toast.error('Unable to copy node value');
            });
            props.onClose();
          }}
        >
          <IconCopy className='h-4 w-4' />
          Copy value
        </button>
        <button
          disabled={!canEdit()}
          className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
          onClick={() => {
            if (!canEdit()) return;
            props.onRename();
            props.onClose();
          }}
        >
          <IconPencil className='h-4 w-4' />
          Rename…
        </button>

        <div
          className='relative'
          onMouseEnter={() => {
            if (!canEdit()) return;
            openTransformsSubmenu();
          }}
          onMouseLeave={closeTransformsSubmenuWithDelay}
        >
          <button
            disabled={!canEdit()}
            className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none disabled:opacity-40'
          >
            <span className='flex items-center gap-2'>
              <IconTransform className='h-4 w-4' />
              Transforms
            </span>
            <IconChevronRight className='h-4 w-4' />
          </button>

          {showTransformsSubmenu && canEdit() ? (
            <div
              className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-60 rounded-md border p-1 shadow-md duration-100'
              onMouseEnter={() => {
                if (!canEdit()) return;
                cancelCloseTransformsSubmenu();
              }}
              onMouseLeave={closeTransformsSubmenuWithDelay}
            >
              {groupedTransforms.length ? (
                groupedTransforms.map((group) => (
                  <div
                    key={group.plugin.id}
                    className='relative'
                    onMouseEnter={() => {
                      if (!canEdit()) return;
                      setActiveTransformPluginId(group.plugin.id);
                    }}
                    onMouseLeave={() => setActiveTransformPluginId(null)}
                  >
                    <button
                      disabled={!canEdit()}
                      className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
                    >
                      <span className='min-w-0 flex-1 truncate text-left'>
                        {group.plugin.name}
                      </span>
                      <IconChevronRight className='h-4 w-4' />
                    </button>

                    {activeTransformPluginId === group.plugin.id ? (
                      <div className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-72 rounded-md border p-1 shadow-md duration-100'>
                        {group.items.map((t) => (
                          <button
                            disabled={!canEdit()}
                            key={t.id}
                            className='hover:bg-accent hover:text-accent-foreground relative flex w-full min-w-0 cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
                            onClick={() => {
                              if (!canEdit()) return;
                              void runTransform({
                                plugin: group.plugin,
                                transform: t
                              });
                              props.onClose();
                            }}
                            title={t.description}
                          >
                            <span className='min-w-0 flex-1 truncate'>
                              {t.name}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className='text-muted-foreground px-2 py-1.5 text-xs'>
                  No transforms available
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div
          className='relative'
          onMouseEnter={() => {
            if (!canEdit()) return;
            openTypeSubmenu();
          }}
          onMouseLeave={closeTypeSubmenuWithDelay}
        >
          <button
            disabled={!canEdit()}
            className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
          >
            <span className='flex items-center gap-2'>
              <span className='h-4 w-4 rounded-sm border' />
              Change type
            </span>
            <IconChevronRight className='h-4 w-4' />
          </button>

          {showTypeSubmenu ? (
            <div
              className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-52 rounded-md border p-1 shadow-md duration-100'
              onMouseEnter={() => {
                if (!canEdit()) return;
                cancelCloseTypeSubmenu();
              }}
              onMouseLeave={closeTypeSubmenuWithDelay}
            >
              {Object.entries(groupedNodeTypes).map(
                ([category, subcategories]) => {
                  const hasSubcategories =
                    Object.keys(subcategories).filter((k) => k !== '_root')
                      .length > 0;
                  const hasRootItems =
                    subcategories['_root'] && subcategories['_root'].length > 0;

                  return (
                    <div
                      key={category}
                      className='relative'
                      onMouseEnter={() => {
                        if (!canEdit()) return;
                        openCategorySubmenu(category);
                      }}
                      onMouseLeave={closeCategorySubmenuWithDelay}
                    >
                      <button
                        disabled={!canEdit()}
                        className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
                      >
                        <span className='flex-1 text-left'>{category}</span>
                        <IconChevronRight className='h-4 w-4' />
                      </button>

                      {activeCategory === category ? (
                        <div
                          className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-56 rounded-md border p-1 shadow-md duration-100'
                          onMouseEnter={() => {
                            if (!canEdit()) return;
                            cancelCloseCategorySubmenu();
                          }}
                          onMouseLeave={closeCategorySubmenuWithDelay}
                        >
                          {hasRootItems
                            ? subcategories['_root'].map((option) => (
                                <button
                                  disabled={!canEdit()}
                                  key={option.value}
                                  className='hover:bg-accent hover:text-accent-foreground relative flex w-full min-w-0 cursor-default items-center justify-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
                                  onClick={() => {
                                    if (!canEdit()) return;
                                    props.onChangeType(option.value);
                                    props.onClose();
                                  }}
                                >
                                  <span
                                    className={cn(
                                      'relative rounded-lg p-1',
                                      nodeTypeByType[option.value]?.ui?.headerBg
                                    )}
                                  >
                                    <LogoOrIcon
                                      label={option.label}
                                      logoUrl={option.logoUrl}
                                      Icon={getPhosphorIconByKey(
                                        option.iconKey
                                      )}
                                      sizePx={14}
                                      className='h-3.5 w-3.5'
                                      iconClassName={
                                        nodeTypeByType[option.value]?.ui
                                          ?.headerText
                                      }
                                    />
                                  </span>
                                  <span className='min-w-0 flex-1 truncate text-left whitespace-nowrap'>
                                    {option.label}
                                  </span>
                                </button>
                              ))
                            : null}

                          {hasRootItems && hasSubcategories ? (
                            <div className='bg-border/60 my-1 h-px w-full' />
                          ) : null}

                          {Object.entries(subcategories)
                            .filter(([key]) => key !== '_root')
                            .map(([subcategory, options]) => {
                              const isSocial = category === 'Social Media';
                              return (
                                <div
                                  key={subcategory}
                                  className='relative'
                                  onMouseEnter={() => {
                                    if (!canEdit()) return;
                                    if (isSocial)
                                      openSocialPlatformSubmenu(subcategory);
                                  }}
                                  onMouseLeave={() => {
                                    if (isSocial)
                                      closeSocialPlatformSubmenuWithDelay();
                                  }}
                                >
                                  <button
                                    disabled={!canEdit()}
                                    className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
                                  >
                                    <span className='flex-1 text-left'>
                                      {subcategory}
                                    </span>
                                    <IconChevronRight className='h-4 w-4' />
                                  </button>

                                  {/* Social Media: nested platform submenu */}
                                  {isSocial &&
                                  activeSocialPlatform === subcategory ? (
                                    <div
                                      className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-56 rounded-md border p-1 shadow-md duration-100'
                                      onMouseEnter={() => {
                                        if (!canEdit()) return;
                                        cancelCloseSocialPlatformSubmenu();
                                      }}
                                      onMouseLeave={
                                        closeSocialPlatformSubmenuWithDelay
                                      }
                                    >
                                      {options.map((option) => (
                                        <button
                                          disabled={!canEdit()}
                                          key={option.value}
                                          className='hover:bg-accent hover:text-accent-foreground relative flex w-full min-w-0 cursor-default items-center justify-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
                                          onClick={() => {
                                            if (!canEdit()) return;
                                            props.onChangeType(option.value);
                                            props.onClose();
                                          }}
                                        >
                                          <span
                                            className={cn(
                                              'relative rounded-lg p-1',
                                              nodeTypeByType[option.value]?.ui
                                                ?.headerBg
                                            )}
                                          >
                                            <LogoOrIcon
                                              label={option.label}
                                              logoUrl={option.logoUrl}
                                              Icon={getPhosphorIconByKey(
                                                option.iconKey
                                              )}
                                              sizePx={14}
                                              className='h-3.5 w-3.5'
                                              iconClassName={
                                                nodeTypeByType[option.value]?.ui
                                                  ?.headerText
                                              }
                                            />
                                          </span>
                                          <span className='min-w-0 flex-1 truncate text-left whitespace-nowrap'>
                                            {option.label}
                                          </span>
                                        </button>
                                      ))}
                                    </div>
                                  ) : !isSocial ? (
                                    <div className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-56 rounded-md border p-1 shadow-md duration-100'>
                                      {options.map((option) => (
                                        <button
                                          disabled={!canEdit()}
                                          key={option.value}
                                          className='hover:bg-accent hover:text-accent-foreground relative flex w-full min-w-0 cursor-default items-center justify-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
                                          onClick={() => {
                                            if (!canEdit()) return;
                                            props.onChangeType(option.value);
                                            props.onClose();
                                          }}
                                        >
                                          <span
                                            className={cn(
                                              'relative rounded-lg p-1',
                                              nodeTypeByType[option.value]?.ui
                                                ?.headerBg
                                            )}
                                          >
                                            <LogoOrIcon
                                              label={option.label}
                                              logoUrl={option.logoUrl}
                                              Icon={getPhosphorIconByKey(
                                                option.iconKey
                                              )}
                                              sizePx={14}
                                              className='h-3.5 w-3.5'
                                              iconClassName={
                                                nodeTypeByType[option.value]?.ui
                                                  ?.headerText
                                              }
                                            />
                                          </span>
                                          <span className='min-w-0 flex-1 truncate text-left whitespace-nowrap'>
                                            {option.label}
                                          </span>
                                        </button>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                        </div>
                      ) : null}
                    </div>
                  );
                }
              )}
            </div>
          ) : null}
        </div>

        <div className='bg-border/60 my-1 h-px w-full' />

        <button
          className='hover:bg-destructive/10 hover:text-destructive relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
          disabled={!canEdit()}
          onClick={() => {
            if (!canEdit()) return;
            props.onDelete();
            props.onClose();
          }}
        >
          <IconTrash className='h-4 w-4' />
          Delete
        </button>
      </div>
    </>,
    document.body
  );
}
