'use client';

import * as React from 'react';
import { useGraphCanEdit } from '@/features/graph/contexts/graph-mutation-context';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CheckIcon as IconCheck,
  PencilSimpleIcon as IconEdit,
  PlusIcon as IconPlus,
  XIcon as IconX
} from '@/components/icons';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { LinkableText } from '@/features/graph/components/linkable-text';
import { getNodeDisplayLabel } from '@/features/graph/utils/display-label';
import type { OSINTNodeData } from '@/features/graph/types';
import { type NodeType } from '@/features/osint/node-registry';
import { LogoOrIcon } from './logo-or-icon';

const RESERVED_MERGE_METADATA_KEYS = new Set(['__merge', 'merge', 'merged', 'mergedChildCount']);
function isReservedMergeMetadataKey(key: string) {
  return RESERVED_MERGE_METADATA_KEYS.has(String(key));
}

// Metadata di stile interni: nascosti dal display, preservati sul nodo.
const HIDDEN_DISPLAY_METADATA_KEYS = new Set([
  'customColor',
  'headerTextColor',
  'autoColorFromLogo',
  'autoHeaderTextColorFromLogo',
  'nodeView',
  'logoDomain'
]);
function isHiddenDisplayMetadataKey(key: string) {
  return HIDDEN_DISPLAY_METADATA_KEYS.has(String(key));
}

function getCustomTitle(metadata: Record<string, unknown> | null | undefined) {
  const value = metadata ? (metadata as Record<string, unknown>).customTitle : undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getDialogTitleLabel(args: { nodeData: OSINTNodeData; defaultTitleLabel: string }) {
  // For ai_insight, title comes from metadata.title (kept as-is)
  if (args.nodeData.type === 'ai_insight') {
    const maybeTitle = (args.nodeData as any)?.metadata?.title;
    if (typeof maybeTitle === 'string' && maybeTitle.trim()) return maybeTitle.trim();
  }

  return getCustomTitle(args.nodeData.metadata as any) ?? args.defaultTitleLabel;
}

export interface OpenNodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  nodeId: string;
  nodeData: OSINTNodeData;

  headerBgClassName: string;
  headerTextClassName: string;
  titleLabel: string;
  Icon: React.ComponentType<{ className?: string }>;
  logoUrl?: string | null;

  isEditMode: boolean;
  setIsEditMode: (next: boolean) => void;
  editedLabel: string;
  setEditedLabel: (next: string) => void;
  editedMetadata: Record<string, unknown>;
  setEditedMetadata: (next: Record<string, unknown>) => void;
  newMetaKey: string;
  setNewMetaKey: (next: string) => void;
  newMetaValue: string;
  setNewMetaValue: (next: string) => void;

  onUpdateMetadataValue: (key: string, value: string) => void;
  onRemoveMetadataKey: (key: string) => void;
  onAddMetadataKeyValue: () => void;
  onSave: () => void;
  onDelete: () => void;

  availableTransformNames?: string[];
}

export type OpenNodeDialogBodyProps = Omit<OpenNodeDialogProps, 'open' | 'onOpenChange'>;

