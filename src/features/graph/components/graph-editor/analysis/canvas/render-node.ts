import type { AnalysisGraphNode } from './analysis-transform';
import { getAnalysisCanvasFontFamily } from './canvas-font';
import { nodeTypeByType } from '@/features/osint/node-registry';
import { getCachedTablerIcon } from './icon-cache';
import { getCachedLogo } from './logo-cache';

const MAX_NODE_LABEL_WIDTH_PX = 260;
// LOD thresholds (zoom): lower = more zoomed out
const SHOW_NODE_ICON_WHEN_SCALE_GTE = 0.45;

export interface RenderNodeArgs {
  node: AnalysisGraphNode;
  ctx: CanvasRenderingContext2D;
  globalScale: number;
  isDark: boolean;
  isHighlighted: (nodeId: string) => boolean;
  isSelected: (nodeId: string) => boolean;
  isHover: (nodeId: string) => boolean;
  isRunning?: (nodeId: string) => boolean;
  isDeemphasized?: (nodeId: string) => boolean;
  labelConfig?: {
    fontSizePx?: number;
    minPx?: number;
    showWhenScaleGte?: number;
  };
  tryPlaceLabelRect?: (rect: { x: number; y: number; w: number; h: number }) => boolean;
}

function parseHex6(input: string) {
  const raw = String(input ?? '').trim();
  const m = /^#([0-9a-fA-F]{6})$/.exec(raw);
  if (!m) return null;
  const hex = m[1] ?? '';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return { r, g, b };
}

