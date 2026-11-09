import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function sanitizeDomain(input: string) {
  const value =
    input
      .trim()
      .replace(/^https?:\/\//, '')
      .split('/')[0] ?? '';
  return value.replace(/[^a-zA-Z0-9.-]/g, '').toLowerCase();
}

function isLikelyDomain(value: string) {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  if (!v.includes('.')) return false;
  if (v.length > 253) return false;
  const labels = v.split('.').filter(Boolean);
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (label.length < 1 || label.length > 63) return false;
    if (!/^[a-z0-9-]+$/.test(label)) return false;
    if (label.startsWith('-') || label.endsWith('-')) return false;
  }
  return true;
}

function clampSize(input: string | null) {
  const parsed = Number(input ?? '');
  if (!Number.isFinite(parsed)) return 256;
  const rounded = Math.round(parsed);
  if (rounded < 16) return 16;
  if (rounded > 512) return 512;
  return rounded;
}

function getLogoDevToken() {
  return (
    process.env.LOGO_DEV_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY ??
    ''
  );
}

function getCacheFilePath(args: { domain: string; size: number }) {
  const stateDir = process.env.AUTH_STATE_DIR?.trim();
  const cacheDir = stateDir
    ? path.join(stateDir, 'logo-dev')
    : path.join(process.cwd(), '.cache', 'logo-dev');
  const fileName = `${args.domain}-${args.size}.png`;
  return { cacheDir, filePath: path.join(cacheDir, fileName) };
}

function logoResponse(bytes: Uint8Array) {
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': `public, max-age=${ONE_YEAR_SECONDS}, immutable`
    }
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const domain = sanitizeDomain(url.searchParams.get('domain') ?? '');
  const size = clampSize(url.searchParams.get('size'));
  if (!domain)
    return NextResponse.json({ error: 'Missing domain' }, { status: 400 });
  if (!isLikelyDomain(domain))
    return NextResponse.json({ error: 'Invalid domain' }, { status: 400 });

  const { cacheDir, filePath } = getCacheFilePath({ domain, size });

  try {
    const existing = await fs.readFile(filePath);
    return logoResponse(new Uint8Array(existing));
  } catch {
    // Exact-size cache miss: reuse another locally cached size before the web.
  }

  try {
    const cachedNames = await fs.readdir(cacheDir);
    const cachedName = cachedNames.find(
      (name) => name.startsWith(`${domain}-`) && name.endsWith('.png')
    );
    if (cachedName) {
      const existing = await fs.readFile(path.join(cacheDir, cachedName));
      return logoResponse(new Uint8Array(existing));
    }
  } catch {
    // No local cache directory yet.
  }

  const token = getLogoDevToken();
  if (!token)
    return NextResponse.json(
      { error: 'Missing LOGO_DEV_PUBLISHABLE_KEY' },
      { status: 500 }
    );

  const upstream = new URL(`https://img.logo.dev/${domain}`);
  upstream.searchParams.set('format', 'png');
  upstream.searchParams.set('size', String(size));
  upstream.searchParams.set('theme', 'auto');
  upstream.searchParams.set('greyscale', 'false');
  // Se non c'è un logo disponibile, vogliamo 404 (lato UI c'è già fallback su icona).
  upstream.searchParams.set('fallback', '404');
  upstream.searchParams.set('retina', 'true');
  upstream.searchParams.set('token', token);

  const res = await fetch(upstream, {
    // Next cache per-process è utile ma qui vogliamo soprattutto la cache su disco.
    cache: 'no-store'
  });

  if (res.status === 404)
    return new NextResponse(null, {
      status: 404,
      headers: { 'Cache-Control': `public, max-age=${60 * 60}` }
    });

  if (!res.ok)
    return NextResponse.json(
      { error: 'Upstream error', status: res.status },
      { status: 502 }
    );

  const bytes = new Uint8Array(await res.arrayBuffer());

  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(filePath, bytes);

  return logoResponse(bytes);
}
