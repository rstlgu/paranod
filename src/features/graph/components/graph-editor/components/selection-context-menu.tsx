'use client';
import { useGraphCanEdit } from '@/features/graph/contexts/graph-mutation-context';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Edge, Node as FlowNode } from 'reactflow';
import {
  ArrowCounterClockwiseIcon as IconArrowBackUp,
  ArrowsLeftRightIcon as IconArrowLeftRight,
  ArrowRightIcon as IconArrowRight,
  ArrowsHorizontalIcon as IconArrowsHorizontal,
  ArrowsVerticalIcon as IconArrowsVertical,
  StackIcon as IconStack,
  BezierCurveIcon as IconVectorSpline,
  CaretRightIcon as IconChevronRight,
  CopyIcon as IconCopy,
  EyeIcon as IconEye,
  EyeSlashIcon as IconEyeOff,
  FolderOpenIcon as IconFolderOpen,
  LayoutIcon as IconLayoutGrid,
  LineSegmentIcon as IconLine,
  ListBulletsIcon as IconListDetails,
  ListDashesIcon as IconLineDashed,
  PaletteIcon as IconPalette,
  PenIcon as IconBorderStyle,
  PlusIcon as IconPlus,
  RowsIcon as IconLayoutDistributeVertical,
  ColumnsIcon as IconLayoutDistributeHorizontal,
  TagIcon as IconTag,
  ArrowsClockwiseIcon as IconRefresh,
  TrashIcon as IconTrash,
  ArrowsOutLineVerticalIcon as IconLineHeight,
  ArrowElbowRightUpIcon as IconArrowWaveRightUp
} from '@/components/icons';

import { useAdaptiveContextMenu } from '@/components/ui/adaptive-context-menu';
import { cn } from '@/lib/utils';
import { getPhosphorIconByKey } from '@/features/osint/phosphor-icon-by-key';
import { getGroupedPaletteItems, nodeTypeByType } from '@/features/osint/node-registry';
import { LogoOrIcon } from './logo-or-icon';
import type { LayoutOptions } from '@/features/graph/utils/auto-layout';

const groupedNodeTypes = getGroupedPaletteItems();

// Configurazione Tipi Edge
const edgeTypeOptions = [
  { value: 'default', label: 'Bezier (Curved)', icon: IconVectorSpline },
  { value: 'straight', label: 'Straight', icon: IconLine },
  { value: 'smoothstep', label: 'Smooth Step', icon: IconArrowWaveRightUp }
] as const;

