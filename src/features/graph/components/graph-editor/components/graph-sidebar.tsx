'use client';

import * as React from 'react';
import {
  CaretRightIcon as IconChevronRight,
  MagnifyingGlassIcon as IconSearch,
  SidebarSimpleIcon as IconSidebar,
  StackIcon as IconMerge,
  TrashIcon as IconTrash,
  XIcon as IconX
} from '@/components/icons';
import { Focus } from 'lucide-react';
import type { ImperativePanelHandle } from 'react-resizable-panels';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ResizableHandle, ResizablePanel } from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TreeView, type TreeDataItem } from '@/components/ui/tree-view';
import { cn } from '@/lib/utils';
import { getPhosphorIconByKey } from '@/features/osint/phosphor-icon-by-key';
import { nodeTypeByType, type NodeType } from '@/features/osint/node-registry';

import { LogoOrIcon } from './logo-or-icon';
import { GraphSidepanelBottomBar } from './graph-sidepanel-bottom-bar';

type SidebarTabId = 'entities' | 'add';

interface NodeTypeOptionLike {
  value: string;
  label: string;
  logoUrl?: string | null;
  iconKey?: string | null;
}

interface GraphSidebarProps {
  isReadOnly?: boolean;
  sidebarPanelRef: React.MutableRefObject<ImperativePanelHandle | null>;
  lastOpenSidebarSizeRef: React.MutableRefObject<number>;
  sidebarStateFromResizeRef: React.MutableRefObject<boolean>;
  isSidebarOpen: boolean;
  setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  sidebarCollapsedSizePct: number;
  sidebarMinSizePct: number;
  sidebarMaxSizePct: number;

  // sidebar UI state
  sidebarTab: SidebarTabId;
  setSidebarTab: (tab: SidebarTabId) => void;
  toggleSidebar: () => void;
  sidebarSearchQuery: string;
  setSidebarSearchQuery: (next: string) => void;
  sidebarSearchInputRef: React.MutableRefObject<HTMLInputElement | null>;

  // data + callbacks
  nodeCount: number;
  selectedNodeCount: number;
  selectedNodeIds: string[];
  onFitViewToSelection: (nodeIds: string[]) => void;
  onSelectAll: () => void;
  onDeleteSelection: () => void;
  onClearSelection: () => void;
  canMergeSelection: boolean;
  onMergeSelection: () => void;
  canUnmergeSelection: boolean;
  onUnmergeSelection: () => void;
  nodeTypeOptions: ReadonlyArray<NodeTypeOptionLike>;
  filteredGraphTreeData: TreeDataItem[] | TreeDataItem;
  getGraphNodeCheckState: (nodeId: string) => boolean | 'indeterminate';
  toggleCheckedGraphNode: (
    nodeId: string,
    modifiers?: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }
  ) => void;
  getMergedChildCount: (nodeId: string) => number;
  handleSelectNodeFromTree: (nodeId: string) => void;
  nodeRowElByIdRef: React.MutableRefObject<Map<string, HTMLElement>>;
  setEntitiesScrollRootEl: (el: HTMLDivElement | null) => void;

  openedAddSidebarCategories: string[] | null;
  filteredGroupedNodeTypesForSidebar: Record<
    string,
    Record<string, ReadonlyArray<NodeTypeOptionLike>>
  >;
  normalizeSidebarSearchQuery: (q: string) => string;
  addNode: (type: any) => void;
  dndNodeTypeMime: string;
}

