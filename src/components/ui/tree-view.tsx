'use client';

import * as React from 'react';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface TreeDataItem {
  id: string;
  name: string;
  icon?: React.ComponentType<{ className?: string }>;
  selectedIcon?: React.ComponentType<{ className?: string }>;
  openIcon?: React.ComponentType<{ className?: string }>;
  children?: TreeDataItem[];
  actions?: React.ReactNode;
  onClick?: () => void;
  draggable?: boolean;
  droppable?: boolean;
  disabled?: boolean;
  className?: string;
  data?: unknown;
}

export interface TreeRenderItemParams {
  item: TreeDataItem;
  level: number;
  isLeaf: boolean;
  isOpen: boolean;
  isSelected: boolean;
  toggleOpen: () => void;
  onSelect: () => void;
}

export interface TreeProps extends React.HTMLAttributes<HTMLDivElement> {
  data: TreeDataItem[] | TreeDataItem;
  initialSelectedItemId?: string;
  onSelectChange?: (item: TreeDataItem | undefined) => void;
  renderItem?: (params: TreeRenderItemParams) => React.ReactNode;
  expandAll?: boolean;
  defaultNodeIcon?: React.ComponentType<{ className?: string }>;
  defaultLeafIcon?: React.ComponentType<{ className?: string }>;
}

function normalizeTreeData(data: TreeProps['data']): TreeDataItem[] {
  if (Array.isArray(data)) return data;
  return [data];
}

function collectExpandableIds(items: TreeDataItem[]): string[] {
  const ids: string[] = [];
  const walk = (list: TreeDataItem[]) => {
    for (const item of list) {
      if (item.children?.length) {
        ids.push(item.id);
        walk(item.children);
      }
    }
  };
  walk(items);
  return ids;
}

export function TreeView({
  data,
  initialSelectedItemId,
  onSelectChange,
  renderItem,
  expandAll,
  defaultNodeIcon,
  defaultLeafIcon,
  className,
  ...props
}: TreeProps) {
  const items = React.useMemo(() => normalizeTreeData(data), [data]);

  const [openIds, setOpenIds] = React.useState<Set<string>>(() => {
    if (!expandAll) return new Set();
    return new Set(collectExpandableIds(items));
  });

  React.useEffect(() => {
    if (!expandAll) return;
    setOpenIds(new Set(collectExpandableIds(items)));
  }, [expandAll, items]);

  const [selectedId, setSelectedId] = React.useState<string | undefined>(
    initialSelectedItemId
  );

  const handleSelect = React.useCallback(
    (item: TreeDataItem) => {
      setSelectedId(item.id);
      onSelectChange?.(item);
      item.onClick?.();
    },
    [onSelectChange]
  );

  const toggleOpen = React.useCallback((id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const renderNode = React.useCallback(
    (item: TreeDataItem, level: number) => {
      const hasChildren = Boolean(item.children?.length);
      const isOpen = hasChildren && openIds.has(item.id);
      const isSelected = selectedId === item.id;

      const nodeParams: TreeRenderItemParams = {
        item,
        level,
        isLeaf: !hasChildren,
        isOpen,
        isSelected,
        toggleOpen: () => toggleOpen(item.id),
        onSelect: () => handleSelect(item)
      };

      return (
        <div key={item.id} className={cn('min-w-0', item.className)}>
          {renderItem ? (
            renderItem(nodeParams)
          ) : (
            <button
              type='button'
              disabled={item.disabled}
              draggable={item.draggable}
              className={cn(
                'flex w-full min-w-0 items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm outline-none',
                'hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/30',
                isSelected && 'bg-accent/60',
                item.disabled && 'cursor-not-allowed opacity-60'
              )}
              onClick={nodeParams.onSelect}
              style={{ paddingLeft: 8 + level * 16 }}
            >
              {hasChildren ? (
                <span
                  className={cn(
                    'inline-flex size-5 items-center justify-center rounded-sm',
                    'hover:bg-accent/50'
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    nodeParams.toggleOpen();
                  }}
                >
                  <ChevronRight
                    className={cn(
                      'h-4 w-4 text-muted-foreground transition-transform',
                      isOpen && 'rotate-90'
                    )}
                  />
                </span>
              ) : (
                <span className='inline-flex size-5' />
              )}

              <span className='inline-flex size-5 items-center justify-center text-muted-foreground'>
                {(() => {
                  const Icon =
                    (isSelected && item.selectedIcon) ||
                    (isOpen && item.openIcon) ||
                    item.icon ||
                    (hasChildren ? defaultNodeIcon : defaultLeafIcon);
                  if (!Icon) return null;
                  return <Icon className='h-4 w-4' />;
                })()}
              </span>

              <span className='min-w-0 flex-1 truncate'>{item.name}</span>

              {item.actions ? (
                <span
                  className='ml-2 shrink-0'
                  onClick={(e) => e.stopPropagation()}
                >
                  {item.actions}
                </span>
              ) : null}
            </button>
          )}

          {hasChildren && isOpen ? (
            <div className='min-w-0'>
              {item.children!.map((child) => renderNode(child, level + 1))}
            </div>
          ) : null}
        </div>
      );
    },
    [
      defaultLeafIcon,
      defaultNodeIcon,
      handleSelect,
      openIds,
      renderItem,
      selectedId,
      toggleOpen
    ]
  );

  return (
    <div
      className={cn('w-full min-w-0', className)}
      role='tree'
      {...props}
    >
      {items.map((item) => renderNode(item, 0))}
    </div>
  );
}
