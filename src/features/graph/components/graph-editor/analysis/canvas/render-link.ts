import type { AnalysisGraphLink, AnalysisGraphNode } from './analysis-transform';
import { getAnalysisCanvasFontFamily } from './canvas-font';

const MAX_EDGE_LABEL_WIDTH_PX = 220;
// LOD thresholds (zoom): lower = more zoomed out
const SHOW_LINK_WHEN_SCALE_GTE = 0.25;

export interface RenderLinkArgs {
  link: AnalysisGraphLink;
  ctx: CanvasRenderingContext2D;
  globalScale: number;
  isDark: boolean;
  getNodeById: (id: string) => AnalysisGraphNode | undefined;
  isHighlighted: (edgeId: string) => boolean;
  isSelected: (edgeId: string) => boolean;
  isHover: (edgeId: string) => boolean;
  isEndpointHovered: (edgeId: string) => boolean;
  isEndpointSelected: (edgeId: string) => boolean;
  isDeemphasized?: (edgeId: string) => boolean;
}

function shortenSegment(args: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  trimStart: number;
  trimEnd: number;
}) {
  const dx = args.x2 - args.x1;
  const dy = args.y2 - args.y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return {
    sx: args.x1 + ux * args.trimStart,
    sy: args.y1 + uy * args.trimStart,
    tx: args.x2 - ux * args.trimEnd,
    ty: args.y2 - uy * args.trimEnd,
    ux,
    uy,
    len
  };
}

function drawArrow(args: {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  ux: number;
  uy: number;
  length: number;
  width: number;
}) {
  const nx = -args.uy;
  const ny = args.ux;
  const x1 = args.x - args.ux * args.length + nx * args.width;
  const y1 = args.y - args.uy * args.length + ny * args.width;
  const x2 = args.x - args.ux * args.length - nx * args.width;
  const y2 = args.y - args.uy * args.length - ny * args.width;
  args.ctx.beginPath();
  args.ctx.moveTo(args.x, args.y);
  args.ctx.lineTo(x1, y1);
  args.ctx.lineTo(x2, y2);
  args.ctx.closePath();
  args.ctx.fill();
}

function makeOpaqueColor(color: string) {
  const c = String(color ?? '').trim();
  // If the edge color is rgba(..., a) keep the same rgb but force alpha=1 for marker end.
  const m =
    /^rgba\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]*\.?[0-9]+)\s*\)$/i.exec(
      c
    );
  if (m) return `rgb(${m[1]}, ${m[2]}, ${m[3]})`;
  return c;
}

