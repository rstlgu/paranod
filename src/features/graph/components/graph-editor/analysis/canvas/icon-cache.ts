import * as React from 'react';
import type { Icon } from '@tabler/icons-react';
import { renderToStaticMarkup } from 'react-dom/server';

const imageCache = new Map<string, HTMLImageElement>();
const imageLoadPromises = new Map<string, Promise<HTMLImageElement>>();

function svgToDataUrl(svg: string) {
  const utf8 = encodeURIComponent(svg).replace(/%([0-9A-F]{2})/g, (_, p1) =>
    String.fromCharCode(parseInt(p1, 16))
  );
  return `data:image/svg+xml;base64,${btoa(utf8)}`;
}

async function buildIconSvg(args: { Icon: Icon; sizePx: number; color: string }) {
  try {
    const svg = renderToStaticMarkup(
      React.createElement(args.Icon as any, {
        size: args.sizePx,
        color: args.color,
        stroke: 2,
        style: { display: 'block' }
      }) as any
    );
    return svg;
  } catch {
    return `<svg xmlns="http://www.w3.workspace/2000/svg" width="${args.sizePx}" height="${args.sizePx}" viewBox="0 0 24 24" fill="none" stroke="${args.color}" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`;
  }
}

export function getCachedTablerIcon(args: { icon: Icon; sizePx: number; color: string }) {
  // Icone solo in browser (Canvas)
  if (typeof window === 'undefined') return undefined;

  const key = `${args.color}__${args.sizePx}__${(args.icon as any)?.displayName ?? (args.icon as any)?.name ?? 'icon'}`;
  const cached = imageCache.get(key);
  if (cached) return cached;

  // kick off load (dedup)
  if (!imageLoadPromises.has(key)) {
    const p = (async () => {
      const svg = await buildIconSvg({ Icon: args.icon, sizePx: args.sizePx, color: args.color });
      const img = new Image();
      img.decoding = 'async';
      // Canvas: non usare lazy-loading su immagini non in DOM (può non partire mai).
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('icon load error'));
        img.src = svgToDataUrl(svg);
      });
      imageCache.set(key, img);
      window.dispatchEvent(new CustomEvent('analysis-canvas-asset-loaded'));
      return img;
    })().finally(() => {
      imageLoadPromises.delete(key);
    });
    imageLoadPromises.set(key, p);
  }

  return undefined;
}

export function loadTablerIcon(args: { icon: Icon; sizePx: number; color: string }) {
  const key = `${args.color}__${args.sizePx}__${(args.icon as any)?.displayName ?? (args.icon as any)?.name ?? 'icon'}`;
  const cached = imageCache.get(key);
  if (cached) return Promise.resolve(cached);
  const existing = imageLoadPromises.get(key);
  if (existing) return existing;
  // trigger load by calling getCachedTablerIcon
  getCachedTablerIcon(args);
  return imageLoadPromises.get(key) ?? Promise.reject(new Error('icon load not started'));
}