function rgbToHex(rgb: { r: number; g: number; b: number }) {
  const toHex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function blendOverBase(args: {
  fg: { r: number; g: number; b: number };
  alpha: number;
  base: { r: number; g: number; b: number };
}) {
  const a = Math.max(0, Math.min(1, args.alpha));
  return {
    r: args.fg.r * a + args.base.r * (1 - a),
    g: args.fg.g * a + args.base.g * (1 - a),
    b: args.fg.b * a + args.base.b * (1 - a)
  };
}

function toOpaqueColor(input: string, baseHex: string) {
  const raw = String(input ?? '').trim();
  if (!raw) return 'rgb(148, 163, 184)';

  const hex8 = /^#([0-9a-fA-F]{8})$/.exec(raw);
  if (hex8) {
    // Convert #RRGGBBAA to opaque by blending over base (avoids bg==accent => invisible icons)
    const rrggbb = `#${hex8[1].slice(0, 6)}`;
    const aa = hex8[1].slice(6, 8);
    const fg = parseHex6(rrggbb);
    const base = parseHex6(baseHex);
    const alpha = parseInt(aa, 16) / 255;
    if (fg && base && Number.isFinite(alpha)) {
      return rgbToHex(blendOverBase({ fg, alpha, base }));
    }
    return rrggbb;
  }
  if (/^#([0-9a-fA-F]{6})$/.test(raw)) return raw;

  const rgba =
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/.exec(
      raw
    );
  if (rgba) {
    const r = Math.max(0, Math.min(255, Math.round(Number(rgba[1] ?? 0))));
    const g = Math.max(0, Math.min(255, Math.round(Number(rgba[2] ?? 0))));
    const b = Math.max(0, Math.min(255, Math.round(Number(rgba[3] ?? 0))));
    const a = rgba[4] !== undefined ? Number(rgba[4]) : 1;
    const base = parseHex6(baseHex);
    if (base && Number.isFinite(a) && a >= 0 && a < 1) {
      return rgbToHex(blendOverBase({ fg: { r, g, b }, alpha: a, base }));
    }
    return `rgb(${r}, ${g}, ${b})`;
  }

  return raw;
}

function drawRoundedRect(args: {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}) {
  const r = Math.max(0, Math.min(args.r, Math.min(args.w, args.h) / 2));
  const ctx = args.ctx;
  ctx.beginPath();
  ctx.moveTo(args.x + r, args.y);
  ctx.lineTo(args.x + args.w - r, args.y);
  ctx.quadraticCurveTo(args.x + args.w, args.y, args.x + args.w, args.y + r);
  ctx.lineTo(args.x + args.w, args.y + args.h - r);
  ctx.quadraticCurveTo(
    args.x + args.w,
    args.y + args.h,
    args.x + args.w - r,
    args.y + args.h
  );
  ctx.lineTo(args.x + r, args.y + args.h);
  ctx.quadraticCurveTo(args.x, args.y + args.h, args.x, args.y + args.h - r);
  ctx.lineTo(args.x, args.y + r);
  ctx.quadraticCurveTo(args.x, args.y, args.x + r, args.y);
  ctx.closePath();
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

  // Binary search longest prefix that fits with ellipsis
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

export function renderAnalysisNode({
  node,
  ctx,
  globalScale,
  isDark,
  isHighlighted,
  isSelected,
  isHover,
  isRunning,
  isDeemphasized,
  labelConfig,
  tryPlaceLabelRect
}: RenderNodeArgs) {
  // Min size leggermente più grande (richiesto) per migliorare leggibilità in Analysis.
  const size = Math.max(18, Number(node.nodeSize) || 20);
  const radius = size / 2;

  const highlighted = isHighlighted(node.id);
  const selected = isSelected(node.id);
  const hovered = isHover(node.id);
  const dimmed = Boolean(isDeemphasized?.(node.id)) && !(highlighted || selected || hovered);
  const base = isDark ? '#09090b' : '#ffffff';

  // Highlight ring
  if (!dimmed && (highlighted || selected || hovered)) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius + 1.6, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(67, 56, 202, 0.85)'; // indigo-700
    ctx.lineWidth = Math.max(1.5, 2 / Math.max(0.6, globalScale));
    ctx.shadowColor = 'rgba(67, 56, 202, 0.35)';
    ctx.shadowBlur = 8 / Math.max(0.95, globalScale);
    ctx.stroke();
    ctx.restore();
  }

  // Body: match OSINT header vibe (tinted bg + accent stroke)
  ctx.save();
  if (dimmed) ctx.globalAlpha = 0.42;
  const accent = dimmed
    ? isDark
      ? 'rgba(148, 163, 184, 0.40)'
      : 'rgba(148, 163, 184, 0.70)'
    : toOpaqueColor(String((node as any).nodeColor ?? '#94a3b8'), base);
  const accentRgb = parseHex6(accent);
  // In analysis, the "tinted" bg coming from tokens is often very low-alpha (#...15),
  // which becomes almost invisible once made opaque. For logo-nodes we want the fill to be visible.
  const hasLogoUrl =
    typeof (node as any).nodeLogoUrl === 'string' && Boolean((node as any).nodeLogoUrl);
  const baseRgb = parseHex6(base);
  const bg =
    dimmed
      ? isDark
        ? 'rgba(244, 244, 245, 0.06)'
        : 'rgba(24, 24, 27, 0.05)'
      : accentRgb && baseRgb && hasLogoUrl
      ? rgbToHex(blendOverBase({ fg: accentRgb, alpha: isDark ? 0.26 : 0.22, base: baseRgb }))
      : toOpaqueColor(String((node as any).nodeBgColor ?? accent ?? '#94a3b8'), base);
  ctx.beginPath();
  ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();
  // border accent (helps visibility since bg is low-alpha)
  ctx.beginPath();
  ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1, 1.4 / Math.max(0.7, globalScale));
  ctx.strokeStyle = accent;
  ctx.stroke();
  ctx.restore();

  // Subtle outline for contrast
  ctx.beginPath();
  ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1, 1.1 / Math.max(0.7, globalScale));
  ctx.strokeStyle = dimmed
    ? isDark
      ? 'rgba(148, 163, 184, 0.18)'
      : 'rgba(148, 163, 184, 0.22)'
    : isDark
      ? 'rgba(255,255,255,0.10)'
      : 'rgba(0,0,0,0.12)';
  ctx.stroke();

  // LOD: hide logos/icons earlier than labels (but keep them when active).
  const shouldShowIcon =
    globalScale >= SHOW_NODE_ICON_WHEN_SCALE_GTE || selected || hovered || highlighted;
  if (shouldShowIcon) {
    // Logo (preferito all'icona) - usa /api/logo come in OSINTNode
    const logoUrl = node.nodeLogoUrl;
    const logoImg =
      typeof logoUrl === 'string' && logoUrl.length ? getCachedLogo(logoUrl) : undefined;
    if (logoImg && logoImg.complete) {
      const pad = Math.max(2, radius * 0.18);
      const box = (radius - pad) * 2;

      // contain
      const iw = logoImg.naturalWidth || logoImg.width || 1;
      const ih = logoImg.naturalHeight || logoImg.height || 1;
      const scale = Math.min(box / iw, box / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const dx = node.x - dw / 2;
      const dy = node.y - dh / 2;

      ctx.save();
      if (dimmed) ctx.globalAlpha = 0.32;
      // Backing disc to keep logo readable even when fill is close to logo colors (common for monochrome brands)
      ctx.beginPath();
      ctx.arc(node.x, node.y, Math.max(2, radius - 2), 0, Math.PI * 2);
      ctx.fillStyle = base;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius - 1, 0, Math.PI * 2);
      ctx.clip();
      try {
        ctx.drawImage(logoImg, dx, dy, dw, dh);
      } catch {}
      ctx.restore();
    } else {
      const def = (nodeTypeByType as any)[node.nodeType];
      const Icon = def?.icon as any;
      if (Icon) {
        const iconSize = Math.max(14, Math.min(26, Math.round(radius * 1.2)));
        const iconColor = String(
          (node as any).nodeIconColor ?? accent ?? (isDark ? '#ffffff' : '#111827')
        );
        const img = getCachedTablerIcon({ icon: Icon, sizePx: iconSize, color: iconColor });
        if (img && img.complete) {
          try {
            ctx.save();
            ctx.globalAlpha = dimmed ? 0.28 : 0.92;
            ctx.drawImage(img, node.x - iconSize / 2, node.y - iconSize / 2, iconSize, iconSize);
            ctx.restore();
          } catch {}
        }
      }
    }
  }

  // Merged badge (shows merged child count like ReactFlow node)
  const mergedChildCount = (() => {
    const meta: any = ((node as any)?.rfNode as any)?.data?.metadata ?? {};
    const direct = Number(meta?.mergedChildCount);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const fromPayload = Array.isArray(meta?.__merge?.nodeIds) ? meta.__merge.nodeIds.length : 0;
    return Number.isFinite(fromPayload) ? Number(fromPayload) : 0;
  })();
  if (!dimmed && mergedChildCount > 1) {
    const badgePx = Math.max(12, 14 / Math.max(0.65, globalScale));
    const padX = Math.max(4, 5 / Math.max(0.65, globalScale));
    const padY = Math.max(2, 3 / Math.max(0.65, globalScale));
    const text = String(Math.min(999, Math.floor(mergedChildCount)));

    ctx.save();
    ctx.font = `800 ${Math.max(9, badgePx * 0.62)}px ${getAnalysisCanvasFontFamily()}`;
    const tw = ctx.measureText(text).width;
    const w = Math.max(badgePx, tw + padX * 2);
    const h = badgePx;
    const x = node.x + radius * 0.62;
    const y = node.y - radius * 0.9;

    drawRoundedRect({ ctx, x, y, w, h, r: h / 2 });
    ctx.fillStyle = 'rgba(79, 70, 229, 0.95)'; // indigo-600
    ctx.fill();
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 1 / Math.max(0.9, globalScale);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2 + 0.5 / Math.max(0.9, globalScale));
    ctx.restore();
  }

  if (isRunning?.(node.id)) {
    const badgeRadius = Math.max(6.5, 8 / Math.max(0.75, globalScale));
    const centerX = node.x - radius * 0.72;
    const centerY = node.y - radius * 0.72;
    const spinnerRadius = badgeRadius * 0.56;
    const rotation = (Date.now() / 820) * Math.PI * 2;
    const secondary = isDark ? 'rgb(23, 23, 23)' : 'rgb(245, 245, 245)';
    const secondaryForeground = isDark ? 'rgb(250, 250, 250)' : 'rgb(24, 24, 27)';

    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, badgeRadius, 0, Math.PI * 2);
    ctx.fillStyle = secondary;
    ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(15, 23, 42, 0.22)';
    ctx.shadowBlur = 7 / Math.max(0.75, globalScale);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = isDark ? 'rgba(250,250,250,0.18)' : 'rgba(24,24,27,0.16)';
    ctx.lineWidth = 1 / Math.max(0.75, globalScale);
    ctx.stroke();

    // Traccia completa + arco corto: la rotazione resta leggibile anche sui nodi piccoli.
    ctx.beginPath();
    ctx.arc(centerX, centerY, spinnerRadius, 0, Math.PI * 2);
    ctx.strokeStyle = isDark ? 'rgba(250,250,250,0.22)' : 'rgba(24,24,27,0.18)';
    ctx.lineWidth = 2 / Math.max(0.65, globalScale);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(centerX, centerY, spinnerRadius, rotation, rotation + Math.PI * 0.62);
    ctx.strokeStyle = secondaryForeground;
    ctx.lineWidth = 2.2 / Math.max(0.65, globalScale);
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  // Label (LOD): show when zoomed-in OR selected/hovered
  const minScale =
    typeof labelConfig?.showWhenScaleGte === 'number' ? labelConfig.showWhenScaleGte : 0.9;
  const shouldShowLabel = globalScale >= minScale || selected || hovered;
  if (!shouldShowLabel) return;

  const label = String(node.nodeLabel ?? '').trim();
  const fontSizePx =
    typeof labelConfig?.fontSizePx === 'number' ? labelConfig.fontSizePx : 12;
  const minPx = typeof labelConfig?.minPx === 'number' ? labelConfig.minPx : 10;
  const px = Math.max(minPx, fontSizePx / Math.max(0.65, globalScale));
  ctx.save();
  if (dimmed) ctx.globalAlpha = 0.28;
  ctx.font = `500 ${px}px ${getAnalysisCanvasFontFamily()}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  const text = label.length ? label : ' ';
  const paddingX = Math.max(7, 9 / Math.max(0.8, globalScale));
  const paddingY = Math.max(3, 5 / Math.max(0.8, globalScale));
  const maxTextW = Math.max(18, MAX_NODE_LABEL_WIDTH_PX - paddingX * 2);
  const truncatedText = label.length ? truncateTextToWidth({ ctx, text, maxWidthPx: maxTextW }) : text;
  const textWidth = ctx.measureText(truncatedText).width;
  const boxW = Math.min(MAX_NODE_LABEL_WIDTH_PX, Math.max(26, textWidth + paddingX * 2));
  const boxH = px + paddingY * 2;

  const x = node.x - boxW / 2;
  // Sovrapponi leggermente la label al cerchio
  // bgY ≈ node.y + radius*0.15 (leggermente sovrapposta) + fontSize*0.3 (meno separata)
  // Più "appoggiata" al nodo, non staccata
  const y = node.y + radius * 0.15 + px * 0.45;

  if (tryPlaceLabelRect) {
    const ok = tryPlaceLabelRect({ x, y, w: boxW, h: boxH });
    if (!ok) {
      ctx.restore();
      return;
    }
  }


  // Badge stile OSINT-edge label: bg neutro + bordo + (selected) ring indigo
  const borderRadius = 8 / Math.max(0.95, globalScale);
  const isActive = !dimmed && (selected || hovered);
  const strokeNeutral = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
  const ringStroke = 'rgba(79, 70, 229, 0.85)'; // indigo-600-ish

  if (isActive) {
    drawRoundedRect({
      ctx,
      x: x - 2 / Math.max(0.95, globalScale),
      y: y - 2 / Math.max(0.95, globalScale),
      w: boxW + 4 / Math.max(0.95, globalScale),
      h: boxH + 4 / Math.max(0.95, globalScale),
      r: borderRadius + 2 / Math.max(0.95, globalScale)
    });
    ctx.save();
    ctx.strokeStyle = ringStroke;
    ctx.lineWidth = 2 / Math.max(1, globalScale);
    ctx.shadowColor = 'rgba(79, 70, 229, 0.22)';
    ctx.shadowBlur = 8 / Math.max(0.95, globalScale);
    ctx.stroke();
    ctx.restore();
  }

  drawRoundedRect({ ctx, x, y, w: boxW, h: boxH, r: borderRadius });
  ctx.fillStyle = dimmed
    ? isDark
      ? 'rgba(24, 24, 27, 0.85)'
      : 'rgba(255, 255, 255, 0.85)'
    : isDark
      ? 'rgb(24, 24, 27)'
      : 'rgb(255, 255, 255)';
  ctx.strokeStyle = dimmed
    ? isDark
      ? 'rgba(148, 163, 184, 0.20)'
      : 'rgba(148, 163, 184, 0.26)'
    : isActive
      ? ringStroke
      : strokeNeutral;
  ctx.lineWidth = 1 / Math.max(0.95, globalScale);
  ctx.shadowColor = isDark ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.16)';
  ctx.shadowBlur = 8 / Math.max(0.95, globalScale);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();

  ctx.fillStyle = dimmed
    ? isDark
      ? 'rgba(148, 163, 184, 0.70)'
      : 'rgba(100, 116, 139, 0.85)'
    : isDark
      ? 'rgb(244, 244, 245)'
      : 'rgb(24, 24, 27)';
  ctx.fillText(truncatedText, node.x, y + boxH / 2);
  ctx.restore();
}
