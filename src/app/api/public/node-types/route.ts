import { NextRequest, NextResponse } from 'next/server';
import { getPublicNodeTypes } from '@/features/osint/node-registry';

type RateState = { count: number; resetAt: number };

const RATE_LIMIT = {
  windowMs: 60_000,
  limit: 60
} as const;

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0]?.trim() || 'unknown';
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}

function getRateStore(): Map<string, RateState> {
  const g = globalThis as unknown as {
    __paranod_public_node_types_rate?: Map<string, RateState>;
  };
  if (!g.__paranod_public_node_types_rate)
    g.__paranod_public_node_types_rate = new Map();
  return g.__paranod_public_node_types_rate;
}

function checkRateLimit(ip: string): {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
} {
  const now = Date.now();
  const store = getRateStore();
  const current = store.get(ip);

  if (!current || current.resetAt <= now) {
    const resetAt = now + RATE_LIMIT.windowMs;
    store.set(ip, { count: 1, resetAt });
    return { allowed: true, limit: RATE_LIMIT.limit, remaining: RATE_LIMIT.limit - 1, resetAt };
  }

  if (current.count >= RATE_LIMIT.limit)
    return { allowed: false, limit: RATE_LIMIT.limit, remaining: 0, resetAt: current.resetAt };

  current.count += 1;
  store.set(ip, current);
  return {
    allowed: true,
    limit: RATE_LIMIT.limit,
    remaining: RATE_LIMIT.limit - current.count,
    resetAt: current.resetAt
  };
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rate = checkRateLimit(ip);

  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: {
          'x-ratelimit-limit': String(rate.limit),
          'x-ratelimit-remaining': String(rate.remaining),
          'x-ratelimit-reset': String(rate.resetAt)
        }
      }
    );
  }

  const url = new URL(request.url);
  const kind = (url.searchParams.get('kind') ?? 'all') as
    | 'entity'
    | 'ui'
    | 'all';
  const manualAddParam = url.searchParams.get('manualAdd');
  const manualAdd =
    manualAddParam === null ? undefined : manualAddParam === 'true';

  const nodeTypes = getPublicNodeTypes({ kind, manualAdd });

  return NextResponse.json(
    {
      version: 1,
      nodeTypes
    },
    {
      headers: {
        'cache-control': 'public, max-age=60',
        'x-ratelimit-limit': String(rate.limit),
        'x-ratelimit-remaining': String(rate.remaining),
        'x-ratelimit-reset': String(rate.resetAt)
      }
    }
  );
}
