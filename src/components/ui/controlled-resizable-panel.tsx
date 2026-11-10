'use client';

import * as React from 'react';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import { ResizablePanel } from './resizable';

type Props = Omit<
  React.ComponentProps<typeof ResizablePanel>,
  'ref' | 'defaultSize' | 'onResize' | 'onCollapse' | 'onExpand' | 'collapsible'
> & {
  open: boolean;
  dragging?: boolean;
  onOpenChange: (open: boolean) => void;
  lastOpenSize: React.MutableRefObject<number>;
};

/** Keep layout callbacks from undoing a newer open/close command. */
export function ControlledResizablePanel({
  open,
  dragging = false,
  onOpenChange,
  lastOpenSize,
  minSize = 10,
  maxSize = 100,
  collapsedSize = 0,
  children,
  ...props
}: Props) {
  const panel = React.useRef<ImperativePanelHandle | null>(null);
  const registered = React.useRef(false);
  const setPanel = React.useCallback((handle: ImperativePanelHandle | null) => {
    panel.current = handle;
    if (!handle) registered.current = false;
  }, []);
  const applied = React.useRef<string | null>(null);
  const applying = React.useRef(false);
  const configuration = `${open}:${minSize}:${maxSize}:${collapsedSize}`;

  React.useLayoutEffect(() => {
    // During a gesture the library owns the size, including crossing the
    // collapsed threshold more than once. Resume command syncing on release.
    if (dragging) {
      applied.current = null;
      return;
    }
    const synchronize = () => {
      const handle = panel.current;
      if (!handle || !registered.current) return;
      applying.current = true;
      try {
        handle.resize(
          open
            ? Math.max(minSize, Math.min(maxSize, lastOpenSize.current))
            : collapsedSize
        );
        applied.current = configuration;
      } finally {
        applying.current = false;
      }
    };
    // Existing panels update before paint. Initial registration belongs to the
    // parent group, so finish that case in a cancellable frame.
    synchronize();
    if (applied.current === configuration) return;
    const frame = requestAnimationFrame(synchronize);
    return () => cancelAnimationFrame(frame);
  }, [
    collapsedSize,
    configuration,
    dragging,
    lastOpenSize,
    maxSize,
    minSize,
    open
  ]);

  return (
    <ResizablePanel
      {...props}
      ref={setPanel}
      defaultSize={open ? lastOpenSize.current : collapsedSize}
      collapsible
      collapsedSize={collapsedSize}
      minSize={open || dragging ? minSize : collapsedSize}
      maxSize={open || dragging ? maxSize : collapsedSize}
      onResize={(size) => {
        registered.current = true;
        if (dragging && !applying.current) {
          if (size <= collapsedSize + 0.5) {
            if (open) onOpenChange(false);
          } else if (size >= minSize - 0.5) {
            lastOpenSize.current = size;
            if (!open) onOpenChange(true);
          }
          return;
        }
        // Constraint changes and initial registration also emit resize events.
        // Only a settled, open panel can report a user resize/collapse.
        if (applying.current || applied.current !== configuration || !open)
          return;
        if (size <= collapsedSize + 0.5) onOpenChange(false);
        else if (size >= minSize - 0.5) lastOpenSize.current = size;
      }}
    >
      {children}
    </ResizablePanel>
  );
}
