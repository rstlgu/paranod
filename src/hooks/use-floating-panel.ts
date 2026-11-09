'use client';

import * as React from 'react';

const MIN_FLOATING_WIDTH = 360;
const MIN_FLOATING_HEIGHT = 280;

interface FloatingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FloatingResizeEdges {
  top?: boolean;
  right?: boolean;
  bottom?: boolean;
  left?: boolean;
}

export const FLOATING_RESIZE_HANDLES = [
  {
    key: 'top',
    label: 'Resize from top',
    cursor: 'n-resize',
    edges: { top: true },
    className: 'top-0 right-3 left-3 h-1.5 cursor-n-resize'
  },
  {
    key: 'right',
    label: 'Resize from right',
    cursor: 'e-resize',
    edges: { right: true },
    className: 'top-3 right-0 bottom-3 w-1.5 cursor-e-resize'
  },
  {
    key: 'bottom',
    label: 'Resize from bottom',
    cursor: 's-resize',
    edges: { bottom: true },
    className: 'right-3 bottom-0 left-3 h-1.5 cursor-s-resize'
  },
  {
    key: 'left',
    label: 'Resize from left',
    cursor: 'w-resize',
    edges: { left: true },
    className: 'top-3 bottom-3 left-0 w-1.5 cursor-w-resize'
  },
  {
    key: 'top-left',
    label: 'Resize from top left',
    cursor: 'nw-resize',
    edges: { top: true, left: true },
    className: 'top-0 left-0 size-3 cursor-nw-resize'
  },
  {
    key: 'top-right',
    label: 'Resize from top right',
    cursor: 'ne-resize',
    edges: { top: true, right: true },
    className: 'top-0 right-0 size-3 cursor-ne-resize'
  },
  {
    key: 'bottom-right',
    label: 'Resize from bottom right',
    cursor: 'se-resize',
    edges: { right: true, bottom: true },
    className: 'right-0 bottom-0 size-3 cursor-se-resize'
  },
  {
    key: 'bottom-left',
    label: 'Resize from bottom left',
    cursor: 'sw-resize',
    edges: { bottom: true, left: true },
    className: 'bottom-0 left-0 size-3 cursor-sw-resize'
  }
] as const;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function fitFloatingRect(
  rect: FloatingRect,
  boundsWidth: number,
  boundsHeight: number
): FloatingRect {
  const minimumWidth = Math.min(MIN_FLOATING_WIDTH, boundsWidth);
  const minimumHeight = Math.min(MIN_FLOATING_HEIGHT, boundsHeight);
  const width = clamp(rect.width, minimumWidth, boundsWidth);
  const height = clamp(rect.height, minimumHeight, boundsHeight);

  return {
    x: clamp(rect.x, 0, Math.max(0, boundsWidth - width)),
    y: clamp(rect.y, 0, Math.max(0, boundsHeight - height)),
    width,
    height
  };
}