// Edge color options (uniformi con osint-edge)
const edgeColorOptions = [
  { value: '#64748b', label: 'Slate' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#22c55e', label: 'Green' },
  { value: '#ef4444', label: 'Red' },
  { value: '#a855f7', label: 'Purple' },
  { value: '#f97316', label: 'Orange' },
  { value: '#06b6d4', label: 'Cyan' },
  { value: '#ec4899', label: 'Pink' }
];

const edgeWidthOptions = [
  { value: 2, label: 'Thin' },
  { value: 3, label: 'Medium' },
  { value: 4.5, label: 'Thick' }
];

// Context Menu per la Selezione Multipla
interface SelectionContextMenuProps {
  position: { x: number; y: number };
  selectedNodes: FlowNode[];
  selectedEdges: Edge[];
  graphViewMode: 'free' | 'locked' | 'analysis' | 'map';
  onClose: () => void;
  recentCases: Array<{ id: string; name: string }>;
  onRefreshRecentCases: () => void;
  onQuickAddToCase: (caseId: string, nodes: FlowNode[]) => void;
  onOpenAllCases: (nodes: FlowNode[]) => void;
  onOpenNewCase: (nodes: FlowNode[]) => void;
  onChangeNodeType: (type: string) => void;
  onLayoutSelection: (next: Partial<LayoutOptions>) => void;
  onAlignSelection: (alignment: 'horizontal' | 'vertical') => void;
  onDeleteSelection: () => void;
  onDuplicateSelection: () => void;
  onCopySelection: () => void;
  onChangeEdgeColor: (color: string) => void;
  onChangeEdgeWidth: (width: number) => void;
  onChangeEdgeType: (type: 'default' | 'straight' | 'smoothstep') => void;
  onToggleEdgeLabelVisible: () => void;
  onToggleEdgeDashed: () => void;
  onToggleEdgeHideDirection: () => void;
  onToggleEdgeBidirectional: () => void;
  onInvertEdgeDirection: () => void;
  canMergeSelection?: boolean;
  canUnmergeSelection?: boolean;
  onMergeSelection?: () => void;
  onUnmergeSelection?: () => void;
}

export function SelectionContextMenu({
  position,
  selectedNodes,
  selectedEdges,
  graphViewMode,
  onClose,
  recentCases,
  onRefreshRecentCases,
  onQuickAddToCase,
  onOpenAllCases,
  onOpenNewCase,
  onChangeNodeType,
  onLayoutSelection,
  onAlignSelection,
  onDeleteSelection,
  onDuplicateSelection,
  onCopySelection,
  onChangeEdgeColor,
  onChangeEdgeWidth,
  onChangeEdgeType,
  onToggleEdgeLabelVisible,
  onToggleEdgeDashed,
  onToggleEdgeHideDirection,
  onToggleEdgeBidirectional,
  onInvertEdgeDirection,
  canMergeSelection,
  canUnmergeSelection,
  onMergeSelection,
  onUnmergeSelection
}: SelectionContextMenuProps) {
  const canEdit = useGraphCanEdit();
  const menuRef = useRef<HTMLDivElement>(null);
  const [showTypeSubmenu, setShowTypeSubmenu] = useState(false);
  const [showAddToCaseSubmenu, setShowAddToCaseSubmenu] = useState(false);
  const [activeTypeCategory, setActiveTypeCategory] = useState<string | null>(
    null
  );
  const [activeTypeSocialPlatform, setActiveTypeSocialPlatform] = useState<
    string | null
  >(null);
  const [showEdgeColorSubmenu, setShowEdgeColorSubmenu] = useState(false);
  const [showEdgeWidthSubmenu, setShowEdgeWidthSubmenu] = useState(false);
  const [showEdgeTypeSubmenu, setShowEdgeTypeSubmenu] = useState(false);
  const [showEdgeDirectionSubmenu, setShowEdgeDirectionSubmenu] =
    useState(false);

  // Align action intentionally hidden from context menus
  void onAlignSelection;

  // Timeout refs per delay nella chiusura dei sottomenu
  const submenuTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const typeCategoryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const typeSocialTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Helper per aprire un sottomenu con delay sulla chiusura
  const openSubmenu = useCallback(
    (setter: React.Dispatch<React.SetStateAction<boolean>>) => {
      if (submenuTimeoutRef.current) {
        clearTimeout(submenuTimeoutRef.current);
        submenuTimeoutRef.current = null;
      }
      // Chiudi tutti gli altri sottomenu
      setShowTypeSubmenu(false);
      setShowAddToCaseSubmenu(false);
      setShowEdgeColorSubmenu(false);
      setShowEdgeWidthSubmenu(false);
      setShowEdgeTypeSubmenu(false);
      setShowEdgeDirectionSubmenu(false);
      // Apri quello richiesto
      setter(true);
    },
    []
  );

  const closeSubmenuWithDelay = useCallback(
    (setter: React.Dispatch<React.SetStateAction<boolean>>) => {
      submenuTimeoutRef.current = setTimeout(() => {
        setter(false);
      }, 150); // 150ms di delay per permettere il movimento verso il sottomenu
    },
    []
  );

  const cancelCloseSubmenu = useCallback(() => {
    if (submenuTimeoutRef.current) {
      clearTimeout(submenuTimeoutRef.current);
      submenuTimeoutRef.current = null;
    }
  }, []);

  const openTypeCategorySubmenu = useCallback((category: string) => {
    if (typeCategoryTimeoutRef.current) {
      clearTimeout(typeCategoryTimeoutRef.current);
      typeCategoryTimeoutRef.current = null;
    }
    setActiveTypeCategory(category);
    setActiveTypeSocialPlatform(null);
  }, []);

  const closeTypeCategorySubmenuWithDelay = useCallback(() => {
    typeCategoryTimeoutRef.current = setTimeout(() => {
      setActiveTypeCategory(null);
      setActiveTypeSocialPlatform(null);
    }, 150);
  }, []);

  const cancelCloseTypeCategorySubmenu = useCallback(() => {
    if (typeCategoryTimeoutRef.current) {
      clearTimeout(typeCategoryTimeoutRef.current);
      typeCategoryTimeoutRef.current = null;
    }
  }, []);

  const openTypeSocialPlatformSubmenu = useCallback((platform: string) => {
    if (typeSocialTimeoutRef.current) {
      clearTimeout(typeSocialTimeoutRef.current);
      typeSocialTimeoutRef.current = null;
    }
    setActiveTypeSocialPlatform(platform);
  }, []);

  const closeTypeSocialPlatformWithDelay = useCallback(() => {
    typeSocialTimeoutRef.current = setTimeout(() => {
      setActiveTypeSocialPlatform(null);
    }, 150);
  }, []);

  const cancelCloseTypeSocialPlatform = useCallback(() => {
    if (typeSocialTimeoutRef.current) {
      clearTimeout(typeSocialTimeoutRef.current);
      typeSocialTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handlePointer = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handlePointer, true);
      document.addEventListener('contextmenu', handlePointer, true);
      document.addEventListener('keydown', handleKeyDown);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handlePointer, true);
      document.removeEventListener('contextmenu', handlePointer, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: position.x,
    top: position.y,
    zIndex: 99999
  };
  useAdaptiveContextMenu(menuRef, position);

  const hasNodes = selectedNodes.length > 0;
  const hasEdges = selectedEdges.length > 0;
  const canAddNodesToCase = selectedNodes.length > 0;
  const canShowMergeAction = selectedNodes.length > 1;
  const canShowUnmergeAction = selectedNodes.length === 1 && Boolean(canUnmergeSelection);

  // Controlla stato degli edge selezionati per toggle dinamici
  const allEdgesLabelHidden = selectedEdges.every(
    (e) => e.data?.labelVisible === false
  );
  const allEdgesDashed = selectedEdges.every((e) => e.data?.dashed === true);

  return createPortal(
    <div
      ref={menuRef}
      className='bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 w-56 rounded-md border p-1 shadow-md duration-100'
      style={menuStyle}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {/* Header con conteggio selezione */}
      <div className='text-muted-foreground mb-1 border-b px-2 py-1.5 text-xs font-semibold'>
        {hasNodes &&
          `${selectedNodes.length} node${selectedNodes.length > 1 ? 's' : ''}`}
        {hasNodes && hasEdges && ' • '}
        {hasEdges &&
          `${selectedEdges.length} edge${selectedEdges.length > 1 ? 's' : ''}`}
      </div>

      <button
        className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        onClick={() => {
          onCopySelection();
          onClose();
        }}
      >
        <IconCopy className='h-4 w-4' />
        Copy
      </button>

      {/* Node actions */}
      {hasNodes && (
        <>
          {/* Section Title - Nodes */}
          <div className='text-muted-foreground px-2 py-1 text-[10px] font-semibold tracking-wide uppercase'>
            Node Actions
          </div>

          {/* Add to Case (Phase 1) */}
          {canAddNodesToCase && (
            <div
              className='relative'
              onMouseEnter={() => {
                if (!canEdit()) return;
                openSubmenu(setShowAddToCaseSubmenu);
                onRefreshRecentCases();
              }}
              onMouseLeave={() => closeSubmenuWithDelay(setShowAddToCaseSubmenu)}
            >
              <button
                disabled={!canEdit()}
                className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'
              >
                <span className='flex flex-1 items-center gap-2 text-left'>
                  <IconTag className='h-4 w-4' />
                  Add to Case
                </span>
                <IconChevronRight className='h-4 w-4' />
              </button>

              {showAddToCaseSubmenu && (
                <div
                  className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-64 rounded-md border p-1 shadow-md duration-100'
                  onMouseEnter={() => {
                    if (!canEdit()) return;
                    cancelCloseSubmenu();
                  }}
                  onMouseLeave={() => closeSubmenuWithDelay(setShowAddToCaseSubmenu)}
                >
                  {recentCases.map((c) => (
                    <button
                      disabled={!canEdit()}
                      key={c.id}
                      className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full min-w-0 cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'
                      onClick={() => {
                        if (!canEdit()) return;
                        onQuickAddToCase(c.id, selectedNodes);
                        onClose();
                      }}
                    >
                      <IconFolderOpen className='h-4 w-4' />
                      <span className='min-w-0 flex-1 truncate'>{c.name}</span>
                    </button>
                  ))}
                  <div className='bg-border -mx-1 my-1 h-px' />
                  <button
                    disabled={!canEdit()}
                    className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'
                    onClick={() => {
                      if (!canEdit()) return;
                      onOpenAllCases(selectedNodes);
                      onClose();
                    }}
                  >
                    <IconListDetails className='h-4 w-4' />
                    All Cases…
                  </button>
                  <button
                    disabled={!canEdit()}
                    className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'
                    onClick={() => {
                      if (!canEdit()) return;
                      onOpenNewCase(selectedNodes);
                      onClose();
                    }}
                  >
                    <IconPlus className='h-4 w-4' />
                    New Case…
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Change Type */}
          <div
            className='relative'
            onMouseEnter={() => {
              if (!canEdit()) return;
              openSubmenu(setShowTypeSubmenu);
            }}
            onMouseLeave={() => closeSubmenuWithDelay(setShowTypeSubmenu)}
          >
            <button
              disabled={!canEdit()}
              className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'
            >
              <span className='flex flex-1 items-center gap-2 text-left'>
                <span className='h-4 w-4 rounded-sm border' />
                Change Type
              </span>
              <IconChevronRight className='h-4 w-4' />
            </button>

            {showTypeSubmenu && (
              <div
                className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-48 rounded-md border p-1 shadow-md duration-100'
                onMouseEnter={() => {
                  if (!canEdit()) return;
                  cancelCloseSubmenu();
                }}
                onMouseLeave={() => closeSubmenuWithDelay(setShowTypeSubmenu)}
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
                          openTypeCategorySubmenu(category);
                        }}
                        onMouseLeave={closeTypeCategorySubmenuWithDelay}
                      >
                        <button
                          disabled={!canEdit()}
                          className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'
                        >
                          <span className='flex-1 text-left'>{category}</span>
                          <IconChevronRight className='h-4 w-4' />
                        </button>

                        {activeTypeCategory === category && (
                          <div
                            className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-48 rounded-md border p-1 shadow-md duration-100'
                            onMouseEnter={() => {
                              if (!canEdit()) return;
                              cancelCloseTypeCategorySubmenu();
                            }}
                            onMouseLeave={closeTypeCategorySubmenuWithDelay}
                          >
                            {/* Root items */}
                            {hasRootItems &&
                              subcategories['_root'].map((option) => (
                                <button
                                  disabled={!canEdit()}
                                  key={option.value}
                                  className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full min-w-0 cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
                                  onClick={() => {
                                    if (!canEdit()) return;
                                    onChangeNodeType(option.value);
                                    onClose();
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
                                  <span className='min-w-0 flex-1 truncate whitespace-nowrap'>
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
                                    openTypeSocialPlatformSubmenu(subcategory);
                                  }}
                                  onMouseLeave={closeTypeSocialPlatformWithDelay}
                                >
                                  <button
                                    disabled={!canEdit()}
                                    className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'
                                  >
                                    <span className='flex-1 text-left'>
                                      {subcategory}
                                    </span>
                                    <IconChevronRight className='h-4 w-4' />
                                  </button>

                                  {activeTypeSocialPlatform === subcategory && (
                                    <div
                                      className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-44 rounded-md border p-1 shadow-md duration-100'
                                      onMouseEnter={() => {
                                        if (!canEdit()) return;
                                        cancelCloseTypeSocialPlatform();
                                      }}
                                      onMouseLeave={closeTypeSocialPlatformWithDelay}
                                    >
                                      {options.map((option) => (
                                        <button
                                          disabled={!canEdit()}
                                          key={option.value}
                                          className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full min-w-0 cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
                                          onClick={() => {
                                            if (!canEdit()) return;
                                            onChangeNodeType(option.value);
                                            onClose();
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
                                                nodeTypeByType[option.value]?.ui
                                                  ?.headerText
                                              }
                                            />
                                          </span>
                                          <span className='min-w-0 flex-1 truncate whitespace-nowrap'>
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
                  }
                )}
              </div>
            )}
          </div>

          {graphViewMode === 'free' ? (
            <>
              <button
                disabled={!canEdit()}
                className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
                onClick={() => {
                  if (!canEdit()) return;
                  onLayoutSelection({ direction: 'TB' });
                  onClose();
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
                  onLayoutSelection({ direction: 'LR' });
                  onClose();
                }}
              >
                <IconLayoutDistributeHorizontal className='h-4 w-4' />
                Left → Right
              </button>
            </>
          ) : null}

          {/* Duplicate */}
          <button
            disabled={!canEdit()}
            className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
            onClick={() => {
              if (!canEdit()) return;
              onDuplicateSelection();
              onClose();
            }}
          >
            <IconCopy className='h-4 w-4' />
            Duplicate
          </button>

          {/* Merge / Unmerge */}
          {canShowMergeAction ? (
            <button
              className={cn(
                'disabled:opacity-50 disabled:pointer-events-none relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none',
                canMergeSelection
                  ? 'hover:bg-accent hover:text-accent-foreground'
                  : 'opacity-50'
              )}
              disabled={!canEdit() || !canMergeSelection || !onMergeSelection}
              onClick={() => {
                if (!canEdit()) return;
                onMergeSelection?.();
                onClose();
              }}
            >
              <IconStack className='h-4 w-4' />
              Merge (M)
            </button>
          ) : null}

          {canShowUnmergeAction ? (
            <button
              className={cn(
                'disabled:opacity-50 disabled:pointer-events-none relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none',
                canUnmergeSelection
                  ? 'hover:bg-accent hover:text-accent-foreground'
                  : 'opacity-50'
              )}
              disabled={!canEdit() || !canUnmergeSelection || !onUnmergeSelection}
              onClick={() => {
                if (!canEdit()) return;
                onUnmergeSelection?.();
                onClose();
              }}
            >
              <IconStack className='h-4 w-4' />
              Unmerge
            </button>
          ) : null}
        </>
      )}

      {/* Separator tra nodes e edges */}
      {hasNodes && hasEdges && <div className='bg-border -mx-1 my-1 h-px' />}

      {/* Edge actions */}
      {hasEdges && (
        <>
          {/* Section Title - Edges */}
          <div className='text-muted-foreground px-2 py-1 text-[10px] font-semibold tracking-wide uppercase'>
            Edge Actions
          </div>

          {/* Edge Color */}
          <div
            className='relative'
            onMouseEnter={() => {
              if (!canEdit()) return;
              openSubmenu(setShowEdgeColorSubmenu);
            }}
            onMouseLeave={() => closeSubmenuWithDelay(setShowEdgeColorSubmenu)}
          >
            <button
              disabled={!canEdit()}
              className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none'
            >
              <span className='flex items-center gap-2'>
                <IconPalette className='h-4 w-4' />
                Color
              </span>
              <IconChevronRight className='h-4 w-4' />
            </button>

            {showEdgeColorSubmenu && (
              <div
                className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-36 rounded-md border p-1 shadow-md duration-100'
                onMouseEnter={() => {
                  if (!canEdit()) return;
                  cancelCloseSubmenu();
                }}
                onMouseLeave={() => closeSubmenuWithDelay(setShowEdgeColorSubmenu)}
              >
                {edgeColorOptions.map((option) => (
                  <button
                    disabled={!canEdit()}
                    key={option.value}
                    className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
                    onClick={() => {
                      if (!canEdit()) return;
                      onChangeEdgeColor(option.value);
                      onClose();
                    }}
                  >
                    <span
                      className='h-4 w-4 rounded-full border'
                      style={{ backgroundColor: option.value }}
                    />
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Edge Width */}
          <div
            className='relative'
            onMouseEnter={() => {
              if (!canEdit()) return;
              openSubmenu(setShowEdgeWidthSubmenu);
            }}
            onMouseLeave={() => closeSubmenuWithDelay(setShowEdgeWidthSubmenu)}
          >
            <button
              disabled={!canEdit()}
              className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none'
            >
              <span className='flex items-center gap-2'>
                <IconLineHeight className='h-4 w-4' />
                Thickness
              </span>
              <IconChevronRight className='h-4 w-4' />
            </button>

            {showEdgeWidthSubmenu && (
              <div
                className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-36 rounded-md border p-1 shadow-md duration-100'
                onMouseEnter={() => {
                  if (!canEdit()) return;
                  cancelCloseSubmenu();
                }}
                onMouseLeave={() => closeSubmenuWithDelay(setShowEdgeWidthSubmenu)}
              >
                {edgeWidthOptions.map((option) => (
                  <button
                    disabled={!canEdit()}
                    key={option.value}
                    className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
                    onClick={() => {
                      if (!canEdit()) return;
                      onChangeEdgeWidth(option.value);
                      onClose();
                    }}
                  >
                    <span
                      className='w-8 rounded'
                      style={{
                        height: option.value * 1.5,
                        backgroundColor: '#64748b'
                      }}
                    />
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Edge Type */}
          <div
            className='relative'
            onMouseEnter={() => {
              if (!canEdit()) return;
              openSubmenu(setShowEdgeTypeSubmenu);
            }}
            onMouseLeave={() => closeSubmenuWithDelay(setShowEdgeTypeSubmenu)}
          >
            <button
              disabled={!canEdit()}
              className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none'
            >
              <span className='flex items-center gap-2'>
                <IconVectorSpline className='h-4 w-4' />
                Line Type
              </span>
              <IconChevronRight className='h-4 w-4' />
            </button>

            {showEdgeTypeSubmenu && (
              <div
                className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-44 rounded-md border p-1 shadow-md duration-100'
                onMouseEnter={() => {
                  if (!canEdit()) return;
                  cancelCloseSubmenu();
                }}
                onMouseLeave={() => closeSubmenuWithDelay(setShowEdgeTypeSubmenu)}
              >
                {edgeTypeOptions.map((option) => (
                  <button
                    disabled={!canEdit()}
                    key={option.value}
                    className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
                    onClick={() => {
                      if (!canEdit()) return;
                      onChangeEdgeType(option.value as 'default' | 'straight' | 'smoothstep');
                      onClose();
                    }}
                  >
                    <option.icon className='h-4 w-4' />
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Toggle Label Visibility */}
          <button
            disabled={!canEdit()}
            className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
            onClick={() => {
              if (!canEdit()) return;
              onToggleEdgeLabelVisible();
              onClose();
            }}
          >
            {allEdgesLabelHidden ? (
              <>
                <IconEye className='h-4 w-4' />
                Show Label
              </>
            ) : (
              <>
                <IconEyeOff className='h-4 w-4' />
                Hide Label
              </>
            )}
          </button>

          {/* Toggle Dashed/Solid Line */}
          <button
            disabled={!canEdit()}
            className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
            onClick={() => {
              if (!canEdit()) return;
              onToggleEdgeDashed();
              onClose();
            }}
          >
            {allEdgesDashed ? (
              <>
                <IconBorderStyle className='h-4 w-4' />
                Solid Line
              </>
            ) : (
              <>
                <IconLineDashed className='h-4 w-4' />
                Dashed Line
              </>
            )}
          </button>

          {/* Direction Submenu */}
          <div
            className='relative'
            onMouseEnter={() => {
              if (!canEdit()) return;
              openSubmenu(setShowEdgeDirectionSubmenu);
            }}
            onMouseLeave={() => closeSubmenuWithDelay(setShowEdgeDirectionSubmenu)}
          >
            <button
              disabled={!canEdit()}
              className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none'
            >
              <span className='flex items-center gap-2'>
                <IconArrowRight className='h-4 w-4' />
                Direction
              </span>
              <IconChevronRight className='h-4 w-4' />
            </button>

            {showEdgeDirectionSubmenu && (
              <div
                className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-44 rounded-md border p-1 shadow-md duration-100'
                onMouseEnter={() => {
                  if (!canEdit()) return;
                  cancelCloseSubmenu();
                }}
                onMouseLeave={() => closeSubmenuWithDelay(setShowEdgeDirectionSubmenu)}
              >
                <button
                  disabled={!canEdit()}
                  className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
                  onClick={() => {
                    if (!canEdit()) return;
                    onToggleEdgeHideDirection();
                    onClose();
                  }}
                >
                  <IconEyeOff className='h-4 w-4' />
                  Hide Arrow
                </button>
                <button
                  disabled={!canEdit()}
                  className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
                  onClick={() => {
                    if (!canEdit()) return;
                    onToggleEdgeBidirectional();
                    onClose();
                  }}
                >
                  <IconArrowLeftRight className='h-4 w-4' />
                  Bidirectional
                </button>
                <button
                  disabled={!canEdit()}
                  className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
                  onClick={() => {
                    if (!canEdit()) return;
                    onInvertEdgeDirection();
                    onClose();
                  }}
                >
                  <IconArrowBackUp className='h-4 w-4' />
                  Invert Direction
                </button>
              </div>
            )}
          </div>
        </>
      )}

      <div className='bg-border -mx-1 my-1 h-px' />

      {/* Delete Selection */}
      <button
        className='disabled:opacity-50 disabled:pointer-events-none hover:bg-destructive hover:text-destructive-foreground text-destructive relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        disabled={!canEdit()}
        onClick={() => {
          if (!canEdit()) return;
          onDeleteSelection();
          onClose();
        }}
      >
        <IconTrash className='h-4 w-4' />
        Delete Selection
      </button>
    </div>,
    document.body
  );
}
