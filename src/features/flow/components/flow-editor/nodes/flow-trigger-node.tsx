'use client';

import { memo, useMemo } from 'react';
import type { NodeProps } from 'reactflow';
import { Handle, Position, useStore } from 'reactflow';
import { cn } from '@/lib/utils';
import type { FlowTriggerNodeData } from '@/features/flow/types';
import { LogoOrIcon } from '@/features/graph/components/graph-editor/components/logo-or-icon';
import { getPhosphorIconByKey } from '@/features/osint/phosphor-icon-by-key';
import {
  nodePaletteItems,
  nodeTypeByType,
  type NodeType
} from '@/features/osint/node-registry';
import { PlusIcon as IconPlus } from '@/components/icons';
import { useFlowConnectionFilter } from '../flow-connection-filter-context';
import { FlowTransformPicker } from '../components/flow-transform-picker';

export const FlowTriggerNode = memo(function FlowTriggerNode(
  props: NodeProps<FlowTriggerNodeData>
) {
  const nodeType = String(props.data?.nodeType ?? '');
  const paletteItem = nodePaletteItems.find(
    (o) => String(o.value) === nodeType
  );
  const def = nodeTypeByType[nodeType as NodeType];
  const isSelected = Boolean(props.selected);
  const { canEdit, transformGroups, onAddTransformFromSource } =
    useFlowConnectionFilter();

  const edges = useStore((s: any) =>
    Array.isArray(s?.edges) ? s.edges : []
  ) as Array<{
    source?: string;
  }>;

  const isConnected = useMemo(
    () => edges.some((e) => String(e.source ?? '') === props.id),
    [edges, props.id]
  );

  const circleClassName = cn(
    'bg-background relative flex h-14 w-14 cursor-default items-center justify-center rounded-full border p-0 shadow-sm outline-none transition-all',
    'border-border/50',
    'group-hover:shadow-md',
    'focus-visible:ring-primary/30 focus-visible:ring-2'
  );
  const circleContent = (
    <>
      <LogoOrIcon
        label={(paletteItem?.label ?? nodeType) || 'Trigger'}
        logoUrl={paletteItem?.logoUrl}
        Icon={getPhosphorIconByKey(
          paletteItem?.iconKey ?? 'DotsThreeOutline'
        )}
        sizePx={26}
        className='h-[26px] w-[26px]'
        iconClassName={cn(
          'h-[26px] w-[26px]',
          def?.ui?.headerText ?? 'text-muted-foreground'
        )}
      />

      {!isConnected && canEdit && onAddTransformFromSource ? (
        <span
          className={cn(
            'nodrag nopan absolute top-1/2 left-[calc(50%+17px)] z-30 h-5 w-5 -translate-y-1/2 rounded-md border-2 shadow-sm transition-all hover:scale-110',
            'flex items-center justify-center bg-white hover:bg-gray-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800'
          )}
          title='Add transform'
        >
          <IconPlus className='size-2.5' />
        </span>
      ) : null}
    </>
  );

  return (
    <div
      className={cn(
        // Trigger node: circle + labels (n8n-like)
        'group relative flex w-[120px] flex-col items-center',
        isSelected ? 'ring-primary/20 rounded-2xl ring-4' : ''
      )}
    >
      <div className='relative h-14 w-14'>
        <Handle
          type='source'
          id={`out:${nodeType}:0`}
          position={Position.Right}
          className='!h-4 !w-4 !border-0 !bg-transparent !opacity-0'
          style={{ top: '50%', right: -4 }}
        />

        {canEdit && onAddTransformFromSource ? (
          <FlowTransformPicker
            triggerNodeType={nodeType}
            groups={transformGroups}
            onSelect={(transform) =>
              onAddTransformFromSource({
                sourceNodeId: props.id,
                outType: nodeType,
                transform
              })
            }
            trigger={
              <button
                type='button'
                className={circleClassName}
                aria-label='Add transform'
              >
                {circleContent}
              </button>
            }
          />
        ) : (
          <div className={circleClassName}>{circleContent}</div>
        )}
      </div>

      {/* Labels */}
      <div className='mt-2 flex flex-col items-center text-center leading-tight'>
        <div className='max-w-[140px] truncate text-xs font-semibold'>
          {(paletteItem?.label ?? nodeType) || 'Node'}
        </div>
        <div className='text-muted-foreground text-[11px] font-semibold'>
          Trigger
        </div>
      </div>
    </div>
  );
});
