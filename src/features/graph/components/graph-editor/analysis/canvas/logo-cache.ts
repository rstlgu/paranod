const imageCache = new Map<string, HTMLImageElement>();
const imageLoadPromises = new Map<string, Promise<HTMLImageElement>>();
const failedAt = new Map<string, number>();
const FAIL_TTL_MS = 60_000; // evita retry storm: 60s
const DEFAULT_RETRY_DELAY_MS = 1200;
const avgColorByUrl = new Map<string, string>();
const solidLogoByUrl = new Map<string, boolean>();

function isHex6Color(input: string) {
  const s = input.trim();
  if (s.length !== 7) return false;
  if (!s.startsWith('#')) return false;
  return /^[0-9a-fA-F]+$/.test(s.slice(1));
}

function shouldUseCrossOriginAnonymous(url: string) {
  if (typeof window === 'undefined') return true;
  try {
    const resolved = new URL(url, window.location.href);
    // Same-origin: lascia che il browser includa cookie/sessione (niente crossOrigin)
    if (resolved.origin === window.location.origin) return false;
    return true;
  } catch {
    // URL relativo o non parseabile: assumiamo same-origin
    return false;
  }
}

function canStartLoad(url: string, force?: boolean) {
  if (force) return true;
  const lastFail = failedAt.get(url);
  if (typeof lastFail === 'number' && Date.now() - lastFail < FAIL_TTL_MS) return false;
  return true;
}

function startLogoLoad(url: string, force?: boolean) {
  if (imageLoadPromises.has(url)) return imageLoadPromises.get(url);
  if (!canStartLoad(url, force)) return undefined;
  if (force) failedAt.delete(url);

  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    // Canvas: non usare lazy-loading su immagini non in DOM (può non partire mai).
    if (shouldUseCrossOriginAnonymous(url)) img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageCache.set(url, img);
      failedAt.delete(url);
      window.dispatchEvent(new CustomEvent('analysis-canvas-asset-loaded'));
      resolve(img);
    };
    img.onerror = () => {
      failedAt.set(url, Date.now());
      reject(new Error('logo load error'));
    };
    img.src = url;
  }).finally(() => {
    imageLoadPromises.delete(url);
  });
  imageLoadPromises.set(url, p);
  return p;
}

export function peekCachedLogo(url: string) {
  if (typeof window === 'undefined') return undefined;
  return imageCache.get(url);
}

export function getCachedLogoAverageColor(url: string) {
  if (typeof window === 'undefined') return undefined;
  return avgColorByUrl.get(url);
}

export function getCachedLogoIsSolid(url: string) {
  if (typeof window === 'undefined') return undefined;
  return solidLogoByUrl.get(url);
}

export function setCachedLogoAverageColor(url: string, colorHex: string) {
  if (typeof window === 'undefined') return;
  const c = String(colorHex ?? '').trim();
  if (!isHex6Color(c)) return;
  avgColorByUrl.set(url, c);
}

export function setCachedLogoIsSolid(url: string, isSolid: boolean) {
  if (typeof window === 'undefined') return;
  solidLogoByUrl.set(url, Boolean(isSolid));
}

export function getCachedLogo(url: string, args?: { force?: boolean }) {
  if (typeof window === 'undefined') return undefined;
  const cached = imageCache.get(url);
  if (cached) return cached;
  startLogoLoad(url, args?.force);
  return undefined;
}

export function loadLogo(url: string, args?: { force?: boolean }) {
  if (typeof window === 'undefined')
    return Promise.reject(new Error('logo load not available on server'));
  const cached = imageCache.get(url);
  if (cached) return Promise.resolve(cached);
  const existing = imageLoadPromises.get(url);
  if (existing) return existing;
  const started = startLogoLoad(url, args?.force);
  return started ?? Promise.reject(new Error('logo load not started'));
}

