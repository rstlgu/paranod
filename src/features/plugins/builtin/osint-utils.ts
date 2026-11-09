/**
 * Helper condivisi per i transform builtin che interrogano fonti OSINT esterne
 * (fetch con timeout, costruzione entità/edge, id).
 */

import type { OSINTEntity, OSINTEdge, TransformResult } from '../types';

const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

export function osintId(prefix = 'entity'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function osintEntity(
  source: string,
  type: OSINTEntity['type'],
  value: string,
  label: string,
  metadata: Record<string, unknown> = {},
  verified = false
): OSINTEntity {
  return {
    id: osintId('entity'),
    type,
    value,
    label,
    metadata,
    source,
    verified,
    timestamp: new Date().toISOString()
  };
}

export function osintEdge(
  sourceId: string,
  targetId: string,
  label: string,
  relationship: OSINTEdge['relationship'] = 'associated_with'
): OSINTEdge {
  return {
    id: osintId('edge'),
    sourceId,
    targetId,
    label,
    relationship,
    metadata: {}
  };
}

/** fetch con timeout; ritorna null su errore/timeout (best-effort). */
export async function osintFetch(
  url: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    init?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
  );
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { 'User-Agent': 'PARANOD-OSINT/1.0', ...(init?.headers ?? {}) }
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function osintFail(error: string, startTime: number): TransformResult {
  return {
    success: false,
    entities: [],
    edges: [],
    error,
    executionTime: Date.now() - startTime
  };
}
