'use client';

import type { CSSProperties } from 'react';
import { BaseEdge, type EdgeProps, getBezierPath } from 'reactflow';

export function FlowEdge(props: EdgeProps) {
  const {
    id,
    selected,
    style,
    markerEnd,
    markerStart,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition
  } = props;

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition
  });

  const baseColor = (style as any)?.stroke ? String((style as any).stroke) : '#64748b';
  const baseWidth =
    typeof (style as any)?.strokeWidth === 'number'
      ? (style as any).strokeWidth
      : Number((style as any)?.strokeWidth ?? 2);

  // NOTE: `src/app/globals.css` enforces edge stroke via CSS variables with `!important`,
  // so we MUST set the vars here (parity with osint-edge).
  const selectedColor = '#4338ca'; // indigo-700
  const selectedWidth = baseWidth + 1;
  const edgeVars = {
    ...(style ?? {}),
    '--edge-stroke': baseColor,
    '--edge-width': baseWidth,
    '--edge-stroke-selected': selectedColor,
    '--edge-width-selected': selected ? selectedWidth : baseWidth
  } as CSSProperties;

  return (
    <>
      {selected ? (
        <BaseEdge
          id={`${id}-glow`}
          path={edgePath}
          style={{
            '--edge-stroke': selectedColor,
            '--edge-width': selectedWidth + 8,
            '--edge-stroke-selected': selectedColor,
            '--edge-width-selected': selectedWidth + 8,
            strokeLinecap: 'round',
            opacity: 0.18
          } as CSSProperties}
        />
      ) : null}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={edgeVars}
      />
    </>
  );
}
