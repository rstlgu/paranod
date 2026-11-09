'use client';

import {
  QuestionIcon as IconInfo,
  MagnifyingGlassIcon as IconSearch,
  SidebarSimpleIcon as IconSidebar,
  TrashIcon as IconTrash,
  XIcon as IconX
} from '@/components/icons';
import * as React from 'react';
import type { ImperativePanelHandle } from 'react-resizable-panels';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResizablePanel } from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import { LogoOrIcon } from '@/features/graph/components/graph-editor/components/logo-or-icon';
import { getEntityConfig } from '@/features/graph/config/entity-config';
import {
  getGroupedPaletteItems,
  nodePaletteItems,
  nodeTypeByType,
  type NodeType
} from '@/features/osint/node-registry';
import { getPhosphorIconByKey } from '@/features/osint/phosphor-icon-by-key';
import { matchesInputType, type EntityType } from '@/features/plugins';
import { getBuiltInPluginStyle } from '@/features/plugins/utils/plugin-style';
import { Focus } from 'lucide-react';
import { FlowSidepanelBottomBar } from './flow-sidepanel-bottom-bar';

export type FlowSidepanelTabId = 'nodes' | 'add' | 'trigger';

interface TransformItem {
  pluginId: string;
  pluginName: string;
  pluginIcon: string | null;
  pluginLogoUrl: string | null;
  transformId: string;
  name: string;
  description: string;
  inputType: string | null;
  outputTypes: string[] | null;
}

export interface FlowSidepanelProps {
  // resize/collapse (parity with GraphSidebar)
  sidebarPanelRef: React.MutableRefObject<ImperativePanelHandle | null>;
  lastOpenSidebarSizeRef: React.MutableRefObject<number>;
  sidebarStateFromResizeRef: React.MutableRefObject<boolean>;
  isSidebarOpen: boolean;
  setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  sidebarCollapsedSizePct: number;
  sidebarMinSizePct: number;
  sidebarMaxSizePct: number;

  // UI state
  sidebarTab: FlowSidepanelTabId;
  setSidebarTab: (tab: FlowSidepanelTabId) => void;
  toggleSidebar: () => void;
  sidebarSearchQuery: string;
  setSidebarSearchQuery: (next: string) => void;
  sidebarSearchInputRef: React.MutableRefObject<HTMLInputElement | null>;

  // nodes list
  nodeItems: Array<{
    id: string;
    title: string;
    subtitle?: string | null;
    pluginId?: string | null;
    pluginIcon?: string | null;
    pluginLogoUrl?: string | null;
    inputType?: string | null;
  }>;
  onSelectNodeId: (nodeId: string) => void;

  // selection (bottom bar)
  selectedNodeCount: number;
  selectedNodeIds: string[];
  onFitViewToSelection: (nodeIds: string[]) => void;
  onClearSelection: () => void;
  onDeleteSelection: () => void;

  // transforms (add tab)
  transformGroups: Array<{
    pluginId: string;
    pluginName: string;
    transforms: TransformItem[];
  }>;
  onAddTransform: (t: TransformItem) => void;
  activeTriggerNodeType: string | null;
  onSetTriggerNodeType: (nodeType: string) => void;
  missingNodeCount: number;
  orphanEdgeCount: number;
}

