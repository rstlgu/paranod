'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useGraphCanEdit } from '@/features/graph/contexts/graph-mutation-context';
import { createPortal } from 'react-dom';
import {
  CornersOutIcon as IconFocusCentered,
  MagnifyingGlassPlusIcon as IconZoomIn,
  MagnifyingGlassMinusIcon as IconZoomOut,
  PlusIcon as IconPlus,
  CaretRightIcon as IconChevronRight,
  TrashIcon as IconTrash,
  RowsIcon as IconLayoutDistributeVertical,
  ColumnsIcon as IconLayoutDistributeHorizontal,
  GraphIcon as IconGraph,
  TreeStructureIcon as IconTreeStructure
} from '@/components/icons';

import { useAdaptiveContextMenu } from '@/components/ui/adaptive-context-menu';
import { cn } from '@/lib/utils';
import { getPhosphorIconByKey } from '@/features/osint/phosphor-icon-by-key';
import { getGroupedPaletteItems, nodeTypeByType } from '@/features/osint/node-registry';
import { LogoOrIcon } from './logo-or-icon';

const groupedNodeTypes = getGroupedPaletteItems();

interface PaneContextMenuProps {
  position: { x: number; y: number };
  flowPosition: { x: number; y: number };
  graphViewMode: 'free' | 'locked' | 'analysis' | 'map';
  lockedAxis: 'vertical' | 'horizontal';
  analysisLayoutEngine: 'force' | 'hierarchy';
  onClose: () => void;
  onAddNode: (type: string, position: { x: number; y: number }) => void;
  onFitView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onApplyLayout: (next: { direction: 'LR' | 'TB' }) => void;
  onSetLockedAxis: (next: 'vertical' | 'horizontal') => void;
  onApplyAnalysisLayout: (next: { engine: 'force' | 'hierarchy' }) => void;
  onRequestClearGraph: () => void;
}