export function useFloatingPanel({
  isDetached,
  align = 'right',
  width = 544,
  height = 672
}: {
  isDetached: boolean;
  align?: 'left' | 'right';
  width?: number;
  height?: number;
}) {
  const floatingBoundsRef = React.useRef<HTMLDivElement | null>(null);
  const floatingPositionInitializedRef = React.useRef(false);
  const floatingInteractionCleanupRef = React.useRef<(() => void) | null>(null);
  const [floatingRect, setFloatingRect] = React.useState<FloatingRect>({
    x: 16,
    y: 16,
    width,
    height
  });

  React.useEffect(() => {
    if (!isDetached) return;

    const fitToBounds = () => {
      const bounds = floatingBoundsRef.current?.getBoundingClientRect();
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;

      setFloatingRect((current) => {
        const fitted = fitFloatingRect(current, bounds.width, bounds.height);
        if (floatingPositionInitializedRef.current) return fitted;

        floatingPositionInitializedRef.current = true;
        return {
          ...fitted,
          x:
            align === 'right'
              ? Math.max(0, bounds.width - fitted.width - 16)
              : Math.min(16, Math.max(0, bounds.width - fitted.width)),
          y: Math.min(16, Math.max(0, bounds.height - fitted.height))
        };
      });
    };

    const frame = window.requestAnimationFrame(fitToBounds);
    window.addEventListener('resize', fitToBounds);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', fitToBounds);
    };
  }, [isDetached, align]);

  React.useEffect(() => () => floatingInteractionCleanupRef.current?.(), []);

  const beginFloatingInteraction = React.useCallback(
    (
      event: React.PointerEvent<HTMLElement>,
      edges?: FloatingResizeEdges,
      cursor = 'move'
    ) => {
      if (!isDetached || event.button !== 0) return;

      if (!edges) {
        const target = event.target as HTMLElement;
        if (
          target.closest(
            'button, a, input, textarea, select, [role="button"], [role="combobox"], [contenteditable="true"]'
          )
        ) {
          return;
        }
      }

      const bounds = floatingBoundsRef.current?.getBoundingClientRect();
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;

      event.preventDefault();
      event.stopPropagation();
      floatingInteractionCleanupRef.current?.();

      const pointerId = event.pointerId;
      const originX = event.clientX;
      const originY = event.clientY;
      const startRect = fitFloatingRect(
        floatingRect,
        bounds.width,
        bounds.height
      );
      const previousUserSelect = document.body.style.userSelect;
      const previousCursor = document.body.style.cursor;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = cursor;

      let cleanup = () => {};
      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        moveEvent.preventDefault();

        const deltaX = moveEvent.clientX - originX;
        const deltaY = moveEvent.clientY - originY;

        if (!edges) {
          setFloatingRect({
            ...startRect,
            x: clamp(
              startRect.x + deltaX,
              0,
              Math.max(0, bounds.width - startRect.width)
            ),
            y: clamp(
              startRect.y + deltaY,
              0,
              Math.max(0, bounds.height - startRect.height)
            )
          });
          return;
        }

        const minimumWidth = Math.min(MIN_FLOATING_WIDTH, bounds.width);
        const minimumHeight = Math.min(MIN_FLOATING_HEIGHT, bounds.height);
        let left = startRect.x;
        let right = startRect.x + startRect.width;
        let top = startRect.y;
        let bottom = startRect.y + startRect.height;

        if (edges.left) {
          left = clamp(
            startRect.x + deltaX,
            0,
            Math.max(0, right - minimumWidth)
          );
        }
        if (edges.right) {
          right = clamp(
            startRect.x + startRect.width + deltaX,
            left + minimumWidth,
            bounds.width
          );
        }
        if (edges.top) {
          top = clamp(
            startRect.y + deltaY,
            0,
            Math.max(0, bottom - minimumHeight)
          );
        }
        if (edges.bottom) {
          bottom = clamp(
            startRect.y + startRect.height + deltaY,
            top + minimumHeight,
            bounds.height
          );
        }

        setFloatingRect({
          x: left,
          y: top,
          width: right - left,
          height: bottom - top
        });
      };
      const handlePointerEnd = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== pointerId) return;
        cleanup();
      };

      cleanup = () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerEnd);
        window.removeEventListener('pointercancel', handlePointerEnd);
        document.body.style.userSelect = previousUserSelect;
        document.body.style.cursor = previousCursor;
        if (floatingInteractionCleanupRef.current === cleanup) {
          floatingInteractionCleanupRef.current = null;
        }
      };

      floatingInteractionCleanupRef.current = cleanup;
      window.addEventListener('pointermove', handlePointerMove, {
        passive: false
      });
      window.addEventListener('pointerup', handlePointerEnd);
      window.addEventListener('pointercancel', handlePointerEnd);
    },
    [floatingRect, isDetached]
  );

  return { floatingBoundsRef, floatingRect, beginFloatingInteraction };
}