export function loadLogoWithRetry(
  url: string,
  args?: { maxAttempts?: number; retryDelayMs?: number }
) {
  const maxAttempts = Math.max(1, args?.maxAttempts ?? 2);
  const retryDelayMs = Math.max(200, args?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
  let attempt = 0;

  function wait(ms: number) {
    return new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), ms);
    });
  }

  function tryLoad(): Promise<HTMLImageElement> {
    attempt += 1;
    const force = attempt > 1;
    return loadLogo(url, { force }).catch(async (error) => {
      if (attempt >= maxAttempts) throw error;
      await wait(retryDelayMs);
      return tryLoad();
    });
  }

  return tryLoad();
}

function extractAverageColorHex(img: HTMLImageElement) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let r = 0;
    let g = 0;
    let b = 0;
    let r2 = 0;
    let g2 = 0;
    let b2 = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] ?? 0;
      if (alpha < 32) continue;
      const rr = data[i] ?? 0;
      const gg = data[i + 1] ?? 0;
      const bb = data[i + 2] ?? 0;
      r += rr;
      g += gg;
      b += bb;
      r2 += rr * rr;
      g2 += gg * gg;
      b2 += bb * bb;
      count += 1;
    }
    if (!count) return undefined;
    const rr = Math.round(r / count);
    const gg = Math.round(g / count);
    const bb = Math.round(b / count);
    const toHex = (v: number) => v.toString(16).padStart(2, '0');
    return `#${toHex(rr)}${toHex(gg)}${toHex(bb)}`;
  } catch {
    return undefined;
  }
}

function extractLogoColorInfo(img: HTMLImageElement) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    let r = 0;
    let g = 0;
    let b = 0;
    let r2 = 0;
    let g2 = 0;
    let b2 = 0;
    let count = 0;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] ?? 0;
      if (alpha < 32) continue;
      const rr = data[i] ?? 0;
      const gg = data[i + 1] ?? 0;
      const bb = data[i + 2] ?? 0;
      r += rr;
      g += gg;
      b += bb;
      r2 += rr * rr;
      g2 += gg * gg;
      b2 += bb * bb;
      count += 1;
    }

    if (!count) return undefined;
    const mr = r / count;
    const mg = g / count;
    const mb = b / count;
    const vr = Math.max(0, r2 / count - mr * mr);
    const vg = Math.max(0, g2 / count - mg * mg);
    const vb = Math.max(0, b2 / count - mb * mb);
    const std = Math.max(Math.sqrt(vr), Math.sqrt(vg), Math.sqrt(vb));

    const rr = Math.round(mr);
    const gg = Math.round(mg);
    const bb = Math.round(mb);
    const toHex = (v: number) => v.toString(16).padStart(2, '0');
    const avgHex = `#${toHex(rr)}${toHex(gg)}${toHex(bb)}`;

    // “Tinta unita”: varianza molto bassa su tutta l'immagine (es. loghi monocromatici)
    const isSolid = std <= 10;
    return { avgHex, isSolid };
  } catch {
    return undefined;
  }
}

export async function getOrComputeCachedLogoAverageColor(url: string) {
  if (typeof window === 'undefined') return undefined;
  const existing = getCachedLogoAverageColor(url);
  if (existing) return existing;
  try {
    await loadLogoWithRetry(url, { maxAttempts: 3, retryDelayMs: 900 });
  } catch {
    return undefined;
  }
  const img = peekCachedLogo(url);
  if (!img || !img.complete) return undefined;
  const info = extractLogoColorInfo(img);
  if (!info?.avgHex) return undefined;
  setCachedLogoAverageColor(url, info.avgHex);
  setCachedLogoIsSolid(url, info.isSolid);
  return info.avgHex;
}

export async function getOrComputeCachedLogoColorInfo(url: string) {
  if (typeof window === 'undefined') return undefined;
  const avgHex = await getOrComputeCachedLogoAverageColor(url);
  if (!avgHex) return undefined;
  const isSolid = getCachedLogoIsSolid(url) ?? false;
  return { avgHex, isSolid };
}