export function PaneContextMenu(props: PaneContextMenuProps) {
  const canEdit = useGraphCanEdit();
  const menuRef = useRef<HTMLDivElement>(null);
  const [showAddSubmenu, setShowAddSubmenu] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeSocialPlatform, setActiveSocialPlatform] = useState<string | null>(
    null
  );
  const submenuTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const categoryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const socialTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const openAddSubmenu = useCallback(() => {
    if (submenuTimeoutRef.current) {
      clearTimeout(submenuTimeoutRef.current);
      submenuTimeoutRef.current = null;
    }
    setShowAddSubmenu(true);
  }, []);

  const closeAddSubmenuWithDelay = useCallback(() => {
    submenuTimeoutRef.current = setTimeout(() => {
      setShowAddSubmenu(false);
    }, 150);
  }, []);

  const cancelCloseAddSubmenu = useCallback(() => {
    if (submenuTimeoutRef.current) {
      clearTimeout(submenuTimeoutRef.current);
      submenuTimeoutRef.current = null;
    }
  }, []);

  const openCategorySubmenu = useCallback((category: string) => {
    if (categoryTimeoutRef.current) {
      clearTimeout(categoryTimeoutRef.current);
      categoryTimeoutRef.current = null;
    }
    setActiveCategory(category);
    setActiveSocialPlatform(null);
  }, []);

  const closeCategorySubmenuWithDelay = useCallback(() => {
    categoryTimeoutRef.current = setTimeout(() => {
      setActiveCategory(null);
      setActiveSocialPlatform(null);
    }, 150);
  }, []);

  const cancelCloseCategorySubmenu = useCallback(() => {
    if (categoryTimeoutRef.current) {
      clearTimeout(categoryTimeoutRef.current);
      categoryTimeoutRef.current = null;
    }
  }, []);

  const openSocialPlatformSubmenu = useCallback((platform: string) => {
    if (socialTimeoutRef.current) {
      clearTimeout(socialTimeoutRef.current);
      socialTimeoutRef.current = null;
    }
    setActiveSocialPlatform(platform);
  }, []);

  const closeSocialPlatformWithDelay = useCallback(() => {
    socialTimeoutRef.current = setTimeout(() => {
      setActiveSocialPlatform(null);
    }, 150);
  }, []);

  const cancelCloseSocialPlatform = useCallback(() => {
    if (socialTimeoutRef.current) {
      clearTimeout(socialTimeoutRef.current);
      socialTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
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

  return (
    <>
      {createPortal(
        <div
          ref={menuRef}
          className='bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 w-52 rounded-md border p-1 shadow-md duration-100'
          style={menuStyle}
          onContextMenu={(e) => e.stopPropagation()}
        >
          {/* Add Node - Submenu with Categories */}
          <div
            className='relative'
            onMouseEnter={() => {
              if (!canEdit()) return;
              openAddSubmenu();
            }}
            onMouseLeave={closeAddSubmenuWithDelay}
          >
            <button
              disabled={!canEdit()}
              className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'
            >
              <span className='flex flex-1 items-center gap-2 text-left'>
                <IconPlus className='h-4 w-4' />
                Add Node Here
              </span>
              <IconChevronRight className='h-4 w-4' />
            </button>

            {showAddSubmenu && (
              <div
                className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-48 rounded-md border p-1 shadow-md duration-100'
                onMouseEnter={() => {
                  if (!canEdit()) return;
                  cancelCloseAddSubmenu();
                }}
                onMouseLeave={closeAddSubmenuWithDelay}
              >
                {Object.entries(groupedNodeTypes).map(([category, subcategories]) => {
                  const hasSubcategories =
                    Object.keys(subcategories).filter((k) => k !== '_root').length > 0;
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
                        className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'
                      >
                        <span className='flex-1 text-left'>{category}</span>
                        <IconChevronRight className='h-4 w-4' />
                      </button>

                      {activeCategory === category && (
                        <div
                          className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-48 rounded-md border p-1 shadow-md duration-100'
                          onMouseEnter={() => {
                            if (!canEdit()) return;
                            cancelCloseCategorySubmenu();
                          }}
                          onMouseLeave={closeCategorySubmenuWithDelay}
                        >
                          {/* Root items */}
                          {hasRootItems &&
                            subcategories['_root'].map((option) => (
                              <button
                                disabled={!canEdit()}
                                key={option.value}
                                className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full min-w-0 cursor-default items-center justify-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'
                                onClick={() => {
                                  if (!canEdit()) return;
                                  props.onAddNode(option.value, props.flowPosition);
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
                                    Icon={getPhosphorIconByKey(option.iconKey)}
                                    sizePx={14}
                                    className='h-3.5 w-3.5'
                                    iconClassName={
                                      nodeTypeByType[option.value]?.ui?.headerText
                                    }
                                  />
                                </span>
                                <span className='min-w-0 flex-1 truncate whitespace-nowrap text-left'>
                                  {option.label}
                                </span>
                              </button>
                            ))}

                          {hasRootItems && hasSubcategories && (
                            <div className='bg-border -mx-1 my-1 h-px' />
                          )}

                          {/* Subcategories for Social platforms */}
                          {Object.entries(subcategories)
                            .filter(([key]) => key !== '_root')
                            .map(([subcategory, options]) => (
                              <div
                                key={subcategory}
                                className='relative'
                                onMouseEnter={() => {
                                  if (!canEdit()) return;
                                  openSocialPlatformSubmenu(subcategory);
                                }}
                                onMouseLeave={closeSocialPlatformWithDelay}
                              >
                                <button
                                  disabled={!canEdit()}
                                  className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'
                                >
                                  <span className='flex-1 text-left'>{subcategory}</span>
                                  <IconChevronRight className='h-4 w-4' />
                                </button>

                                {activeSocialPlatform === subcategory && (
                                  <div
                                    className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-44 rounded-md border p-1 shadow-md duration-100'
                                    onMouseEnter={() => {
                                      if (!canEdit()) return;
                                      cancelCloseSocialPlatform();
                                    }}
                                    onMouseLeave={closeSocialPlatformWithDelay}
                                  >
                                    {options.map((option) => (
                                      <button
                                        disabled={!canEdit()}
                                        key={option.value}
                                        className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full min-w-0 cursor-default items-center justify-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'
                                        onClick={() => {
                                          if (!canEdit()) return;
                                          props.onAddNode(option.value, props.flowPosition);
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
                                            Icon={getPhosphorIconByKey(option.iconKey)}
                                            sizePx={14}
                                            className='h-3.5 w-3.5'
                                            iconClassName={
                                              nodeTypeByType[option.value]?.ui?.headerText
                                            }
                                          />
                                        </span>
                                        <span className='min-w-0 flex-1 truncate whitespace-nowrap text-left'>
                                          {option.label}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className='bg-border -mx-1 my-1 h-px' />

          {/* View Controls */}
          <button
            className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
            onClick={() => {
              props.onFitView();
              props.onClose();
            }}
          >
            <IconFocusCentered className='h-4 w-4' />
            Fit View
          </button>

          <button
            className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
            onClick={() => {
              props.onZoomIn();
              props.onClose();
            }}
          >
            <IconZoomIn className='h-4 w-4' />
            Zoom In
          </button>

          <button
            className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
            onClick={() => {
              props.onZoomOut();
              props.onClose();
            }}
          >
            <IconZoomOut className='h-4 w-4' />
            Zoom Out
          </button>

          <div className='bg-border -mx-1 my-1 h-px' />

          {/* Layout controls (dynamic per mode) */}
          {props.graphViewMode === 'free' ? (
            <>
              <button
                disabled={!canEdit()}
                className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
                onClick={() => {
                  if (!canEdit()) return;
                  props.onApplyLayout({ direction: 'TB' });
                  props.onClose();
                }}
              >
                <IconLayoutDistributeVertical className='h-4 w-4' />
                Top → Bottom
              </button>
              <button
                disabled={!canEdit()}
                className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
                onClick={() => {
                  if (!canEdit()) return;
                  props.onApplyLayout({ direction: 'LR' });
                  props.onClose();
                }}
              >
                <IconLayoutDistributeHorizontal className='h-4 w-4' />
                Left → Right
              </button>
              <div className='bg-border -mx-1 my-1 h-px' />
            </>
          ) : null}

          {props.graphViewMode === 'locked' ? (
            <>
              <div className='text-muted-foreground px-2 py-1 text-[10px] font-semibold tracking-wide uppercase'>
                Lanes
              </div>
              <button
                disabled={!canEdit()}
                className={cn(
                  'disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none',
                  props.lockedAxis === 'vertical' && 'bg-accent/60'
                )}
                onClick={() => {
                  if (!canEdit()) return;
                  props.onSetLockedAxis('vertical');
                  props.onClose();
                }}
              >
                <IconLayoutDistributeHorizontal className='h-4 w-4' />
                Vertical lanes
              </button>
              <button
                disabled={!canEdit()}
                className={cn(
                  'disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none',
                  props.lockedAxis === 'horizontal' && 'bg-accent/60'
                )}
                onClick={() => {
                  if (!canEdit()) return;
                  props.onSetLockedAxis('horizontal');
                  props.onClose();
                }}
              >
                <IconLayoutDistributeVertical className='h-4 w-4' />
                Horizontal lanes
              </button>
              <div className='bg-border -mx-1 my-1 h-px' />
            </>
          ) : null}

          {props.graphViewMode === 'analysis' ? (
            <>
              <div className='text-muted-foreground px-2 py-1 text-[10px] font-semibold tracking-wide uppercase'>
                Layout
              </div>
              <button
                disabled={!canEdit()}
                className={cn(
                  'disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none',
                  props.analysisLayoutEngine === 'force' && 'bg-accent/60'
                )}
                onClick={() => {
                  if (!canEdit()) return;
                  props.onApplyAnalysisLayout({ engine: 'force' });
                  props.onClose();
                }}
              >
                <IconGraph className='h-4 w-4' />
                Force
              </button>
              <button
                disabled={!canEdit()}
                className={cn(
                  'disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none',
                  props.analysisLayoutEngine === 'hierarchy' && 'bg-accent/60'
                )}
                onClick={() => {
                  if (!canEdit()) return;
                  props.onApplyAnalysisLayout({ engine: 'hierarchy' });
                  props.onClose();
                }}
              >
                <IconTreeStructure className='h-4 w-4 rotate-90' />
                Hierarchy
              </button>
              <div className='bg-border -mx-1 my-1 h-px' />
            </>
          ) : null}

          {/* Clear Graph */}
          <button
            disabled={!canEdit()}
            className='disabled:opacity-50 disabled:pointer-events-none text-destructive hover:bg-destructive/10 relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
            onClick={() => {
              if (!canEdit()) return;
              props.onRequestClearGraph();
              props.onClose();
            }}
          >
            <IconTrash className='h-4 w-4' />
            Clear Graph
          </button>
        </div>,
        document.body
      )}

      {/* Confirm dialog is managed by the parent (GraphEditor) */}
    </>
  );
}
