'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  IconChecks,
  IconCopy,
  IconSquareOff,
  IconPlus
} from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import type { OSINTEntity } from '@/features/plugins/types';
import {
  nodeTypeByType,
  type EntityType
} from '@/features/osint/node-registry';
import { cardImage } from './graph-editor/utils/card-node';

/** Photo or logo a plugin attached to the result, if it loads. */
function ResultThumbnail({ src, contain }: { src?: string; contain: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <img
      src={src}
      alt=''
      loading='lazy'
      decoding='async'
      referrerPolicy='no-referrer'
      className={cn(
        'h-8 w-8 shrink-0 rounded-md border',
        contain ? 'object-contain p-0.5' : 'object-cover'
      )}
      onError={() => setFailed(true)}
    />
  );
}

function getEntityUi(entityType: string) {
  const type = (entityType as EntityType) in nodeTypeByType
    ? (entityType as EntityType)
    : 'custom';
  return nodeTypeByType[type];
}

/** Compute a stable signature for duplicate detection: type::normalizedLabel */
export function computeNodeSignature(type: string, label: string): string {
  const normalizedType = String(type ?? '').trim().toLowerCase();
  const normalizedLabel = String(label ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  return `${normalizedType}::${normalizedLabel}`;
}

interface TransformResultsSheetProps {
  open: boolean;
  readOnly?: boolean;
  onOpenChange: (open: boolean) => void;
  entities: OSINTEntity[];
  transformName: string;
  sourceNodeId?: string | null;
  onConfirm: (selectedIds: string[]) => void;
  /**
   * Returns how/if this entity can be applied:
   * - `add_node`: the node is not in graph and can be added
   * - `add_edge`: the node exists in graph but we can add the edge from source
   * - `blocked`: nothing to do (already connected or invalid)
   */
  getEntityAddability: (
    entityId: string,
    signature: string,
    sourceNodeId?: string | null
  ) => 'add_node' | 'add_edge' | 'blocked';
}

export function TransformResultsSheet({
  open,
  readOnly = false,
  onOpenChange,
  entities,
  transformName,
  sourceNodeId,
  onConfirm,
  getEntityAddability
}: TransformResultsSheetProps) {
  // Compute signature for each entity
  const entitiesWithSignatures = useMemo(() => {
    return entities.map((e) => ({
      ...e,
      _signature: computeNodeSignature(e.type, e.label || e.value || '')
    }));
  }, [entities]);

  function getAddabilityForEntity(e: (OSINTEntity & { _signature: string })) {
    return getEntityAddability(e.id, e._signature, sourceNodeId);
  }

  // Selectable entities:
  // - node not in graph (add_node)
  // - node already in graph but we can still add the edge from source (add_edge)
  const getSelectableEntities = useCallback(() => {
    return entitiesWithSignatures.filter((e) => getAddabilityForEntity(e) !== 'blocked');
  }, [entitiesWithSignatures, getEntityAddability, sourceNodeId]);

  // Get current selectable entities
  const selectableEntities = getSelectableEntities();
  const selectableIds = useMemo(
    () => new Set(selectableEntities.map((e) => e.id)),
    [selectableEntities]
  );

  // Selected IDs state - only IDs that are currently selectable
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    return new Set(selectableEntities.map((e) => e.id));
  });

  // Reset selection when entities change or when panel opens
  useEffect(() => {
    if (open) {
      const selectable = getSelectableEntities();
      setSelectedIds(new Set(selectable.map((e) => e.id)));
    }
  }, [open, getSelectableEntities]);

  // Clean up selected IDs - remove any that are no longer selectable
  useEffect(() => {
    setSelectedIds((prev) => {
      const cleaned = new Set<string>();
      prev.forEach((id) => {
        if (selectableIds.has(id)) {
          cleaned.add(id);
        }
      });
      // If nothing changed, return same reference to avoid re-renders
      if (cleaned.size === prev.size) {
        let same = true;
        prev.forEach((id) => {
          if (!cleaned.has(id)) same = false;
        });
        if (same) return prev;
      }
      return cleaned;
    });
  }, [selectableIds]);

  const toggleEntity = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const groupedEntities = useMemo(() => {
    const groups: Record<string, (OSINTEntity & { _signature: string })[]> = {};
    for (const entity of entitiesWithSignatures) {
      if (!groups[entity.type]) groups[entity.type] = [];
      groups[entity.type].push(entity);
    }
    // Sort each group: selectable (non-duplicates) first, then duplicates
    for (const type of Object.keys(groups)) {
      groups[type].sort((a, b) => {
        const aSelectable = selectableIds.has(a.id) ? 0 : 1;
        const bSelectable = selectableIds.has(b.id) ? 0 : 1;
        return aSelectable - bSelectable;
      });
    }
    return groups;
  }, [entitiesWithSignatures, selectableIds]);

  const toggleGroup = useCallback(
    (type: string) => {
      const typeEntities = groupedEntities[type] || [];
      const selectableInGroup = typeEntities.filter((e) =>
        selectableIds.has(e.id)
      );
      if (!selectableInGroup.length) return;

      const allSelected = selectableInGroup.every((e) => selectedIds.has(e.id));

      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (allSelected) {
          selectableInGroup.forEach((e) => next.delete(e.id));
        } else {
          selectableInGroup.forEach((e) => next.add(e.id));
        }
        return next;
      });
    },
    [groupedEntities, selectableIds, selectedIds]
  );

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(selectableIds));
  }, [selectableIds]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleConfirm = useCallback(() => {
    if (readOnly) return;
    // Get final list of IDs to add - re-check against graph state
    const finalIds = Array.from(selectedIds).filter((id) => {
      const entity = entitiesWithSignatures.find((e) => e.id === id);
      if (!entity) return false;
      // Final check: can we still apply it?
      return getEntityAddability(entity.id, entity._signature, sourceNodeId) !== 'blocked';
    });

    // Close immediately
    onOpenChange(false);

    // Add nodes if any
    if (finalIds.length > 0) {
      onConfirm(finalIds);
    }
  }, [readOnly, selectedIds, entitiesWithSignatures, getEntityAddability, onOpenChange, onConfirm, sourceNodeId]);

  const allSelected =
    selectableIds.size > 0 && selectedIds.size === selectableIds.size;
  const noneSelected = selectedIds.size === 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal>
      <SheetContent
        side='right'
        className='flex h-full w-[400px] flex-col p-0 sm:w-[480px] sm:max-w-none'
      >
        <SheetHeader className='shrink-0 border-b px-4 pt-4 pb-3'>
          <SheetTitle className='flex items-center gap-2 text-base'>
            Transform results
            <Badge variant='secondary' className='text-xs'>
              {entities.length}
            </Badge>
          </SheetTitle>
          <SheetDescription className='text-xs'>
            <span className='font-medium'>{transformName}</span>
            {!readOnly && ' — select nodes to add'}
          </SheetDescription>
        </SheetHeader>

        <div className='bg-muted/40 flex shrink-0 items-center gap-2 border-b px-4 py-2'>
          <Button
            variant={allSelected ? 'secondary' : 'ghost'}
            size='sm'
            onClick={selectAll}
            className='h-7 gap-1.5 text-xs'
            disabled={allSelected || selectableIds.size === 0}
          >
            <IconChecks className='h-3.5 w-3.5' />
            All
          </Button>
          <Button
            variant={noneSelected ? 'secondary' : 'ghost'}
            size='sm'
            onClick={deselectAll}
            className='h-7 gap-1.5 text-xs'
            disabled={noneSelected}
          >
            <IconSquareOff className='h-3.5 w-3.5' />
            None
          </Button>
          <span className='text-muted-foreground ml-auto text-xs'>
            <span className='font-medium'>{selectedIds.size}</span> /{' '}
            {selectableIds.size}
          </span>
        </div>

        <ScrollArea className='min-h-0 flex-1'>
          <div className='space-y-4 px-4 py-3' data-allow-text-selection='true'>
            {Object.entries(groupedEntities).map(([type, typeEntities]) => {
              const ui = getEntityUi(type);
              const Icon = ui.icon;
              const colors = ui.ui.badge;
              const label = ui.label || type;

              const selectableInGroup = typeEntities.filter((e) =>
                selectableIds.has(e.id)
              );
              const selectedInGroup = typeEntities.filter(
                (e) => selectedIds.has(e.id) && selectableIds.has(e.id)
              );
              const groupAllSelected =
                selectableInGroup.length > 0 &&
                selectableInGroup.every((e) => selectedIds.has(e.id));

              return (
                <div key={type}>
                  <div
                    onClick={() => toggleGroup(type)}
                    className={cn(
                      'mb-2 flex w-full items-center gap-2 transition-opacity',
                      selectableInGroup.length > 0
                        ? 'cursor-pointer hover:opacity-70'
                        : 'cursor-not-allowed opacity-50'
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded',
                        colors.bg,
                        colors.darkBg
                      )}
                    >
                      <Icon className={cn('h-3.5 w-3.5', colors.text)} />
                    </div>
                    <span className='min-w-0 max-w-full truncate text-sm font-medium'>
                      {label}
                    </span>
                    <Badge variant='outline' className='ml-1 h-5 text-[10px]'>
                      {selectedInGroup.length}/{typeEntities.length}
                    </Badge>
                    <Checkbox
                      checked={groupAllSelected}
                      disabled={selectableInGroup.length === 0}
                      className='ml-auto h-4 w-4'
                      onClick={(e) => e.stopPropagation()}
                      onCheckedChange={() => toggleGroup(type)}
                    />
                  </div>

                  <div className='ml-1 space-y-1.5'>
                    {typeEntities.map((entity) => {
                      const addability = getEntityAddability(entity.id, entity._signature, sourceNodeId);
                      const isSelectable = addability !== 'blocked';
                      const isSelected = selectedIds.has(entity.id);
                      const isBlocked = addability === 'blocked';
                      const isAddEdge = addability === 'add_edge';

                      return (
                        <div
                          key={entity.id}
                          onClick={() => isSelectable && toggleEntity(entity.id)}
                          className={cn(
                            'flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-all',
                            isBlocked
                              ? 'bg-muted/30 border-muted cursor-not-allowed opacity-50'
                              : 'cursor-pointer',
                            isSelectable && isSelected
                              ? 'border-indigo-300 bg-indigo-50 text-indigo-950 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-50'
                              : isSelectable &&
                                  'bg-background border-border hover:bg-muted/50'
                          )}
                        >
                          <Checkbox
                            checked={isSelected}
                            disabled={isBlocked}
                            className='pointer-events-none h-4 w-4'
                          />
                          <ResultThumbnail
                            key={cardImage(entity.metadata)}
                            src={cardImage(entity.metadata)}
                            contain={entity.type === 'breach'}
                          />
                          <div className='min-w-0 max-w-full flex-1'>
                            <div className='flex min-w-0 items-center gap-2'>
                              <p
                                className={cn(
                                  'min-w-0 max-w-full flex-1 truncate text-sm font-medium',
                                  isSelected &&
                                    isSelectable &&
                                    'text-indigo-700 dark:text-indigo-200'
                                )}
                              >
                                {entity.label || entity.value}
                              </p>
                              {isAddEdge ? (
                                <Badge variant='outline' className='shrink-0 text-[10px]'>
                                  Link
                                </Badge>
                              ) : null}
                              {isBlocked ? (
                                <Badge
                                  variant='secondary'
                                  className='shrink-0 text-[10px]'
                                >
                                  In graph
                                </Badge>
                              ) : null}
                            </div>
                            {entity.label && entity.label !== entity.value && (
                              <p className='text-muted-foreground mt-0.5 max-w-full truncate text-[11px]'>
                                {entity.value}
                              </p>
                            )}
                          </div>
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon'
                            className='h-7 w-7 shrink-0'
                            aria-label='Copy result value'
                            title='Copy value'
                            onClick={async (event) => {
                              event.stopPropagation();
                              try {
                                await navigator.clipboard.writeText(
                                  entity.value || entity.label
                                );
                                toast.success('Copied to clipboard');
                              } catch {
                                toast.error('Failed to copy result');
                              }
                            }}
                          >
                            <IconCopy className='h-3.5 w-3.5' />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <div className='bg-background flex shrink-0 gap-2 border-t px-4 py-3'>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            className='h-9 flex-1'
          >
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={readOnly || selectedIds.size === 0}
            className='h-9 flex-1 gap-1.5'
          >
            <IconPlus className='h-4 w-4' />
            Add ({selectedIds.size})
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