export function FlowSidepanel(props: FlowSidepanelProps) {
  const normalizedSearchQuery = props.sidebarSearchQuery.trim().toLowerCase();
  const parsedSearch = React.useMemo(() => {
    const raw = props.sidebarSearchQuery.trim();
    if (!raw)
      return {
        inputTypes: [] as string[],
        outputTypes: [] as string[],
        text: ''
      };
    const parts = raw.split(/\s+/g).filter(Boolean);
    const inTokens = parts.filter((p) => p.toLowerCase().startsWith('in:'));
    const outTokens = parts.filter((p) => p.toLowerCase().startsWith('out:'));
    const inputTypes = inTokens
      .map((t) => t.slice('in:'.length).trim())
      .filter(Boolean)
      .map((t) => t.toLowerCase());
    const outputTypes = outTokens
      .map((t) => t.slice('out:'.length).trim())
      .filter(Boolean)
      .map((t) => t.toLowerCase());
    const rest = parts
      .filter((p) => !inTokens.includes(p) && !outTokens.includes(p))
      .join(' ')
      .trim();
    return {
      inputTypes,
      outputTypes,
      text: rest.toLowerCase()
    };
  }, [props.sidebarSearchQuery]);
  const totalTransformCount = React.useMemo(
    () =>
      props.transformGroups.reduce((acc, g) => acc + g.transforms.length, 0),
    [props.transformGroups]
  );
  const triggerNodeTypeOptions = nodePaletteItems;
  const groupedTriggerNodeTypes = React.useMemo(
    () => getGroupedPaletteItems(),
    []
  );

  const [openedAddTransformGroupIds, setOpenedAddTransformGroupIds] =
    React.useState<string[]>([]);

  const filteredNodes = React.useMemo(() => {
    if (!normalizedSearchQuery) return props.nodeItems;
    return props.nodeItems.filter((n) => {
      const a = String(n.title ?? '').toLowerCase();
      const b = String(n.subtitle ?? '').toLowerCase();
      return (
        a.includes(normalizedSearchQuery) || b.includes(normalizedSearchQuery)
      );
    });
  }, [normalizedSearchQuery, props.nodeItems]);

  const filteredTransformGroups = React.useMemo(() => {
    const q =
      parsedSearch.inputTypes.length > 0 || parsedSearch.outputTypes.length > 0
        ? parsedSearch.text
        : normalizedSearchQuery;
    const requiredInputTypes = parsedSearch.inputTypes;
    const requiredOutputTypes = parsedSearch.outputTypes;
    if (
      !q &&
      requiredInputTypes.length === 0 &&
      requiredOutputTypes.length === 0
    )
      return props.transformGroups;
    return props.transformGroups
      .map((g) => {
        const next = g.transforms.filter((t) => {
          const a = String(t.name ?? '').toLowerCase();
          const b = String(t.description ?? '').toLowerCase();
          const c = String(g.pluginName ?? '').toLowerCase();
          const inputType = t.inputType
            ? String(t.inputType).toLowerCase()
            : '';
          if (requiredInputTypes.length > 0) {
            const ok = requiredInputTypes.some(
              (req) =>
                Boolean(req && inputType) &&
                matchesInputType(req as EntityType, inputType)
            );
            if (!ok) return false;
          }
          const outs = Array.isArray(t.outputTypes)
            ? t.outputTypes
                .map((x) => String(x ?? '').toLowerCase())
                .filter(Boolean)
            : [];
          if (requiredOutputTypes.length > 0) {
            const ok = requiredOutputTypes.some((req) => {
              if (!req) return false;
              return (
                outs.includes(req) ||
                outs.some((o) => o.includes(req) || req.includes(o))
              );
            });
            if (!ok) return false;
          }
          if (!q) return true;
          const outsText = outs.join(' ');
          return (
            a.includes(q) ||
            b.includes(q) ||
            c.includes(q) ||
            inputType.includes(q) ||
            outsText.includes(q)
          );
        });
        return { ...g, transforms: next };
      })
      .filter((g) => g.transforms.length > 0);
  }, [
    normalizedSearchQuery,
    parsedSearch.inputTypes,
    parsedSearch.outputTypes,
    parsedSearch.text,
    props.transformGroups
  ]);

  const filteredGroupedTriggerNodeTypes = React.useMemo(() => {
    const q = normalizedSearchQuery;
    if (!q) return groupedTriggerNodeTypes;

    const out: typeof groupedTriggerNodeTypes = {};
    for (const [category, subcategories] of Object.entries(
      groupedTriggerNodeTypes
    )) {
      const nextSubcategories: Record<string, any[]> = {};
      for (const [subcategory, options] of Object.entries(subcategories)) {
        const filtered = (options ?? []).filter((opt: any) => {
          const haystack =
            `${opt.label} ${category} ${subcategory}`.toLowerCase();
          return haystack.includes(q);
        });
        if (filtered.length) nextSubcategories[subcategory] = filtered;
      }
      if (Object.keys(nextSubcategories).length)
        out[category] = nextSubcategories as any;
    }
    return out;
  }, [groupedTriggerNodeTypes, normalizedSearchQuery]);

  const openedTriggerCategories = React.useMemo(() => {
    if (!normalizedSearchQuery) return null;
    return Object.keys(filteredGroupedTriggerNodeTypes);
  }, [filteredGroupedTriggerNodeTypes, normalizedSearchQuery]);

  function isProbablyUrl(value: string | null | undefined) {
    if (!value) return false;
    return (
      value.startsWith('http://') ||
      value.startsWith('https://') ||
      value.startsWith('data:') ||
      value.startsWith('/api/logo')
    );
  }

  React.useEffect(() => {
    if (props.sidebarTab !== 'add') return;
    if (!normalizedSearchQuery) {
      setOpenedAddTransformGroupIds([]);
      return;
    }
    setOpenedAddTransformGroupIds(
      filteredTransformGroups.map((g) => g.pluginId)
    );
  }, [filteredTransformGroups, normalizedSearchQuery, props.sidebarTab]);

  return (
    <ResizablePanel
      ref={props.sidebarPanelRef}
      defaultSize={
        props.isSidebarOpen
          ? props.lastOpenSidebarSizeRef.current
          : props.sidebarCollapsedSizePct
      }
      collapsible
      collapsedSize={props.sidebarCollapsedSizePct}
      minSize={props.sidebarMinSizePct}
      maxSize={props.sidebarMaxSizePct}
      onResize={(size) => {
        const collapseAt = props.sidebarCollapsedSizePct + 0.5;
        const expandAt = props.sidebarCollapsedSizePct + 2;

        if (size <= collapseAt && props.isSidebarOpen) {
          props.sidebarStateFromResizeRef.current = true;
          props.setIsSidebarOpen(false);
          return;
        }

        if (size >= expandAt && !props.isSidebarOpen) {
          props.sidebarStateFromResizeRef.current = true;
          props.setIsSidebarOpen(true);
        }

        if (size >= expandAt) props.lastOpenSidebarSizeRef.current = size;
      }}
      className='min-w-0 transition-[flex-grow,flex-basis] duration-200 ease-in-out'
    >
      <aside
        className={cn(
          'group/flow-sidebar bg-background text-foreground relative flex h-full flex-col overflow-hidden dark:border-white/10'
        )}
      >
        <Tabs
          value={props.sidebarTab}
          onValueChange={(v) => props.setSidebarTab(v as FlowSidepanelTabId)}
          className='flex min-h-0 flex-1 flex-col'
        >
          <div className='border-border/40 flex h-11 items-center justify-between border-b px-3'>
            <div className='text-sm font-semibold'>
              Transforms Panel{' '}
              <span className='text-muted-foreground font-medium'>(Cmd+B)</span>
            </div>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className="size-8 [&_svg:not([class*='size-'])]:!size-5"
              onClick={props.toggleSidebar}
              title='Collapse sidebar'
            >
              <IconSidebar className='h-4 w-4' />
            </Button>
          </div>

          <div className='px-3 py-3'>
            <div className='relative'>
              <IconSearch className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
              <Input
                ref={props.sidebarSearchInputRef}
                placeholder={
                  props.sidebarTab === 'trigger'
                    ? 'Search nodes…'
                    : props.sidebarTab === 'nodes'
                      ? 'Search transforms…'
                      : 'Search transforms…'
                }
                value={props.sidebarSearchQuery}
                onChange={(e) => props.setSidebarSearchQuery(e.target.value)}
                className='focus-visible:ring-primary/20 h-10 rounded-xl border-zinc-200 bg-white pr-10 pl-9 shadow-sm transition-all dark:border-zinc-800 dark:bg-zinc-900/50'
              />
              {props.sidebarSearchQuery.trim().length > 0 ? (
                <button
                  type='button'
                  className={cn(
                    'absolute top-1/2 right-2 -translate-y-1/2',
                    'inline-flex h-7 w-7 items-center justify-center rounded-md',
                    'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                    'focus-visible:ring-ring/50 focus-visible:ring-2 focus-visible:outline-none'
                  )}
                  aria-label='Clear search'
                  onClick={() => {
                    props.setSidebarSearchQuery('');
                    requestAnimationFrame(() => {
                      props.sidebarSearchInputRef.current?.focus();
                    });
                  }}
                >
                  <IconX className='h-4 w-4' />
                </button>
              ) : null}
            </div>
          </div>

          <div className='px-3 pb-3'>
            <TabsList className='w-full bg-zinc-100 p-1 dark:bg-zinc-800'>
              <TabsTrigger
                value='nodes'
                className='data-[state=active]:text-foreground rounded-md px-4 py-1.5 text-sm font-medium transition-all data-[state=active]:bg-white data-[state=active]:shadow-sm'
              >
                Transforms ({props.nodeItems.length})
              </TabsTrigger>
              <TabsTrigger
                value='trigger'
                className='data-[state=active]:text-foreground rounded-md px-4 py-1.5 text-sm font-medium transition-all data-[state=active]:bg-white data-[state=active]:shadow-sm'
              >
                Trigger Node ({triggerNodeTypeOptions.length})
              </TabsTrigger>
              <TabsTrigger
                value='add'
                className='data-[state=active]:text-foreground rounded-md px-4 py-1.5 text-sm font-medium transition-all data-[state=active]:bg-white data-[state=active]:shadow-sm'
              >
                Add Transforms ({totalTransformCount})
              </TabsTrigger>
            </TabsList>
          </div>

          <div className='min-h-0 flex-1 overflow-hidden pt-2 pr-0 pb-0 pl-3'>
            <TabsContent value='nodes' className='h-full'>
              <div className='flex h-full min-h-0 flex-col'>
                <ScrollArea className='h-full'>
                  <div className='pr-6 pb-3'>
                    {filteredNodes.length === 0 ? (
                      <div className='text-muted-foreground px-2 py-6 text-center text-xs'>
                        No transforms found.
                      </div>
                    ) : (
                      <div className='space-y-1'>
                        {filteredNodes.map((n) => (
                          <button
                            key={n.id}
                            type='button'
                            className={cn(
                              'border-border/40 bg-background/60 w-full rounded-xl border p-1.5 text-left shadow-sm transition-all',
                              'hover:bg-muted/40 hover:shadow-md active:translate-y-px',
                              'dark:border-white/10 dark:bg-zinc-900/40'
                            )}
                            onClick={() => props.onSelectNodeId(n.id)}
                          >
                            {(() => {
                              const inputType = n.inputType
                                ? String(n.inputType)
                                : 'custom';
                              const inputCfg = getEntityConfig(inputType);
                              const iconKey = isProbablyUrl(
                                n.pluginIcon ?? null
                              )
                                ? undefined
                                : (n.pluginIcon ?? undefined);
                              const builtinStyle = getBuiltInPluginStyle(
                                [inputType],
                                iconKey,
                                undefined
                              );
                              const logoUrl =
                                n.pluginLogoUrl ??
                                (isProbablyUrl(n.pluginIcon ?? null)
                                  ? n.pluginIcon
                                  : undefined);
                              return (
                                <div
                                  className={cn(
                                    'flex items-center gap-2 rounded-lg px-2.5 py-2',
                                    inputCfg.headerBg
                                  )}
                                >
                                  <LogoOrIcon
                                    label={String(
                                      n.subtitle ?? n.pluginId ?? 'Plugin'
                                    )}
                                    logoUrl={logoUrl ?? undefined}
                                    Icon={builtinStyle.Icon}
                                    sizePx={18}
                                    className='h-[18px] w-[18px]'
                                    iconClassName={cn(
                                      'h-[18px] w-[18px]',
                                      inputCfg.headerText
                                    )}
                                  />
                                  <span
                                    className={cn(
                                      'min-w-0 flex-1 truncate text-sm font-semibold',
                                      inputCfg.headerText
                                    )}
                                  >
                                    {n.title}
                                  </span>
                                </div>
                              );
                            })()}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </TabsContent>

            <TabsContent value='trigger' className='h-full'>
              <div className='flex h-full min-h-0 flex-col pr-3'>
                <ScrollArea className='h-full'>
                  <div className='pr-3 pb-3'>
                    {Object.keys(filteredGroupedTriggerNodeTypes).length ===
                    0 ? (
                      <div className='text-muted-foreground px-2 py-6 text-center text-xs'>
                        No nodes found.
                      </div>
                    ) : (
                      <Accordion
                        type='multiple'
                        className='w-full'
                        value={openedTriggerCategories ?? undefined}
                      >
                        {Object.entries(filteredGroupedTriggerNodeTypes).map(
                          ([category, subcategories]) => {
                            const isSearching =
                              normalizedSearchQuery.length > 0;
                            const root = (subcategories as any)['_root'] || [];
                            const subcats = Object.entries(
                              subcategories as any
                            ).filter(([k]) => k !== '_root');
                            const categoryCount =
                              root.length +
                              subcats.reduce(
                                (acc, [, options]) =>
                                  acc + (options as any[]).length,
                                0
                              );
                            const flatOptions = isSearching
                              ? [
                                  ...root,
                                  ...subcats.flatMap(
                                    ([, options]) => options as any[]
                                  )
                                ]
                              : [];

                            const renderNodeRow = (option: any) => {
                              const typeKey = option.value as NodeType;
                              const typeDef = nodeTypeByType[typeKey];
                              const isActive =
                                String(option.value) ===
                                String(props.activeTriggerNodeType ?? '');

                              return (
                                <button
                                  key={String(option.value)}
                                  type='button'
                                  draggable
                                  onDragStart={(e) => {
                                    e.dataTransfer.setData(
                                      'application/paranod-flow-trigger-node-type',
                                      String(option.value)
                                    );
                                    // Firefox/Safari compatibility: ensure a text payload exists too
                                    e.dataTransfer.setData(
                                      'text/plain',
                                      String(option.value)
                                    );
                                    e.dataTransfer.effectAllowed = 'copy';
                                  }}
                                  onClick={() =>
                                    props.onSetTriggerNodeType(
                                      String(option.value)
                                    )
                                  }
                                  className={cn(
                                    'border-border/40 bg-background/60 w-full rounded-xl border p-1.5 text-left shadow-sm transition-all',
                                    'hover:bg-muted/40 hover:shadow-md active:translate-y-px',
                                    'dark:border-white/10 dark:bg-zinc-900/40',
                                    isActive && 'ring-primary/25 ring-2'
                                  )}
                                  title='Drag onto canvas to add'
                                >
                                  <div
                                    className={cn(
                                      'flex items-center gap-2 rounded-lg px-2.5 py-2',
                                      typeDef?.ui?.headerBg
                                    )}
                                  >
                                    <LogoOrIcon
                                      label={option.label}
                                      logoUrl={option.logoUrl ?? undefined}
                                      Icon={getPhosphorIconByKey(
                                        option.iconKey ?? 'DotsThreeOutline'
                                      )}
                                      sizePx={18}
                                      className='h-[18px] w-[18px]'
                                      iconClassName={cn(
                                        'h-[18px] w-[18px]',
                                        typeDef?.ui?.headerText
                                      )}
                                    />
                                    <span
                                      className={cn(
                                        'min-w-0 flex-1 truncate text-sm font-semibold',
                                        typeDef?.ui?.headerText
                                      )}
                                    >
                                      {option.label}
                                    </span>
                                  </div>
                                </button>
                              );
                            };

                            return (
                              <AccordionItem
                                key={category}
                                value={category}
                                className='border-border/40 dark:border-white/10'
                              >
                                <AccordionTrigger className='py-3 text-sm font-semibold'>
                                  <span className='inline-flex items-baseline gap-1'>
                                    <span>{category}</span>
                                    <span className='text-muted-foreground text-xs font-semibold'>
                                      ({categoryCount})
                                    </span>
                                  </span>
                                </AccordionTrigger>
                                <AccordionContent className='pb-2'>
                                  {isSearching ? (
                                    flatOptions.length > 0 ? (
                                      <div className='grid [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))] gap-2'>
                                        {flatOptions.map(renderNodeRow)}
                                      </div>
                                    ) : null
                                  ) : (
                                    <>
                                      {root.length > 0 && (
                                        <div className='grid [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))] gap-2'>
                                          {root.map(renderNodeRow)}
                                        </div>
                                      )}

                                      {subcats.length > 0 && (
                                        <div className='mt-3 space-y-4'>
                                          {subcats.map(
                                            ([subcategory, options]) => (
                                              <div
                                                key={subcategory}
                                                className='space-y-2'
                                              >
                                                <div className='text-muted-foreground px-0.5 text-xs font-semibold'>
                                                  {subcategory}
                                                </div>
                                                <div className='grid [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))] gap-2'>
                                                  {(options as any[]).map(
                                                    renderNodeRow
                                                  )}
                                                </div>
                                              </div>
                                            )
                                          )}
                                        </div>
                                      )}
                                    </>
                                  )}
                                </AccordionContent>
                              </AccordionItem>
                            );
                          }
                        )}
                      </Accordion>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </TabsContent>

            <TabsContent value='add' className='h-full'>
              <div className='flex h-full min-h-0 flex-col pr-3'>
                {props.missingNodeCount > 0 || props.orphanEdgeCount > 0 ? (
                  <div className='border-border/50 bg-muted/10 text-muted-foreground mb-2 rounded-lg border px-2 py-2 text-[11px]'>
                    <div className='flex items-start gap-2'>
                      <IconInfo className='mt-0.5 h-4 w-4 shrink-0' />
                      <div className='space-y-1'>
                        {props.missingNodeCount > 0 ? (
                          <div>
                            {props.missingNodeCount} node(s) disabled/missing.
                          </div>
                        ) : null}
                        {props.orphanEdgeCount > 0 ? (
                          <div>
                            {props.orphanEdgeCount} orphan link(s) in this flow.
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                <ScrollArea className='h-full'>
                  <div className='pr-3 pb-3'>
                    {filteredTransformGroups.length === 0 ? (
                      <div className='text-muted-foreground px-2 py-6 text-center text-xs'>
                        No transforms found.
                      </div>
                    ) : (
                      <Accordion
                        type='multiple'
                        className='w-full'
                        value={openedAddTransformGroupIds}
                        onValueChange={(v) =>
                          setOpenedAddTransformGroupIds(v as string[])
                        }
                      >
                        {filteredTransformGroups.map((g) => (
                          <AccordionItem
                            key={g.pluginId}
                            value={g.pluginId}
                            className='border-border/40 dark:border-white/10'
                          >
                            <AccordionTrigger className='py-3 text-sm font-semibold'>
                              <span className='inline-flex items-baseline gap-1'>
                                <span className='min-w-0 truncate'>
                                  {g.pluginName}
                                </span>
                                <span className='text-muted-foreground text-xs font-semibold'>
                                  ({g.transforms.length})
                                </span>
                              </span>
                            </AccordionTrigger>
                            <AccordionContent className='pb-2'>
                              <div className='space-y-1'>
                                {g.transforms.map((t) => (
                                  <button
                                    key={`${g.pluginId}:${t.transformId}`}
                                    type='button'
                                    className={cn(
                                      'border-border/40 bg-background/60 w-full rounded-xl border p-1.5 text-left shadow-sm transition-all',
                                      'hover:bg-muted/40 hover:shadow-md active:translate-y-px',
                                      'dark:border-white/10 dark:bg-zinc-900/40'
                                    )}
                                    draggable
                                    onDragStart={(e) => {
                                      e.dataTransfer.setData(
                                        'application/paranod-flow-transform',
                                        JSON.stringify(t)
                                      );
                                      e.dataTransfer.effectAllowed = 'move';
                                    }}
                                    onClick={() => props.onAddTransform(t)}
                                  ></button>
                                ))}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </TabsContent>
          </div>
          <FlowSidepanelBottomBar>
            {props.selectedNodeCount > 0 ? (
              <>
                <div className='text-muted-foreground text-xs'>
                  {props.selectedNodeCount} selected
                </div>
                <div className='flex-1' />
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className="size-7 [&_svg:not([class*='size-'])]:!size-4"
                  onClick={() =>
                    props.onFitViewToSelection(props.selectedNodeIds)
                  }
                  title='Fit view to selected'
                >
                  <Focus className='h-3 w-3' strokeWidth={1.75} />
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className="size-7 [&_svg:not([class*='size-'])]:!size-4"
                  onClick={props.onClearSelection}
                  title='Clear selection'
                >
                  <IconX className='h-4 w-4' />
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className="size-7 [&_svg:not([class*='size-'])]:!size-4"
                  onClick={props.onDeleteSelection}
                  title='Delete selected'
                >
                  <IconTrash className='h-4 w-4' />
                </Button>
              </>
            ) : (
              <>
                <div className='text-muted-foreground text-xs'>
                  {props.sidebarTab === 'nodes'
                    ? 'No transform selected'
                    : 'Drag transforms into the canvas'}
                </div>
                <div className='flex-1' />
                {props.sidebarTab === 'nodes' ? (
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='h-7 px-2 text-[11px]'
                    onClick={props.onClearSelection}
                  >
                    Clear
                  </Button>
                ) : (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className="size-7 [&_svg:not([class*='size-'])]:!size-4"
                    onClick={props.toggleSidebar}
                    title='Collapse'
                  >
                    <IconSidebar className='h-4 w-4' />
                  </Button>
                )}
              </>
            )}
          </FlowSidepanelBottomBar>
        </Tabs>
      </aside>
    </ResizablePanel>
  );
}
