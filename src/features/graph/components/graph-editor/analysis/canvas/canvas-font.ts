const FALLBACK_FONT_FAMILY =
  'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';

let cachedFontFamily: string | null = null;

export function getAnalysisCanvasFontFamily() {
  if (cachedFontFamily) return cachedFontFamily;
  if (typeof window === 'undefined') return FALLBACK_FONT_FAMILY;

  try {
    const el = document.body ?? document.documentElement;
    const family = window.getComputedStyle(el).fontFamily;
    const normalized = String(family ?? '').trim();
    cachedFontFamily = normalized.length ? normalized : FALLBACK_FONT_FAMILY;
    return cachedFontFamily;
  } catch {
    cachedFontFamily = FALLBACK_FONT_FAMILY;
    return cachedFontFamily;
  }
}
