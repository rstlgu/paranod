'use client';

import { useCallback } from 'react';
import { BaseEdge, type EdgeProps, getStraightPath, Position, useStore } from 'reactflow';
import { useHoverStore } from '@/features/graph/components/graph-editor/analysis/state/hover-store';

function getNodeCenter(node: any) {
  if (!node?.positionAbsolute) return null;
  const w =
    node.width ||
    node.measured?.width ||
    (typeof node.style?.width === 'number' ? node.style.width : null) ||
    node.data?._relationalSize ||
    20;
  const h =
    node.height ||
    node.measured?.height ||
    (typeof node.style?.height === 'number' ? node.style.height : null) ||
    node.data?._relationalSize ||
    20;
  return { x: node.positionAbsolute.x + w / 2, y: node.positionAbsolute.y + h / 2, radius: Math.min(w, h) / 2 };
}

function getCircleIntersection(
  center: { x: number; y: number; radius: number },
  targetCenter: { x: number; y: number }
) {
  const dx = targetCenter.x - center.x;
  const dy = targetCenter.y - center.y;
  const angle = Math.atan2(dy, dx);
  return {
    x: center.x + Math.cos(angle) * center.radius,
    y: center.y + Math.sin(angle) * center.radius,
    position:
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0
          ? Position.Right
          : Position.Left
        : dy > 0
          ? Position.Bottom
          : Position.Top
  };
}

function pickLabel(data: any) {
  const raw = String(data?.label ?? data?.relationship ?? '').trim();
  return raw.length ? raw : null;
}

export function AnalysisEdge(props: EdgeProps<any>) {
  const { id, source, target, style, selected, data } = props;

  const hoveredNodeId = useHoverStore((s) => s.hoveredNodeId);
  const hoveredEdgeId = useHoverStore((s) => s.hoveredEdgeId);
  const setHoveredEdgeId = useHoverStore((s) => s.setHoveredEdgeId);

  const isEdgeHovered = hoveredEdgeId === id;
  const isNodeHovered = hoveredNodeId === source || hoveredNodeId === target;
  // Evidenzia se: Selezionato OR Hover su Edge OR Hover su Nodo collegato
  const isHighlighted = selected || isEdgeHovered || isNodeHovered;

  const sourceNode = useStore(useCallback((s: any) => s.nodeInternals.get(source), [source]));
  const targetNode = useStore(useCallback((s: any) => s.nodeInternals.get(target), [target]));
  if (!sourceNode || !targetNode) return null;

  const sourceCenter = getNodeCenter(sourceNode);
  const targetCenter = getNodeCenter(targetNode);
  if (!sourceCenter || !targetCenter) return null;

  const sourcePoint = getCircleIntersection(sourceCenter, targetCenter);
  const targetPoint = getCircleIntersection(targetCenter, sourceCenter);

  const [edgePath] = getStraightPath({
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    targetX: targetPoint.x,
    targetY: targetPoint.y
  });

  const baseStroke =
    (style as any)?.stroke ?? String((data as any)?.color ?? 'rgba(148, 163, 184, 0.9)');
  const baseWidth = (style as any)?.strokeWidth ?? 1.2;

  // Colore e larghezza dinamici in base a evidenziazione
  const strokeColor = isHighlighted ? '#4338ca' : baseStroke; // indigo-700
  const displayWidth = isHighlighted ? 2 : baseWidth;

  const pathId = `analysis-edge-path-${id}`;
  const glowId = `analysis-edge-glow-${id}`;
  const arrowId = `analysis-edge-arrow-${id}`;

  const label = pickLabel(data);
  // Mostra label solo se evidenziato (hover o selezione)
  const showLabel = isHighlighted && label;

  const labelFill = isHighlighted
    ? 'rgba(67, 56, 202, 1)'
    : 'rgba(71, 85, 105, 1)'; // indigo / slate

  return (
    <>
      <defs>
        <path id={pathId} d={edgePath} />

        <filter id={glowId} x='-50%' y='-50%' width='200%' height='200%'>
          <feGaussianBlur in='SourceGraphic' stdDeviation='1.5' result='blur' />
          <feFlood floodColor='#4338ca' floodOpacity='0.4' result='color' />
          <feComposite in='color' in2='blur' operator='in' result='coloredBlur' />
          <feMerge>
            <feMergeNode in='coloredBlur' />
            <feMergeNode in='SourceGraphic' />
          </feMerge>
        </filter>

        <marker
          id={arrowId}
          markerWidth={isHighlighted ? 6 : 5}
          markerHeight={isHighlighted ? 6 : 5}
          viewBox='0 0 10 10'
          orient='auto'
          refX='9'
          refY='5'
          markerUnits='userSpaceOnUse'
        >
          <path
            d='M 0 0 L 10 5 L 0 10 z'
            fill={strokeColor}
            style={{
              transition: 'fill 0.2s ease',
              filter: isHighlighted ? 'drop-shadow(0 0 1px rgba(67, 56, 202, 0.4))' : undefined
            }}
          />
        </marker>
      </defs>

      {/* Replaced BaseEdge with explicit path to ensure style application */}
      <path
        id={id}
        d={edgePath}
        className="react-flow__edge-path"
        fill="none"
        stroke={strokeColor}
        strokeWidth={displayWidth}
        strokeLinecap={(style?.strokeLinecap as any) ?? 'round'}
        strokeDasharray={style?.strokeDasharray}
        markerEnd={`url(#${arrowId})`}
        style={{
          transition: 'stroke 0.2s ease, stroke-width 0.2s ease',
          filter: isHighlighted ? `url(#${glowId})` : undefined,
          opacity: style?.opacity
        }}
      />

      {/* Custom Interaction Path with correct class for selection */}
      <path
        d={edgePath}
        stroke="transparent"
        strokeWidth={20}
        fill="none"
        className="react-flow__edge-interaction"
        onMouseEnter={() => setHoveredEdgeId(id)}
        onMouseLeave={() => setHoveredEdgeId(null)}
        style={{ cursor: 'pointer' }}
      />

      {showLabel ? (
        <text
          style={{
            pointerEvents: 'none',
            fontSize: 9,
            fontWeight: 500,
            userSelect: 'none',
            fontFamily: 'var(--font-sans)',
            letterSpacing: '0.01em',
            transition: 'opacity 0.2s ease'
          }}
        >
          <textPath
            href={`#${pathId}`}
            startOffset='50%'
            textAnchor='middle'
            dominantBaseline='middle'
            fill={labelFill}
            stroke='var(--canvas-overlay, var(--canvas, #ffffff))'
            strokeWidth={3}
            paintOrder='stroke'
          >
            {label}
          </textPath>
        </text>
      ) : null}
    </>
  );
}
