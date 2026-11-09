'use client';
import { useGraphCanEdit } from '@/features/graph/contexts/graph-mutation-context';

import * as React from 'react';
import { createPortal } from 'react-dom';
import type { Edge, Node as FlowNode } from 'reactflow';
import {
  CaretRightIcon as IconChevronRight,
  CopyIcon as IconCopy,
  PaletteIcon as IconPalette,
  PlusIcon as IconPlus,
  TrashIcon as IconTrash
} from '@/components/icons';
import { useAdaptiveContextMenu } from '@/components/ui/adaptive-context-menu';
import { cn } from '@/lib/utils';
import { getPhosphorIconByKey } from '@/features/osint/phosphor-icon-by-key';
import { getGroupedPaletteItems, nodeTypeByType } from '@/features/osint/node-registry';
import { LogoOrIcon } from '../../components/logo-or-icon';

const groupedNodeTypes = getGroupedPaletteItems();

const edgeColorOptions = [
  { value: '#64748b', label: 'Slate' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#22c55e', label: 'Green' },
  { value: '#ef4444', label: 'Red' },
  { value: '#a855f7', label: 'Purple' },
  { value: '#f97316', label: 'Orange' }
];

export interface AnalysisSelectionContextMenuProps {
  position: { x: number; y: number };
  selectedNodes: FlowNode[];
  selectedEdges: Edge[];
  onClose: () => void;
  onChangeNodeType: (type: string) => void;
  onChangeEdgeColor: (color: string) => void;
  onDuplicateSelection: () => void;
  onCopySelection: () => void;
  onDeleteSelection: () => void;
}

export function AnalysisSelectionContextMenu(props: AnalysisSelectionContextMenuProps) {
  const canEdit = useGraphCanEdit();
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [showTypeSubmenu, setShowTypeSubmenu] = React.useState(false);
  const [activeCategory, setActiveCategory] = React.useState<string | null>(null);
  const submenuTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const categoryTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    const handlePointer = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) props.onClose();
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

  const hasNodes = props.selectedNodes.length > 0;
  const hasEdges = props.selectedEdges.length > 0;

  function openTypeSubmenu() {
    if (submenuTimeoutRef.current) clearTimeout(submenuTimeoutRef.current);
    setShowTypeSubmenu(true);
  }
  function closeTypeSubmenuWithDelay() {
    submenuTimeoutRef.current = setTimeout(() => {
      setShowTypeSubmenu(false);
      setActiveCategory(null);
    }, 150);
  }
  function cancelCloseTypeSubmenu() {
    if (submenuTimeoutRef.current) clearTimeout(submenuTimeoutRef.current);
  }

  function openCategory(category: string) {
    if (categoryTimeoutRef.current) clearTimeout(categoryTimeoutRef.current);
    setActiveCategory(category);
  }
  function closeCategoryWithDelay() {
    categoryTimeoutRef.current = setTimeout(() => {
      setActiveCategory(null);
    }, 150);
  }
  function cancelCloseCategory() {
    if (categoryTimeoutRef.current) clearTimeout(categoryTimeoutRef.current);
  }

  return createPortal(
    <div
      ref={menuRef}
      className='bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 w-56 rounded-md border p-1 shadow-md duration-100'
      style={menuStyle}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <button
        disabled={!canEdit()}
        className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        onClick={() => {
          if (!canEdit()) return;
          props.onDuplicateSelection();
          props.onClose();
        }}
      >
        <IconPlus className='h-4 w-4' />
        Duplicate
      </button>
      <button
        className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        onClick={() => {
          props.onCopySelection();
          props.onClose();
        }}
      >
        <IconCopy className='h-4 w-4' />
        Copy
      </button>

      {hasNodes ? (
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
            className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none'
          >
            <span className='flex items-center gap-2'>
              <span className='h-4 w-4 rounded-sm border' />
              Change type
            </span>
            <IconChevronRight className='h-4 w-4' />
          </button>
          {showTypeSubmenu ? (
            <div
              className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-56 rounded-md border p-1 shadow-md duration-100'
              onMouseEnter={() => {
                if (!canEdit()) return;
                cancelCloseTypeSubmenu();
              }}
              onMouseLeave={closeTypeSubmenuWithDelay}
            >
              {Object.entries(groupedNodeTypes).map(([category, subcategories]) => (
                <div
                  key={category}
                  className='relative'
                  onMouseEnter={() => {
                    if (!canEdit()) return;
                    openCategory(category);
                  }}
                  onMouseLeave={closeCategoryWithDelay}
                >
                  <button
                    disabled={!canEdit()}
                    className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'
                  >
                    <span className='flex-1 text-left'>{category}</span>
                    <IconChevronRight className='h-4 w-4' />
                  </button>
                  {activeCategory === category ? (
                    <div
                      className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-56 rounded-md border p-1 shadow-md duration-100'
                      onMouseEnter={() => {
                        if (!canEdit()) return;
                        cancelCloseCategory();
                      }}
                      onMouseLeave={closeCategoryWithDelay}
                    >
                      {(subcategories['_root'] ?? []).map((option) => (
                        <button
                          disabled={!canEdit()}
                          key={option.value}
                          className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full min-w-0 cursor-default items-center justify-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'
                          onClick={() => {
                            if (!canEdit()) return;
                            props.onChangeNodeType(option.value);
                            props.onClose();
                          }}
                        >
                          <span className={cn('relative rounded-lg p-1', nodeTypeByType[option.value]?.ui?.headerBg)}>
                            <LogoOrIcon
                              label={option.label}
                              logoUrl={option.logoUrl}
                              Icon={getPhosphorIconByKey(option.iconKey)}
                              sizePx={14}
                              className='h-3.5 w-3.5'
                              iconClassName={nodeTypeByType[option.value]?.ui?.headerText}
                            />
                          </span>
                          <span className='min-w-0 flex-1 truncate whitespace-nowrap text-left'>{option.label}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {hasEdges ? (
        <div className='relative'>
          <div className='my-1 h-px w-full bg-border/60' />
          {edgeColorOptions.map((opt) => (
            <button
              disabled={!canEdit()}
              key={opt.value}
              className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
              onClick={() => {
                if (!canEdit()) return;
                props.onChangeEdgeColor(opt.value);
                props.onClose();
              }}
            >
              <IconPalette className='h-4 w-4' />
              <span className='min-w-0 flex-1 truncate'>Edge color: {opt.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className='my-1 h-px w-full bg-border/60' />

      <button
        className='disabled:opacity-50 disabled:pointer-events-none hover:bg-destructive/10 hover:text-destructive relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'
        disabled={!canEdit()}
        onClick={() => {
          if (!canEdit()) return;
          props.onDeleteSelection();
          props.onClose();
        }}
      >
        <IconTrash className='h-4 w-4' />
        Delete
      </button>
    </div>,
    document.body
  );
}