function GraphSidebarComponent(props: GraphSidebarProps) {
  const normalizedSearchQuery = props.normalizeSidebarSearchQuery(props.sidebarSearchQuery);
  const isSearching = normalizedSearchQuery.length > 0;

  const hasEntitiesSearchResults = React.useMemo(() => {
    if (!isSearching) return true;
    const data = props.filteredGraphTreeData;
    if (Array.isArray(data)) return data.length > 0;
    return Boolean(data);
  }, [isSearching, props.filteredGraphTreeData]);

  const hasAddSearchResults = React.useMemo(() => {
    if (!isSearching) return true;
    for (const subcategories of Object.values(props.filteredGroupedNodeTypesForSidebar)) {
      for (const options of Object.values(subcategories)) {
        if ((options ?? []).length > 0) return true;
      }
    }
    return false;
  }, [isSearching, props.filteredGroupedNodeTypesForSidebar]);

  return (
    <>
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
            // Match other app panels (e.g. Plugins page): visible border + standard background
            'group/graph-sidebar relative flex h-full flex-col overflow-hidden bg-background text-foreground dark:border-white/10'
          )}
        >
          <Tabs
            value={props.sidebarTab}
            onValueChange={(v) => props.setSidebarTab(v as SidebarTabId)}
            className='flex min-h-0 flex-1 flex-col'
          >
            <div className='flex h-11 items-center justify-between border-b border-border/40 px-3'>
              <div className='text-sm font-semibold'>
                Nodes Panel <span className='text-muted-foreground font-medium'>(Cmd+B)</span>
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
                  placeholder='Search…'
                  value={props.sidebarSearchQuery}
                  onChange={(e) => props.setSidebarSearchQuery(e.target.value)}
                  className='focus-visible:ring-primary/20 h-10 rounded-xl border-zinc-200 bg-white pr-10 pl-9 shadow-sm transition-all dark:border-zinc-800 dark:bg-zinc-900/50'
                />
                {props.sidebarSearchQuery.trim().length > 0 ? (
                  <button
                    type='button'
                    className={cn(
                      'absolute right-2 top-1/2 -translate-y-1/2',
                      'inline-flex h-7 w-7 items-center justify-center rounded-md',
                      'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
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
              {/* Match Plugins page tabs styling */}
              <TabsList className='bg-zinc-100 w-full p-1 dark:bg-zinc-800'>
                <TabsTrigger
                  value='entities'
                  className='data-[state=active]:text-foreground rounded-md px-4 py-1.5 text-sm font-medium transition-all data-[state=active]:bg-white data-[state=active]:shadow-sm'
                >
                  Nodes ({props.nodeCount})
                </TabsTrigger>
                <TabsTrigger
                  value='add'
                  className='data-[state=active]:text-foreground rounded-md px-4 py-1.5 text-sm font-medium transition-all data-[state=active]:bg-white data-[state=active]:shadow-sm'
                >
                  Add Nodes ({props.nodeTypeOptions.length})
                </TabsTrigger>
              </TabsList>
            </div>

            <div className='min-h-0 flex-1 overflow-hidden pb-0 pt-2 pl-3 pr-0'>
              <TabsContent value='entities' className='h-full'>
                <div ref={props.setEntitiesScrollRootEl} className='h-full'>
                  <ScrollArea className='h-full'>
                    <div className='pb-3 pr-6'>
                      {isSearching && !hasEntitiesSearchResults ? (
                        <div className='text-muted-foreground px-2 py-6 text-center text-xs'>
                          No results for this search
                        </div>
                      ) : (
                        <TreeView
                          data={props.filteredGraphTreeData}
                          expandAll
                          renderItem={({ item, level, isLeaf, isOpen, toggleOpen }) => {
                            const meta = item.data as
                              | { nodeId: string; type?: NodeType; isHidden?: boolean }
                              | undefined;

                              const nodeId = meta?.nodeId ?? item.id;
                              const nodeType = meta?.type;
                              const isSelected = props.selectedNodeIds.includes(nodeId);
                            const mergedChildCount = props.getMergedChildCount(nodeId);
                              const typeOpt =
                                nodeType &&
                                props.nodeTypeOptions.find((o) => o.value === nodeType);

                              const checkState = props.getGraphNodeCheckState(nodeId);

                            return (
                              <div
                                className={cn(
                                  // Permetti overflow orizzontale (scroll X)
                                  'group flex min-w-max items-center gap-2 rounded-md px-2 py-1.5',
                                  'hover:bg-accent/30',
                                  isSelected && 'bg-primary/10'
                                )}
                                style={{ paddingLeft: 8 + level * 16 }}
                                data-node-level={level}
                                ref={(el) => {
                                  const map = props.nodeRowElByIdRef.current;
                                  if (!el) {
                                    map.delete(nodeId);
                                    return;
                                  }
                                  map.set(nodeId, el);
                                }}
                              >
                                  <div data-node-left className='flex shrink-0 items-center gap-2'>
                                    {!isLeaf ? (
                                      <button
                                        type='button'
                                        className='inline-flex size-5 items-center justify-center rounded-sm hover:bg-accent/40'
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          toggleOpen();
                                        }}
                                        aria-label={isOpen ? 'Collapse' : 'Expand'}
                                      >
                                        <IconChevronRight
                                          className={cn(
                                            'h-4 w-4 text-muted-foreground transition-transform',
                                            isOpen && 'rotate-90'
                                          )}
                                        />
                                      </button>
                                    ) : (
                                      <span className='inline-flex size-5' />
                                    )}

                                    <Checkbox
                                      checked={checkState}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      props.toggleCheckedGraphNode(nodeId, {
                                        shiftKey: (e as any).shiftKey,
                                        metaKey: (e as any).metaKey,
                                        ctrlKey: (e as any).ctrlKey
                                      });
                                    }}
                                      aria-label='Select node'
                                    />

                                    <span className='inline-flex size-5 items-center justify-center'>
                                      <LogoOrIcon
                                        label={typeOpt?.label ?? item.name}
                                        logoUrl={typeOpt?.logoUrl ?? undefined}
                                        Icon={getPhosphorIconByKey(
                                          typeOpt?.iconKey ?? 'DotsThreeOutline'
                                        )}
                                        sizePx={16}
                                        className='h-4 w-4'
                                        iconClassName={cn(
                                          'h-4 w-4',
                                          nodeType &&
                                            (nodeTypeByType[nodeType]?.ui?.headerText ?? '')
                                        )}
                                      />
                                    </span>
                                  </div>

                                  <button
                                    data-node-label
                                    type='button'
                                    className={cn(
                                      // Non troncare: permetti overflow orizzontale e auto-scroll in X su selezione
                                      'shrink-0 whitespace-nowrap text-left text-sm',
                                      meta?.isHidden && 'opacity-60'
                                    )}
                                    onClick={() => props.handleSelectNodeFromTree(nodeId)}
                                    title={
                                      typeOpt?.label
                                        ? `${item.name} • ${typeOpt.label}`
                                        : item.name
                                    }
                                  >
                                    {item.name}
                                    {typeOpt?.label ? (
                                      <span className='text-muted-foreground ml-2 text-xs'>
                                        {typeOpt.label}
                                      </span>
                                    ) : null}
                                  </button>

                                {mergedChildCount > 1 ? (
                                  <span
                                    className='bg-primary/10 text-primary inline-flex h-5 items-center gap-1 rounded-full border border-border/40 px-1.5 text-[10px] font-semibold'
                                    title={`Merged ${mergedChildCount} nodes`}
                                  >
                                    <IconMerge className='h-3 w-3' />
                                    {mergedChildCount}
                                  </span>
                                ) : null}
                                </div>
                            );
                          }}
                        />
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </TabsContent>
              <TabsContent value='add' className='h-full'>
                <ScrollArea className='h-full'>
                  <div className='pb-3 pr-4'>
                    {isSearching && !hasAddSearchResults ? (
                      <div className='text-muted-foreground px-2 py-6 text-center text-xs'>
                        No results for this search
                      </div>
                    ) : null}
                    <Accordion
                      type='multiple'
                      className='w-full'
                      value={props.openedAddSidebarCategories ?? undefined}
                    >
                        {Object.entries(props.filteredGroupedNodeTypesForSidebar).map(
                          ([category, subcategories]) => {
                            const isSearchingAdd =
                              props.normalizeSidebarSearchQuery(props.sidebarSearchQuery)
                                .length > 0;
                            const root = subcategories['_root'] || [];
                            const subcats = Object.entries(subcategories).filter(
                              ([k]) => k !== '_root'
                            );
                            const categoryCount =
                              root.length +
                              subcats.reduce((acc, [, options]) => acc + options.length, 0);
                            const flatOptions = isSearchingAdd
                              ? [
                                  ...root,
                                  ...subcats.flatMap(([, options]) => options as any[])
                                ]
                              : [];

                            const renderNodeRow = (option: NodeTypeOptionLike) => {
                              const typeKey = option.value as NodeType;
                              const typeDef = nodeTypeByType[typeKey];

                              return (
                                <button
                                  key={option.value}
                                  type='button'
                                  disabled={props.isReadOnly}
                                  draggable={!props.isReadOnly}
                                  onDragStart={(e) => {
                                    if (props.isReadOnly) {
                                      e.preventDefault();
                                      return;
                                    }
                                    e.dataTransfer.setData(
                                      props.dndNodeTypeMime,
                                      String(option.value)
                                    );
                                    e.dataTransfer.effectAllowed = 'copy';
                                  }}
                                  onClick={() => {
                                    if (!props.isReadOnly) props.addNode(option.value as any);
                                  }}
                                  className={cn(
                                    // Fill the available grid column width (no empty gaps)
                                    'w-full rounded-xl border border-border/40 bg-background/60 p-1.5 text-left shadow-sm transition-all',
                                    'hover:bg-muted/40 hover:shadow-md active:translate-y-px',
                                    'dark:border-white/10 dark:bg-zinc-900/40'
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
                                      Icon={getPhosphorIconByKey(option.iconKey ?? 'DotsThreeOutline')}
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
                                  {isSearchingAdd ? (
                                    flatOptions.length > 0 ? (
                                      <div className='grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]'>
                                        {flatOptions.map(renderNodeRow)}
                                      </div>
                                    ) : null
                                  ) : (
                                    <>
                                      {root.length > 0 && (
                                        <div className='grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]'>
                                          {root.map(renderNodeRow)}
                                        </div>
                                      )}

                                      {subcats.length > 0 && (
                                        <div className='mt-3 space-y-4'>
                                          {subcats.map(([subcategory, options]) => (
                                            <div key={subcategory} className='space-y-2'>
                                              <div className='text-muted-foreground px-0.5 text-xs font-semibold'>
                                                {subcategory}
                                              </div>
                                              <div className='grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]'>
                                                {(options as any[]).map(renderNodeRow)}
                                              </div>
                                            </div>
                                          ))}
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
                  </div>
                </ScrollArea>
              </TabsContent>
            </div>
          </Tabs>

          <GraphSidepanelBottomBar>
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
                  onClick={() => props.onFitViewToSelection(props.selectedNodeIds)}
                  title='Fit view to selected'
                >
                  <Focus className='h-3 w-3' strokeWidth={1.75} />
                </Button>
                {props.selectedNodeCount > 1 ? (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className="size-7 [&_svg:not([class*='size-'])]:!size-4"
                    onClick={props.isReadOnly ? undefined : props.onMergeSelection}
                    disabled={props.isReadOnly || !props.canMergeSelection}
                    title='Merge'
                  >
                    <IconMerge className='h-4 w-4' />
                  </Button>
                ) : null}
                {props.selectedNodeCount === 1 ? (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className="size-7 [&_svg:not([class*='size-'])]:!size-4"
                    onClick={props.isReadOnly ? undefined : props.onUnmergeSelection}
                    disabled={props.isReadOnly || !props.canUnmergeSelection}
                    title='Unmerge'
                  >
                    <IconMerge className='h-4 w-4' />
                  </Button>
                ) : null}
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
                  onClick={props.isReadOnly ? undefined : props.onDeleteSelection}
                  disabled={props.isReadOnly}
                  title='Delete selected'
                >
                  <IconTrash className='h-4 w-4' />
                </Button>
              </>
            ) : (
              props.sidebarTab === 'entities' ? (
                <>
                  <div className='text-muted-foreground text-xs'>No node selected</div>
                  <div className='flex-1' />
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='h-7 px-2 text-[11px]'
                    onClick={props.onSelectAll}
                  >
                    Select all
                  </Button>
                </>
              ) : (
                <div className='flex-1' />
              )
            )}
          </GraphSidepanelBottomBar>
        </aside>
      </ResizablePanel>

      <ResizableHandle
        withHandle
        className={cn(
          'bg-border/60 dark:bg-white/10',
          // grip solo in hover sulla sidebar (stile shadcn)
          'group/resize-handle [&>div]:opacity-0 group-hover/graph-sidebar:[&>div]:opacity-100',
          props.isSidebarOpen ? '' : 'hidden'
        )}
      />
    </>
  );
}

export const GraphSidebar = React.memo(GraphSidebarComponent);
