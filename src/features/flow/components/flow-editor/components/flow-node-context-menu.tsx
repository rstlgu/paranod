'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  PlusIcon as IconPlus,
  CornersOutIcon as IconFitView,
  ArrowSquareOutIcon as IconOpen,
  PlusIcon as IconDuplicate,
  TrashIcon as IconTrash,
} from '@/components/icons';
import { useAdaptiveContextMenu } from '@/components/ui/adaptive-context-menu';
import { getEntityConfig } from '@/features/graph/config/entity-config';

export interface FlowNodeContextMenuProps {
  position: { x: number; y: number };
  nodeId: string;
  nodeLabel: string;
  nodeType: 'transform' | 'trigger';
  triggerNodeType?: string | null;
  transformOutputTypes?: string[] | null;
  onClose: () => void;
  onOpenTransform: () => void;
  onFitNode: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAddTransformForInputType: (inputType: string) => void;
}

export function FlowNodeContextMenu(props: FlowNodeContextMenuProps) {
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handlePointer(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) props.onClose();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') props.onClose();
    }

    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', handlePointer, true);
      document.addEventListener('contextmenu', handlePointer, true);
      document.addEventListener('keydown', handleKeyDown);
    }, 0);

    return () => {
      window.clearTimeout(timer);
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

  return createPortal(
    <div
      ref={menuRef}
      className='bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 w-56 rounded-md border p-1 shadow-md duration-100'
      style={menuStyle}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className='px-2 py-1 text-[10px] font-semibold tracking-wide uppercase text-muted-foreground'>
        {props.nodeLabel || 'Node'}
      </div>
      <div className='bg-border -mx-1 my-1 h-px' />

      {props.nodeType === 'trigger' ? (
        <button
          className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
          onClick={() => {
            const t = props.triggerNodeType ? String(props.triggerNodeType) : '';
            if (t) props.onAddTransformForInputType(t);
            props.onClose();
          }}
        >
          <IconPlus className='h-4 w-4' />
          Add Transform
        </button>
      ) : null}

      {props.nodeType === 'transform' ? (
        <>
          <button
            className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
            onClick={() => {
              props.onOpenTransform();
              props.onClose();
            }}
          >
            <IconOpen className='h-4 w-4' />
            Open Transform
          </button>

          <div className='bg-border -mx-1 my-1 h-px' />

          {Array.from(
            new Set((props.transformOutputTypes ?? []).map((t) => String(t)).filter(Boolean))
          ).length > 0 ? (
            <div className='px-2 py-1.5'>
              <div className='text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase'>
                Add Transform
              </div>
              <div className='space-y-1'>
                {Array.from(
                  new Set((props.transformOutputTypes ?? []).map((t) => String(t)).filter(Boolean))
                ).map((t) => {
                  const cfg = getEntityConfig(t);
                  const Icon = cfg.icon as any;
                  return (
                    <button
                      key={`add:${t}`}
                      className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
                      onClick={() => {
                        props.onAddTransformForInputType(t);
                        props.onClose();
                      }}
                    >
                      {Icon ? <Icon className='h-4 w-4 text-muted-foreground' /> : <IconPlus className='h-4 w-4' />}
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <button
              className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
              onClick={() => {
                props.onClose();
              }}
            >
              <IconPlus className='h-4 w-4' />
              Add Transform
            </button>
          )}
        </>
      ) : null}

      <button
        className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        onClick={() => {
          props.onFitNode();
          props.onClose();
        }}
      >
        <IconFitView className='h-4 w-4' />
        Fit to node
      </button>

      <button
        className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        onClick={() => {
          props.onDuplicate();
          props.onClose();
        }}
      >
        <IconDuplicate className='h-4 w-4' />
        Duplicate
      </button>

      <div className='bg-border -mx-1 my-1 h-px' />

      <button
        className='text-destructive hover:bg-destructive/10 relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        onClick={() => {
          props.onDelete();
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
