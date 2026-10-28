export function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function pxToPercent(px: number, totalPx: number) {
  if (!Number.isFinite(totalPx) || totalPx <= 0) return 0;
  return (px / totalPx) * 100;
}
