'use client';

import {
  CaretRightIcon as IconChevronRight,
  CornersOutIcon as IconFitView,
  ColumnsIcon as IconLayoutDistributeHorizontal,
  PlusIcon as IconPlus,
  LightningIcon as IconTransform,
  TrashIcon as IconTrash,
  MagnifyingGlassPlusIcon as IconZoomIn,
  MagnifyingGlassMinusIcon as IconZoomOut
} from '@/components/icons';
import { useAdaptiveContextMenu } from '@/components/ui/adaptive-context-menu';
import { cn } from '@/lib/utils';
import * as React from 'react';
import { createPortal } from 'react-dom';

interface TransformItem {
  pluginId: string;
  pluginName: string;
  pluginIcon: string | null;
  pluginLogoUrl: string | null;
  transformId: string;
  name: string;
  description: string;
  inputType: string | null;
  outputTypes: string[] | null;
}

export interface FlowPaneContextMenuProps {
  position: { x: number; y: number };
  flowPosition: { x: number; y: number };
  onClose: () => void;
  onFitView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onApplyLayout: (next: { direction: 'LR' | 'TB' }) => void;
  onRequestClearFlow: () => void;
  onAddTransformHere: (
    t: TransformItem,
    client: { x: number; y: number }
  ) => void;
  paletteGroups: Array<{
    pluginId: string;
    pluginName: string;
    transforms: TransformItem[];
  }>;
}

export function FlowPaneContextMenu(props: FlowPaneContextMenuProps) {
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [isAddOpen, setIsAddOpen] = React.useState(false);
  const [activePluginId, setActivePluginId] = React.useState<string | null>(
    null
  );
  const submenuTimeoutRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    function handlePointer(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node))
        props.onClose();
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
      if (submenuTimeoutRef.current)
        window.clearTimeout(submenuTimeoutRef.current);
      document.removeEventListener('mousedown', handlePointer, true);
      document.removeEventListener('contextmenu', handlePointer, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [props]);

  function openAdd() {
    if (submenuTimeoutRef.current)
      window.clearTimeout(submenuTimeoutRef.current);
    setIsAddOpen(true);
  }

  function closeAddWithDelay() {
    submenuTimeoutRef.current = window.setTimeout(() => {
      setIsAddOpen(false);
      setActivePluginId(null);
    }, 150);
  }

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
      <div
        className='relative'
        onMouseEnter={openAdd}
        onMouseLeave={closeAddWithDelay}
      >
        <button className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'>
          <span className='flex flex-1 items-center gap-2 text-left'>
            <IconPlus className='h-4 w-4' />
            Add transform here
          </span>
          <IconChevronRight className='h-4 w-4' />
        </button>

        {isAddOpen ? (
          <div
            className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-56 rounded-md border p-1 shadow-md duration-100'
            onMouseEnter={() => {
              if (submenuTimeoutRef.current)
                window.clearTimeout(submenuTimeoutRef.current);
            }}
            onMouseLeave={closeAddWithDelay}
          >
            {props.paletteGroups.map((g) => (
              <div
                key={g.pluginId}
                className='relative'
                onMouseEnter={() => setActivePluginId(g.pluginId)}
              >
                <button className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'>
                  <span className='min-w-0 flex-1 truncate text-left'>
                    {g.pluginName}
                  </span>
                  <IconChevronRight className='h-4 w-4' />
                </button>

                {activePluginId === g.pluginId ? (
                  <div className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-64 rounded-md border p-1 shadow-md duration-100'>
                    {g.transforms.map((t) => (
                      <button
                        key={`${t.pluginId}:${t.transformId}`}
                        className={cn(
                          'hover:bg-accent hover:text-accent-foreground relative flex w-full min-w-0 cursor-default items-center justify-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'
                        )}
                        onClick={() => {
                          props.onAddTransformHere(t, {
                            x: props.position.x,
                            y: props.position.y
                          });
                          props.onClose();
                        }}
                      >
                        <IconTransform className='h-4 w-4' />
                        <span className='min-w-0 flex-1 truncate text-left whitespace-nowrap'>
                          {t.name}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className='bg-border -mx-1 my-1 h-px' />

      <button
        className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        onClick={() => {
          props.onFitView();
          props.onClose();
        }}
      >
        <IconFitView className='h-4 w-4' />
        Fit view
      </button>

      <button
        className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        onClick={() => {
          props.onZoomIn();
          props.onClose();
        }}
      >
        <IconZoomIn className='h-4 w-4' />
        Zoom in
      </button>

      <button
        className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        onClick={() => {
          props.onZoomOut();
          props.onClose();
        }}
      >
        <IconZoomOut className='h-4 w-4' />
        Zoom out
      </button>

      <div className='bg-border -mx-1 my-1 h-px' />

      <div className='text-muted-foreground px-2 py-1 text-[10px] font-semibold tracking-wide uppercase'>
        Layout
      </div>
      <button
        className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        onClick={() => {
          props.onApplyLayout({ direction: 'LR' });
          props.onClose();
        }}
      >
        <IconLayoutDistributeHorizontal className='h-4 w-4' />
        Left → Right
      </button>

      <div className='bg-border -mx-1 my-1 h-px' />

      <button
        className='text-destructive hover:bg-destructive/10 relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        onClick={() => {
          props.onRequestClearFlow();
          props.onClose();
        }}
      >
        <IconTrash className='h-4 w-4' />
        Clear flow
      </button>
    </div>,
    document.body
  );
}
