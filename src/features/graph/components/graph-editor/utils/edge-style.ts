export const EDGE_THICKNESS_OPTIONS = [
  { value: 2, label: 'Thin' },
  { value: 3, label: 'Medium' },
  { value: 4.5, label: 'Thick' }
] as const;

export const DEFAULT_EDGE_STROKE_WIDTH =
  EDGE_THICKNESS_OPTIONS.find((option) => option.label === 'Medium')?.value ??
  EDGE_THICKNESS_OPTIONS[0].value;

// Flow units, same space as the stroke. Longer than it is tall, so a thick
// edge ends in a point instead of a wedge as tall as the line.
export const EDGE_ARROW_LENGTH_PX = 8;
export const EDGE_ARROW_HEIGHT_PX = 6;

export const EDGE_ARROW_SIZE_OPTIONS = [
  { value: 1, label: 'Normal' },
  { value: 1.5, label: 'Large' },
  { value: 2, label: 'Extra large' }
] as const;

export function getEdgeArrowScale(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(2, Math.max(1, value))
    : 1;
}

type EdgeHandleSide = 'left' | 'right' | 'top' | 'bottom';

// Pulls an endpoint off the node border so the stroke stops at the arrow base
// and the tip, not the line cap, meets the node.
export function insetEdgeEndpoint(
  x: number,
  y: number,
  side: EdgeHandleSide,
  distance: number
) {
  if (side === 'left') return { x: x - distance, y };
  if (side === 'right') return { x: x + distance, y };
  if (side === 'top') return { x, y: y - distance };
  return { x, y: y + distance };
}