export function OpenNodeDialogBody(props: OpenNodeDialogBodyProps) {
  const canEdit = useGraphCanEdit();
  const readOnly = !canEdit();
  const isEditMode = props.isEditMode && !readOnly;
  React.useEffect(() => {
    if (!readOnly || !props.isEditMode) return;
    // Discard the old draft when ownership changes; it must not reappear on unlock.
    props.setIsEditMode(false);
    props.setEditedLabel(props.nodeData.label);
    props.setEditedMetadata(props.nodeData.metadata || {});
    props.setNewMetaKey('');
    props.setNewMetaValue('');
  }, [readOnly, props]);
  const dialogTitleLabel = getDialogTitleLabel({
    nodeData: props.nodeData,
    defaultTitleLabel: props.titleLabel
  });

  const canEditCustomTitle =
    props.nodeData.type !== 'ai_insight' ||
    !(typeof (props.nodeData as any)?.metadata?.title === 'string' && (props.nodeData as any).metadata.title.trim());

  const customTitleValue = isEditMode
    ? String(((props.editedMetadata as any)?.customTitle as string | undefined) ?? '')
    : String(((props.nodeData.metadata as any)?.customTitle as string | undefined) ?? '');

  return (
    <>
      <DialogHeader className='pb-2'>
        <div className='flex items-center gap-3'>
          <div className={cn('rounded-lg p-2.5', props.headerBgClassName)}>
            <LogoOrIcon
              label={props.titleLabel}
              logoUrl={props.logoUrl ?? undefined}
              Icon={props.Icon}
              sizePx={28}
              iconClassName={cn('h-7 w-7', props.headerTextClassName)}
              className='h-7 w-7'
            />
          </div>
          <div className='flex-1'>
            <DialogTitle className='text-lg'>
              {isEditMode ? `Edit ${dialogTitleLabel}` : dialogTitleLabel}
            </DialogTitle>
            <DialogDescription className='text-xs'>Node ID: {props.nodeId}</DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <Separator />

      <ScrollArea className='max-h-[400px] pr-4'>
        <div className='space-y-4 py-2'>
          {/* Titolo nodo (header) */}
          <div>
            <p className='text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase'>
              Title
            </p>
            {isEditMode ? (
              <div className='space-y-1.5'>
                <Input
                  value={customTitleValue}
                  onChange={(e) => {
                    if (!canEdit()) return;
                    props.setEditedMetadata({
                      ...props.editedMetadata,
                      customTitle: e.target.value
                    });
                  }}
                  className='text-sm'
                  placeholder={props.titleLabel}
                  disabled={readOnly || !canEditCustomTitle}
                />
                {!canEditCustomTitle ? (
                  <p className='text-muted-foreground text-xs'>
                    This node title is managed by <code className='font-mono'>metadata.title</code>.
                  </p>
                ) : (
                  <p className='text-muted-foreground text-xs'>
                    Leave empty to use the default title: &quot;{props.titleLabel}&quot;
                  </p>
                )}
              </div>
            ) : (
              <div className='bg-muted/50 rounded-lg border p-3'>
                <span className='text-sm font-semibold'>{dialogTitleLabel}</span>
              </div>
            )}
          </div>

          {/* Value / Label principale */}
          <div>
            <p className='text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase'>
              {props.nodeData.type === 'media_url' ? 'URL' : 'Value'}
            </p>
            {isEditMode ? (
              props.nodeData.type === 'note' || props.nodeData.type === 'ai_insight' ? (
                <textarea
                  disabled={readOnly}
                  value={props.editedLabel}
                  onChange={(e) => {
                    if (!canEdit()) return;
                    props.setEditedLabel(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (!canEdit()) return;
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      props.onSave();
                    }
                  }}
                  className='bg-background focus:ring-primary w-full rounded-lg border p-3 text-sm focus:ring-1 focus:outline-none'
                  rows={4}
                  placeholder='Enter value... (Ctrl+Enter to save)'
                />
              ) : (
                <Input
                  disabled={readOnly}
                  value={props.editedLabel}
                  onChange={(e) => {
                    if (!canEdit()) return;
                    props.setEditedLabel(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (!canEdit()) return;
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      props.onSave();
                    }
                  }}
                  className='text-sm'
                  placeholder='Enter value... (Enter to save)'
                />
              )
            ) : (
              <div className='bg-muted/50 rounded-lg border p-3'>
                {props.nodeData.label ? (
                  <LinkableText
                    text={getNodeDisplayLabel({
                      type: props.nodeData.type as NodeType,
                      label: props.nodeData.label,
                      metadata: props.nodeData.metadata
                    })}
                    className='text-sm font-medium break-all whitespace-pre-wrap'
                  />
                ) : (
                  <span className='text-muted-foreground text-sm italic'>Empty</span>
                )}
              </div>
            )}
          </div>

          {!isEditMode && Array.isArray((props.nodeData as any)?.metadata?.merged) ? (
            <div>
              <Accordion type='single' collapsible>
                <AccordionItem value='merged' className='border-b-0'>
                  <AccordionTrigger className='py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:no-underline'>
                    <span className='flex items-center gap-2'>
                      <span>Merged</span>
                      <Badge variant='outline' className='h-5 text-[10px]'>
                        {(props.nodeData as any).metadata.merged.length}
                      </Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className='pb-0'>
                    <div className='paranod-scrollbar max-h-[260px] overflow-auto pr-1'>
                      <div className='grid gap-2'>
                        {(props.nodeData as any).metadata.merged.map((item: any, idx: number) => {
                          const label = item?.label ?? null;
                          const val = item?.value ?? null;
                          const primary = String(label ?? val ?? '').trim();
                          const secondary =
                            label && val && String(label) !== String(val) ? String(val) : null;

                          return (
                            <div
                              key={`m-${idx}`}
                              className='bg-background flex min-w-0 items-start justify-between gap-3 rounded-md border border-border/40 px-2 py-1.5'
                            >
                              <div className='min-w-0 flex-1'>
                                <div className='min-w-0 text-sm font-medium'>
                                  <LinkableText text={primary || '—'} truncate maxLength={90} />
                                </div>
                                {secondary ? (
                                  <div className='text-muted-foreground min-w-0 text-[11px]'>
                                    <LinkableText
                                      text={secondary}
                                      className='break-all'
                                      truncate
                                      maxLength={120}
                                    />
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          ) : null}

          {/* Metadata */}
          <div>
            <p className='text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase'>
              Metadata
            </p>
            <div className='space-y-2'>
              {Object.entries(isEditMode ? props.editedMetadata : props.nodeData.metadata || {})
                .filter(
                  ([key]) =>
                    !isReservedMergeMetadataKey(key) &&
                    !isHiddenDisplayMetadataKey(key)
                )
                .map(([key, value]) => {
                  const formattedKey = key
                    .replace(/_/g, ' ')
                    .replace(/([A-Z])/g, ' $1')
                    .trim();

                  if (isEditMode) {
                    return (
                      <div
                        key={key}
                        className='bg-background flex items-center gap-2 rounded-lg border p-2'
                      >
                        <span className='text-muted-foreground w-24 shrink-0 truncate text-xs capitalize'>
                          {formattedKey}
                        </span>
                        <Input
                          disabled={readOnly}
                          value={String(value ?? '')}
                          onChange={(e) => {
                            if (!canEdit()) return;
                            props.onUpdateMetadataValue(key, e.target.value);
                          }}
                          onKeyDown={(e) => {
                            if (!canEdit()) return;
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              props.onSave();
                            }
                          }}
                          className='h-8 flex-1 text-sm'
                          placeholder='Value...'
                        />
                        <Button
                          disabled={readOnly}
                          variant='ghost'
                          size='icon'
                          className='h-8 w-8 shrink-0 text-red-500 hover:text-red-600'
                          onClick={() => {
                            if (!canEdit()) return;
                            props.onRemoveMetadataKey(key);
                          }}
                        >
                          <IconX className='h-4 w-4' />
                        </Button>
                      </div>
                    );
                  }

                  // Vista sola lettura
                  const renderValue = () => {
                    if (value === null || value === undefined)
                      return <span className='text-muted-foreground italic'>null</span>;
                    if (typeof value === 'boolean')
                      return (
                        <Badge variant={value ? 'default' : 'secondary'}>
                          {value ? 'Yes' : 'No'}
                        </Badge>
                      );
                    if (Array.isArray(value))
                      return (
                        <div className='flex flex-wrap gap-1'>
                          {value.map((v, i) => (
                            <Badge key={i} variant='outline' className='text-xs'>
                              <LinkableText text={String(v)} />
                            </Badge>
                          ))}
                        </div>
                      );
                    if (typeof value === 'object')
                      return (
                        <pre className='bg-muted overflow-x-auto rounded p-2 text-xs'>
                          {JSON.stringify(value, null, 2)}
                        </pre>
                      );
                    const strValue = String(value);
                    if (strValue.length > 50)
                      return (
                        <LinkableText text={strValue} className='font-mono text-sm break-all' />
                      );
                    return <LinkableText text={strValue} className='text-sm font-medium' />;
                  };

                  return (
                    <div
                      key={key}
                      className='bg-background flex items-start justify-between gap-4 rounded-lg border p-2.5'
                    >
                      <span className='text-muted-foreground shrink-0 text-xs capitalize'>
                        {formattedKey}
                      </span>
                      <div className='text-right'>{renderValue()}</div>
                    </div>
                  );
                })}

              {/* Aggiungi nuovo metadata */}
              {isEditMode ? (
                <div className='flex items-center gap-2 pt-2'>
                  <Input
                    disabled={readOnly}
                    value={props.newMetaKey}
                    onChange={(e) => {
                      if (!canEdit()) return;
                      props.setNewMetaKey(e.target.value);
                    }}
                    className='h-8 w-28 text-xs'
                    placeholder='Key...'
                  />
                  <Input
                    disabled={readOnly}
                    value={props.newMetaValue}
                    onChange={(e) => {
                      if (!canEdit()) return;
                      props.setNewMetaValue(e.target.value);
                    }}
                    className='h-8 flex-1 text-xs'
                    placeholder='Value...'
                    onKeyDown={(e) => {
                      if (!canEdit()) return;
                      if (e.key === 'Enter') props.onAddMetadataKeyValue();
                    }}
                  />
                  <Button
                    variant='outline'
                    size='sm'
                    className='h-8 gap-1'
                    onClick={() => {
                      if (canEdit()) props.onAddMetadataKeyValue();
                    }}
                    disabled={readOnly || !props.newMetaKey.trim()}
                  >
                    <IconPlus className='h-3.5 w-3.5' />
                    Add
                  </Button>
                </div>
              ) : null}

              {!isEditMode &&
                (!props.nodeData.metadata || Object.keys(props.nodeData.metadata).length === 0) && (
                  <p className='text-muted-foreground text-xs italic'>No metadata</p>
                )}
            </div>
          </div>

          {/* Transforms disponibili - solo in vista */}
          {!isEditMode && (props.availableTransformNames ?? []).length > 0 ? (
            <div>
              <p className='text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase'>
                Available Transforms
              </p>
              <div className='flex flex-wrap gap-1.5'>
                {(props.availableTransformNames ?? []).map((name) => (
                  <Badge key={name} variant='secondary' className='text-xs'>
                    {name}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <Separator />

      <div className='flex justify-between pt-2'>
        {isEditMode ? (
          <>
            <Button
              variant='outline'
              size='sm'
              onClick={() => {
                props.setEditedLabel(props.nodeData.label);
                props.setEditedMetadata((props.nodeData.metadata || {}) as any);
                props.setIsEditMode(false);
              }}
              className='gap-2'
            >
              Cancel
            </Button>
            <Button
              disabled={readOnly}
              size='sm'
              onClick={() => {
                if (canEdit()) props.onSave();
              }}
              className='gap-2'
            >
              <IconCheck className='h-4 w-4' />
              Save Changes
            </Button>
          </>
        ) : (
          <>
            <Button
              disabled={readOnly}
              variant='outline'
              size='sm'
              onClick={() => {
                if (!canEdit()) return;
                props.setIsEditMode(true);
              }}
              className='gap-2'
            >
              <IconEdit className='h-4 w-4' />
              Edit
            </Button>
            <Button
              variant='destructive'
              size='sm'
              disabled={!canEdit()}
              onClick={() => {
                if (canEdit()) props.onDelete();
              }}
              className='gap-2'
            >
              <IconX className='h-4 w-4' />
              Delete
            </Button>
          </>
        )}
      </div>
    </>
  );
}

export function OpenNodeDialog(props: OpenNodeDialogProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        props.onOpenChange(open);
        if (!open) props.setIsEditMode(false);
      }}
    >
      <DialogContent className='sm:max-w-[500px]'>
        <OpenNodeDialogBody {...props} />
      </DialogContent>
    </Dialog>
  );
}
