'use client';
import { useGraphCanEdit } from '@/features/graph/contexts/graph-mutation-context';

import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRightIcon as IconArrowRight,
  BezierCurveIcon as IconVectorSpline,
  CaretRightIcon as IconChevronRight,
  LineSegmentIcon as IconLine,
  PaletteIcon as IconPalette,
  PenIcon as IconBorderStyle,
  TrashIcon as IconTrash,
  ArrowCounterClockwiseIcon as IconArrowBackUp,
  ArrowElbowRightUpIcon as IconArrowWaveRightUp
} from '@/components/icons';
import { useAdaptiveContextMenu } from '@/components/ui/adaptive-context-menu';

const edgeTypeOptions = [
  { value: 'default', label: 'Bezier', icon: IconVectorSpline },
  { value: 'straight', label: 'Straight', icon: IconLine },
  { value: 'smoothstep', label: 'Smooth Step', icon: IconArrowWaveRightUp }
] as const;

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

export interface AnalysisEdgeContextMenuProps {
  position: { x: number; y: number };
  onClose: () => void;
  onChangeColor: (color: string) => void;
  onChangeWidth: (width: number) => void;
  onChangeType: (type: 'default' | 'straight' | 'smoothstep') => void;
  onInvertDirection: () => void;
  onDelete: () => void;
}

export function AnalysisEdgeContextMenu(props: AnalysisEdgeContextMenuProps) {
  const canEdit = useGraphCanEdit();
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [activeSubmenu, setActiveSubmenu] = React.useState<'type' | 'color' | 'width' | null>(null);

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
      className='bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 w-52 rounded-md border p-1 shadow-md duration-100'
      style={menuStyle}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div
        className='relative'
        onMouseEnter={() => {
          if (!canEdit()) return;
          setActiveSubmenu('type');
        }}
        onMouseLeave={() => setActiveSubmenu(null)}
      >
        <button
          disabled={!canEdit()}
          className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        >
          <span className='flex items-center gap-2'>
            <IconVectorSpline className='h-4 w-4' />
            Line type
          </span>
          <IconChevronRight className='h-4 w-4' />
        </button>
        {activeSubmenu === 'type' ? (
          <div className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-1 w-44 rounded-md border p-1 shadow-md duration-100'>
            {edgeTypeOptions.map((opt) => (
              <button
                disabled={!canEdit()}
                key={opt.value}
                className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
                onClick={() => {
                  if (!canEdit()) return;
                  props.onChangeType(opt.value);
                  props.onClose();
                }}
              >
                <opt.icon className='h-4 w-4' />
                {opt.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div
        className='relative'
        onMouseEnter={() => {
          if (!canEdit()) return;
          setActiveSubmenu('color');
        }}
        onMouseLeave={() => setActiveSubmenu(null)}
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
        {activeSubmenu === 'color' ? (
          <div className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-1 w-44 rounded-md border p-1 shadow-md duration-100'>
            {edgeColorOptions.map((opt) => (
              <button
                disabled={!canEdit()}
                key={opt.value}
                className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
                onClick={() => {
                  if (!canEdit()) return;
                  props.onChangeColor(opt.value);
                  props.onClose();
                }}
              >
                <span className='h-3.5 w-3.5 rounded-full border' style={{ backgroundColor: opt.value }} />
                {opt.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div
        className='relative'
        onMouseEnter={() => {
          if (!canEdit()) return;
          setActiveSubmenu('width');
        }}
        onMouseLeave={() => setActiveSubmenu(null)}
      >
        <button
          disabled={!canEdit()}
          className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        >
          <span className='flex items-center gap-2'>
            <IconBorderStyle className='h-4 w-4' />
            Thickness
          </span>
          <IconChevronRight className='h-4 w-4' />
        </button>
        {activeSubmenu === 'width' ? (
          <div className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-1 w-44 rounded-md border p-1 shadow-md duration-100'>
            {edgeWidthOptions.map((opt) => (
              <button
                disabled={!canEdit()}
                key={String(opt.value)}
                className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none'
                onClick={() => {
                  if (!canEdit()) return;
                  props.onChangeWidth(opt.value);
                  props.onClose();
                }}
              >
                <span>{opt.label}</span>
                <span className='w-8 rounded bg-muted' style={{ height: opt.value * 1.2 }} />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className='my-1 h-px w-full bg-border/60' />

      <button
        disabled={!canEdit()}
        className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        onClick={() => {
          if (!canEdit()) return;
          props.onInvertDirection();
          props.onClose();
        }}
      >
        <IconArrowBackUp className='h-4 w-4' />
        Invert direction
      </button>

      <button
        className='disabled:opacity-50 disabled:pointer-events-none hover:bg-destructive/10 hover:text-destructive relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'
        disabled={!canEdit()}
        onClick={() => {
          if (!canEdit()) return;
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
