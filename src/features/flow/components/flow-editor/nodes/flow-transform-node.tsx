'use client';

import { Badge } from '@/components/ui/badge';
import type { FlowTransformNodeData } from '@/features/flow/types';
import { LogoOrIcon } from '@/features/graph/components/graph-editor/components/logo-or-icon';
import { getEntityConfig } from '@/features/graph/config/entity-config';
import { getBuiltInPluginStyle } from '@/features/plugins/utils/plugin-style';
import { cn } from '@/lib/utils';
import { memo, useMemo } from 'react';
import type { NodeProps } from 'reactflow';
import { Handle, Position, useStore } from 'reactflow';

import { FlowTransformPicker } from '../components/flow-transform-picker';
import { useFlowConnectionFilter } from '../flow-connection-filter-context';

export const FlowTransformNode = memo(function FlowTransformNode(
  props: NodeProps<FlowTransformNodeData>
) {
  const data = props.data;
  const isMissing = Boolean(data?.missingReason);
  const isSelected = Boolean(props.selected);
  const { canEdit, transformGroups, onAddTransformFromSource } =
    useFlowConnectionFilter();
  const pluginLabel = data?.pluginName
    ? String(data.pluginName)
    : String(data?.pluginId ?? 'Plugin');

  const isProbablyUrl = (value: string | null | undefined) => {
    if (!value) return false;
    return (
      value.startsWith('http://') ||
      value.startsWith('https://') ||
      value.startsWith('data:') ||
      value.startsWith('/api/logo')
    );
  };

  const inputTypes = [String(data?.inputType ?? 'custom')];
  const iconKey = isProbablyUrl(data?.pluginIcon ?? null)
    ? undefined
    : (data?.pluginIcon ?? undefined);
  const builtinStyle = getBuiltInPluginStyle(inputTypes, iconKey, undefined);
  const logoUrl =
    data?.pluginLogoUrl ??
    (isProbablyUrl(data?.pluginIcon ?? null) ? data?.pluginIcon : undefined);

  const baseHandleClass = cn(
    // Base dimensions and positioning
    '!h-1.5 !w-1.5 !bg-transparent !border-0',
    'relative z-50',

    // Extended hit area (invisible)
    'before:content-[""] before:absolute before:top-1/2 before:left-1/2 before:-translate-x-1/2 before:-translate-y-1/2',
    'before:h-5 before:w-5 before:rounded-full before:bg-transparent',

    // Visible dot
    'after:content-[""] after:absolute after:top-1/2 after:left-1/2 after:-translate-x-1/2 after:-translate-y-1/2',
    'after:h-1.5 after:w-1.5 after:rounded-full after:border after:border-white after:bg-indigo-400 after:transition-all',

    // Visibility logic
    'after:opacity-0 hover:after:opacity-100',
    'hover:after:scale-[1.15]'
  );

  const edges = useStore((s: any) =>
    Array.isArray(s?.edges) ? s.edges : []
  ) as Array<{
    source?: string;
    target?: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }>;

  const connectedHandleIdSet = useMemo(() => {
    const set = new Set<string>();
    for (const e of edges) {
      if (String(e.source ?? '') === props.id && e.sourceHandle)
        set.add(String(e.sourceHandle));
      if (String(e.target ?? '') === props.id && e.targetHandle)
        set.add(String(e.targetHandle));
    }
    return set;
  }, [edges, props.id]);

  function getHandleClass(args: {
    isConnected: boolean;
    side: 'left' | 'right';
  }) {
    return cn(
      baseHandleClass,
      // Default color
      args.isConnected
        ? 'after:bg-indigo-400 hover:after:bg-indigo-500'
        : 'after:bg-slate-400 hover:after:bg-slate-500',
      // Nudge a bit outside the chip while staying subtle
      args.side === 'left'
        ? 'after:-translate-x-[1px]'
        : 'after:translate-x-[1px]'
    );
  }

  function summarizeTypes(types: string[]) {
    const counts = new Map<string, number>();
    const ordered: string[] = [];
    for (const raw of types) {
      const t = String(raw ?? '').trim();
      if (!t) continue;
      if (!counts.has(t)) ordered.push(t);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return ordered.map((t) => ({ type: t, count: counts.get(t) ?? 1 }));
  }

  const inputCfg = data?.inputType
    ? getEntityConfig(String(data.inputType))
    : null;
  const InputIcon = inputCfg ? (inputCfg.icon as any) : null;
  const outputSummaries = Array.isArray(data?.outputTypes)
    ? summarizeTypes(data.outputTypes)
    : [];

  const isInputConnected = Boolean(
    data?.inputType && connectedHandleIdSet.has(`in:${String(data.inputType)}`)
  );

  function isAnyOutputConnected(args: { outType: string; count: number }) {
    const outType = String(args.outType);
    const count = Math.max(1, args.count);
    for (let i = 0; i < count; i++) {
      if (connectedHandleIdSet.has(`out:${outType}:${i}`)) return true;
    }
    return false;
  }

  return (
    <div
      className={cn(
        'group bg-background rounded-xl border shadow-sm transition-all duration-200',
        'max-w-[280px] min-w-[220px]',
        isMissing ? 'border-destructive/40 opacity-80' : 'border-border/50',
        isSelected ? 'ring-primary/20 ring-4' : '',
        !isMissing ? 'hover:shadow-md' : ''
      )}
    >
      {/* Header */}
      <div className='border-border/40 flex items-center gap-3 border-b px-2.5 py-2'>
        <LogoOrIcon
          label={pluginLabel}
          logoUrl={logoUrl ?? undefined}
          Icon={builtinStyle.Icon}
          sizePx={18}
          className='h-[18px] w-[18px]'
          iconClassName='text-muted-foreground'
        />
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-1.5'>
            <span className='min-w-0 truncate text-[12px] leading-4 font-semibold'>
              {data?.name || 'Transform'}
            </span>
          </div>
          <div className='text-muted-foreground truncate text-[10px] leading-4'>
            {pluginLabel}
            {isMissing ? (
              <span className='text-destructive ml-2 font-semibold'>
                Missing
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Bottom bar: input (left) / outputs (right) */}
      {data?.inputType || outputSummaries.length > 0 ? (
        <div className='border-border/40 bg-muted/10 border-t px-2.5 py-2.5'>
          {(() => {
            return (
              <div className='grid grid-cols-2 items-center gap-3'>
                <div className='flex min-w-0 items-center self-stretch'>
                  {data?.inputType && inputCfg && InputIcon ? (
                    <div className='relative w-full'>
                      <Handle
                        type='target'
                        id={`in:${String(data.inputType)}`}
                        position={Position.Left}
                        className={getHandleClass({
                          isConnected: connectedHandleIdSet.has(
                            `in:${String(data.inputType)}`
                          ),
                          side: 'left'
                        })}
                        style={{ top: '50%', left: -4 }}
                      />
                      <Badge
                        variant='outline'
                        className={cn(
                          'border-border/40 h-7 w-full justify-start px-2 py-1 text-[11px] font-semibold',
                          isInputConnected
                            ? cn(inputCfg.headerBg, inputCfg.headerText)
                            : 'bg-muted/40 text-muted-foreground'
                        )}
                        title={`${inputCfg.label} (${String(data.inputType)})`}
                      >
                        <InputIcon className='h-3 w-3' />
                        <span className='min-w-0 truncate'>
                          {inputCfg.label}
                        </span>
                      </Badge>
                    </div>
                  ) : (
                    <div className='text-muted-foreground text-xs italic'>
                      —
                    </div>
                  )}
                </div>

                <div className='min-w-0'>
                  {outputSummaries.length ? (
                    <div className='flex flex-col gap-1'>
                      {outputSummaries.map(({ type, count }) => {
                        const cfg = getEntityConfig(String(type));
                        const Icon = cfg.icon as any;
                        const isConnected = isAnyOutputConnected({
                          outType: String(type),
                          count
                        });
                        const offsetsPx =
                          count <= 1
                            ? [0]
                            : Array.from({ length: count }).map((_, i) => {
                                const mid = (count - 1) / 2;
                                return Math.round((i - mid) * 8);
                              });
                        const outputBadge = (
                          <Badge
                            variant='outline'
                            className={cn(
                              'border-border/40 h-7 w-full justify-between gap-2 px-2 py-1 text-[11px] font-semibold',
                              canEdit &&
                                onAddTransformFromSource &&
                                'hover:ring-primary/15 cursor-pointer transition-[box-shadow,background-color] hover:ring-2',
                              isConnected
                                ? cn(cfg.headerBg, cfg.headerText)
                                : 'bg-muted/40 text-muted-foreground'
                            )}
                            title={`${cfg.label} (${type})`}
                          >
                            <span className='flex min-w-0 items-center gap-1.5'>
                              <Icon className='h-3 w-3' />
                              <span className='min-w-0 truncate'>
                                {cfg.label}
                              </span>
                            </span>
                            {count > 1 ? (
                              <span className='bg-background/30 rounded-md px-1.5 py-0 text-[10px] font-semibold'>
                                ×{count}
                              </span>
                            ) : null}
                          </Badge>
                        );
                        return (
                          <div key={`out:${type}`} className='relative h-7'>
                            {offsetsPx.map((off, i) => (
                              <Handle
                                key={`out:${type}:${i}`}
                                type='source'
                                id={`out:${String(type)}:${i}`}
                                position={Position.Right}
                                className={getHandleClass({
                                  isConnected: connectedHandleIdSet.has(
                                    `out:${String(type)}:${i}`
                                  ),
                                  side: 'right'
                                })}
                                style={{
                                  top: `calc(50% + ${off}px)`,
                                  right: 0
                                }}
                              />
                            ))}
                            {canEdit && onAddTransformFromSource ? (
                              <FlowTransformPicker
                                triggerNodeType={String(type)}
                                groups={transformGroups}
                                onSelect={(transform) =>
                                  onAddTransformFromSource({
                                    sourceNodeId: props.id,
                                    outType: String(type),
                                    transform
                                  })
                                }
                                trigger={
                                  <button
                                    type='button'
                                    className='nodrag nopan focus-visible:ring-primary/30 block w-full rounded-md text-left outline-none focus-visible:ring-2'
                                    aria-label={`Add transform from ${cfg.label}`}
                                    onClick={(event) => event.stopPropagation()}
                                    onDoubleClick={(event) =>
                                      event.stopPropagation()
                                    }
                                  >
                                    {outputBadge}
                                  </button>
                                }
                              />
                            ) : (
                              outputBadge
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className='text-muted-foreground text-right text-xs italic'>
                      —
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
});