function truncateTextToWidth(args: {
  ctx: CanvasRenderingContext2D;
  text: string;
  maxWidthPx: number;
}) {
  const text = String(args.text ?? '');
  const maxWidthPx = Math.max(0, Number(args.maxWidthPx) || 0);
  if (!text) return text;
  if (maxWidthPx <= 0) return '';

  if (args.ctx.measureText(text).width <= maxWidthPx) return text;

  const ellipsis = '…';
  const ellipsisW = args.ctx.measureText(ellipsis).width;
  if (ellipsisW >= maxWidthPx) return ellipsis;

  let lo = 0;
  let hi = text.length;
  let best = '';
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const prefix = text.slice(0, Math.max(0, mid)).trimEnd();
    const w = args.ctx.measureText(prefix + ellipsis).width;
    if (w <= maxWidthPx) {
      best = prefix;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best ? best + ellipsis : ellipsis;
}

function drawEdgeLabelOnEdge(args: {
  ctx: CanvasRenderingContext2D;
  globalScale: number;
  isDark: boolean;
  x: number;
  y: number;
  angleRad: number;
  text: string;
  isActive: boolean;
}) {
  const px = Math.max(6, 6.5 / Math.max(0.95, args.globalScale));
  const ctx = args.ctx;
  const rawText = String(args.text ?? '').toUpperCase();

  // Ruota lungo la direzione dell'edge e “incide” la linea sotto (stroke background)
  ctx.save();
  ctx.translate(args.x, args.y);
  ctx.rotate(args.angleRad);
  ctx.font = `600 ${px}px ${getAnalysisCanvasFontFamily()}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  const text = truncateTextToWidth({ ctx, text: rawText, maxWidthPx: MAX_EDGE_LABEL_WIDTH_PX });

  // Mantieni sempre testo leggibile (non capovolto)
  const normalized = ((args.angleRad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (normalized > Math.PI / 2 && normalized < (3 * Math.PI) / 2) {
    ctx.rotate(Math.PI);
  }

  // “Cut” line under label
  const cut = Math.max(3.5, 5 / Math.max(0.95, args.globalScale));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = args.isDark ? 'rgba(19, 19, 19, 0.76)' : 'rgba(255, 255, 255, 0.77)';
  ctx.lineWidth = cut;
  ctx.strokeText(text, 0, 0);

  ctx.fillStyle = args.isActive
    ? 'rgba(67, 56, 202, 1)'
    : args.isDark
      ? 'rgba(244, 244, 245, 0.85)'
      : 'rgba(24, 24, 27, 0.78)';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export function renderAnalysisLink({
  link,
  ctx,
  globalScale,
  isDark,
  getNodeById,
  isHighlighted,
  isSelected,
  isHover,
  isEndpointHovered,
  isEndpointSelected,
  isDeemphasized
}: RenderLinkArgs) {
  function getEndpointId(v: unknown) {
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    if (v && typeof v === 'object' && 'id' in v) return String((v as any).id ?? '');
    return '';
  }

  const sourceId = getEndpointId((link as any).source);
  const targetId = getEndpointId((link as any).target);
  const s = getNodeById(sourceId);
  const t = getNodeById(targetId);
  if (!s || !t) return;

  const highlighted = isHighlighted(link.id) || isEndpointHovered(link.id) || isEndpointSelected(link.id);
  const selected = isSelected(link.id);
  const hovered = isHover(link.id);
  const active = highlighted || selected || hovered;
  const dimmed = Boolean(isDeemphasized?.(link.id)) && !active;
  const isNormalGrey = !active && !dimmed;

  // LOD: hide links when zoomed far out (but keep active links visible).
  if (!active && globalScale < SHOW_LINK_WHEN_SCALE_GTE) return;

  const baseColor = link.color;
  const strokeColor = active
    ? '#4338ca'
    : dimmed
      ? isDark
        ? 'rgba(148, 163, 184, 0.30)'
        : 'rgba(100, 116, 139, 0.50)'
      : baseColor; // indigo-700
  // edge più spesso in generale + boost evidente su hover/selected
  // In Analysis: i link “normali” (grigi) devono essere leggermente più sottili,
  // senza toccare lo spessore di hover/selected/highlight.
  const baseW = isNormalGrey
    ? Math.min(2.6, Math.max(1.35, link.strokeWidth))
    : Math.min(3.0, Math.max(1.7, link.strokeWidth));
  const boost = selected ? 1.8 : hovered ? 1.4 : highlighted ? 1.15 : 0;
  const strokeWidth = baseW + boost;

  const startR = Math.max(6, s.nodeSize / 2);
  const endR = Math.max(6, t.nodeSize / 2);
  const arrowLength = Math.max(5, 6 / Math.max(0.95, globalScale));
  const arrowWidth = Math.max(3, 3.6 / Math.max(0.95, globalScale));

  // `lineCap: round` extends the drawn stroke beyond the path endpoint by ~lineWidth/2.
  // Compensate by trimming in graph units so the line stops at node border like the arrow.
  const widthPx = strokeWidth / Math.max(0.95, globalScale);
  const minPx = selected ? 2.6 : hovered ? 2.2 : highlighted ? 1.8 : isNormalGrey ? 1.0 : 1.2;
  const lineWidthPx = Math.max(minPx, widthPx);
  const capTrimGraph = (lineWidthPx / 2) / Math.max(0.001, globalScale);

  // Shorten to avoid drawing inside nodes + leave space for arrow
  const seg = shortenSegment({
    x1: s.x,
    y1: s.y,
    x2: t.x,
    y2: t.y,
    trimStart: startR + capTrimGraph,
    // Avvicina il marker al nodo target (meno padding rispetto a prima)
    trimEnd: endR + arrowLength * 0.15 + capTrimGraph
  });

  // Optional curvature for parallel edges
  const curvature = Number(link.curvature) || 0;
  const mx = (seg.sx + seg.tx) / 2;
  const my = (seg.sy + seg.ty) / 2;
  const nx = -seg.uy;
  const ny = seg.ux;
  const curveOffset = curvature * 80;
  const cx = mx + nx * curveOffset;
  const cy = my + ny * curveOffset;

  ctx.save();
  ctx.strokeStyle = strokeColor;
  if (dimmed) ctx.globalAlpha = 0.35;
  // Keep visible thickness across zoom levels (screen-space px),
  // and make hover/selected noticeably thicker.
  ctx.lineWidth = lineWidthPx;
  ctx.lineCap = 'round';

  if (active) {
    ctx.shadowColor = 'rgba(67, 56, 202, 0.30)';
    ctx.shadowBlur = (selected ? 16 : hovered ? 12 : 10) / Math.max(0.9, globalScale);
  }

  ctx.beginPath();
  if (Math.abs(curvature) > 1e-6) {
    ctx.moveTo(seg.sx, seg.sy);
    ctx.quadraticCurveTo(cx, cy, seg.tx, seg.ty);
  } else {
    ctx.moveTo(seg.sx, seg.sy);
    ctx.lineTo(seg.tx, seg.ty);
  }
  ctx.stroke();
  ctx.restore();

  // Arrow direction (approx)
  const dUx = Math.abs(curvature) > 1e-6 ? seg.tx - cx : seg.ux;
  const dUy = Math.abs(curvature) > 1e-6 ? seg.ty - cy : seg.uy;
  const dLen = Math.hypot(dUx, dUy) || 1;
  const ux = dUx / dLen;
  const uy = dUy / dLen;

  ctx.save();
  // markerEnd must be opaque even if edge stroke is rgba(..., alpha)
  ctx.fillStyle = makeOpaqueColor(strokeColor);
  if (dimmed) ctx.globalAlpha = 0.35;
  if (active) {
    ctx.shadowColor = 'rgba(67, 56, 202, 0.25)';
    ctx.shadowBlur = 8 / Math.max(0.9, globalScale);
  }
  drawArrow({ ctx, x: seg.tx, y: seg.ty, ux, uy, length: arrowLength, width: arrowWidth });
  ctx.restore();

  // Edge label: integrata sulla linea (ruotata), solo su hover/selection/node-selected e zoom ok.
  const label = link.label;
  const shouldShowLabel = !!label && active && globalScale >= 0.75;
  if (!shouldShowLabel) return;

  const lx =
    Math.abs(curvature) > 1e-6 ? (seg.sx + 2 * cx + seg.tx) / 4 : (seg.sx + seg.tx) / 2;
  const ly =
    Math.abs(curvature) > 1e-6 ? (seg.sy + 2 * cy + seg.ty) / 4 : (seg.sy + seg.ty) / 2;

  const angle = Math.atan2(seg.ty - seg.sy, seg.tx - seg.sx);
  drawEdgeLabelOnEdge({
    ctx,
    globalScale,
    isDark,
    x: lx,
    y: ly,
    angleRad: angle,
    text: label,
    isActive: active
  });
}
