'use client';

import { getLogoUrlForDomain, getLogoUrlForNodeType, nodeTypeByType, type NodeType } from '@/features/osint/node-registry';

export interface OSINTNodeVisualTokens {
  logoUrl?: string;
  accentHex: string;     // e.g. #1D9BF0
  bgHex: string;         // e.g. #1D9BF015 (like OSINT header)
  iconHex: string;       // icon/text color
}

export function isHex6Color(input: string) {
  return /^#([0-9a-fA-F]{6})$/.test(String(input ?? '').trim());
}

export function computeDynamicLogoUrl(args: {
  type: string;
  label: string;
  metadata?: Record<string, unknown> | null;
}) {
  // Plugins can name the brand behind a node, e.g. the site of a profile card.
  const logoDomain = args.metadata?.logoDomain;
  if (typeof logoDomain === 'string' && logoDomain.trim()) {
    const logoUrl = getLogoUrlForDomain({ domain: logoDomain.trim(), size: 256 });
    if (logoUrl) return logoUrl;
  }

  const rawValue = String(args.label ?? '').trim();
  if (!rawValue) return undefined;

  const type = String(args.type ?? '');
  // I nodi 'social' che rappresentano un profilo (label = URL) si comportano come
  // i nodi url: favicon/colore derivati dal dominio. I social con label testuale
  // (es. "Instagram profile info") non derivano.
  const socialWithUrlLabel =
    type === 'social' && /:\/\/|\.[a-z]{2,}(\/|$|\?)/i.test(rawValue);
  const shouldDeriveFromValue =
    type === 'domain' ||
    type === 'subdomain' ||
    type === 'hostname' ||
    type === 'url' ||
    socialWithUrlLabel;
  if (!shouldDeriveFromValue) return undefined;

  function tryParseDomainFromUrl(value: string) {
    try {
      const parsed = new URL(value);
      return parsed.hostname;
    } catch {
      return undefined;
    }
  }

  const fromUrl = rawValue.includes('://') ? tryParseDomainFromUrl(rawValue) : undefined;
  const asUrlWithScheme = !fromUrl ? tryParseDomainFromUrl(`https://${rawValue}`) : undefined;
  const domain = fromUrl ?? asUrlWithScheme ?? rawValue.replace(/^https?:\/\//, '').split('/')[0];
  if (!domain) return undefined;

  return getLogoUrlForDomain({ domain, size: 256 }) ?? undefined;
}

export function computeLogoUrl(args: {
  type: string;
  label: string;
  metadata?: Record<string, unknown> | null;
}) {
  const dynamic = computeDynamicLogoUrl(args);
  if (dynamic) return dynamic;
  const type = args.type as NodeType;
  return type ? (getLogoUrlForNodeType(type, { size: 256 }) ?? undefined) : undefined;
}

export function computeAccentHex(args: { type: string; metadata?: Record<string, unknown> | null }) {
  const meta: any = args.metadata ?? {};
  const custom = typeof meta.customColor === 'string' ? String(meta.customColor).trim() : '';
  if (isHex6Color(custom)) return custom;

  const def = nodeTypeByType[args.type as NodeType];
  if (def?.colorHex) return def.colorHex;

  return '#94a3b8';
}

export function computeBgHex(accentHex: string) {
  // Matches OSINT header for customColor: `${customColor}15`
  return isHex6Color(accentHex) ? `${accentHex}15` : accentHex;
}

export function computeIconHex(args: { accentHex: string; metadata?: Record<string, unknown> | null }) {
  const meta: any = args.metadata ?? {};
  const headerTextColor =
    typeof meta.headerTextColor === 'string' ? String(meta.headerTextColor).trim() : '';
  if (isHex6Color(headerTextColor)) return headerTextColor;
  return args.accentHex;
}

function parseHex6(input: string) {
  const raw = input.trim();
  const match = /^#([0-9a-fA-F]{6})$/.exec(raw);
  if (!match) return null;
  const hex = match[1] ?? '';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return { r, g, b };
}

function relLuminance(rgb: { r: number; g: number; b: number }) {
  function toLinear(v: number) {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function mixRgb(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, t: number) {
  const clamped = Math.min(1, Math.max(0, t));
  return {
    r: Math.round(a.r + (b.r - a.r) * clamped),
    g: Math.round(a.g + (b.g - a.g) * clamped),
    b: Math.round(a.b + (b.b - a.b) * clamped)
  };
}

function rgbToHex(rgb: { r: number; g: number; b: number }) {
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

export function pickReadableHeaderTextColor(args: { accentHex: string; isDark: boolean }) {
  const accent = parseHex6(args.accentHex);
  if (!accent) return undefined;
  const baseBg = parseHex6(args.isDark ? '#09090b' : '#ffffff');
  if (!baseBg) return undefined;

  const minRatio = 4.5;
  const currentRatio = contrastRatio(accent, baseBg);
  if (currentRatio >= minRatio) return args.accentHex;

  const target = parseHex6(args.isDark ? '#ffffff' : '#000000');
  if (!target) return args.accentHex;

  let lo = 0;
  let hi = 1;
  let best: { r: number; g: number; b: number } | null = null;
  for (let iter = 0; iter < 18; iter += 1) {
    const mid = (lo + hi) / 2;
    const candidate = mixRgb(accent, target, mid);
    const ratio = contrastRatio(candidate, baseBg);
    if (ratio >= minRatio) {
      best = candidate;
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return best ? rgbToHex(best) : args.accentHex;
}

export function getOsintNodeVisualTokens(args: {
  type: string;
  label: string;
  metadata?: Record<string, unknown> | null;
}): OSINTNodeVisualTokens {
  const accentHex = computeAccentHex({ type: args.type, metadata: args.metadata });
  return {
    logoUrl: computeLogoUrl(args),
    accentHex,
    bgHex: computeBgHex(accentHex),
    iconHex: computeIconHex({ accentHex, metadata: args.metadata })
  };
}
