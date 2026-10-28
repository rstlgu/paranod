/**
 * BreachDirectory Plugin (via RapidAPI) — richiede API key.
 *
 *
 * API: GET https://breachdirectory.p.rapidapi.com/?func=auto&term=<term>
 *   header: X-RapidAPI-Key, X-RapidAPI-Host: breachdirectory.p.rapidapi.com
 *   → { success, found, result:[{ sources:[], has_password, password, sha1, hash }] }
 */

import type {
  TransformInput,
  TransformResult,
  OSINTEntity,
  OSINTEdge,
  PluginExecutor
} from '../types';
import { osintEntity, osintEdge, osintFail } from './osint-utils';

const SOURCE = 'breachdirectory';
const HOST = 'breachdirectory.p.rapidapi.com';
const MAX_RESULTS = 100;

function getApiKey(input: TransformInput): string | undefined {
  const key = input.config?.apiKey;
  return typeof key === 'string' && key.trim() ? key.trim() : undefined;
}

async function search(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const term = input.entity.value.trim();
  if (!term) return osintFail('Empty search term', startTime);
  const apiKey = getApiKey(input);
  if (!apiKey) return osintFail('RapidAPI key not configured', startTime);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let data: any;
  try {
    const res = await fetch(
      `https://${HOST}/?func=auto&term=${encodeURIComponent(term)}`,
      {
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': HOST,
          'User-Agent': 'PARANOD-OSINT/1.0'
        },
        signal: controller.signal
      }
    );
    if (res.status === 401 || res.status === 403)
      return osintFail('BreachDirectory: invalid RapidAPI key or no subscription', startTime);
    if (res.status === 429)
      return osintFail('BreachDirectory: rate limit exceeded', startTime);
    if (!res.ok) return osintFail(`BreachDirectory error: ${res.status}`, startTime);
    data = await res.json().catch(() => null);
  } catch {
    return osintFail('BreachDirectory request failed or timed out', startTime);
  } finally {
    clearTimeout(timer);
  }

  const results = Array.isArray(data?.result) ? data.result : [];
  if (!data?.success || results.length === 0) {
    return {
      success: true,
      entities: [],
      edges: [],
      message: 'No breach records found.',
      executionTime: Date.now() - startTime
    };
  }

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];
  const allSources = new Set<string>();

  const summary = osintEntity(
    SOURCE,
    'breach',
    `breachdirectory:${term}`,
    `${data.found ?? results.length} breach record(s)`,
    { provider: 'breachdirectory', term, found: data.found },
    true
  );
  entities.push(summary);
  edges.push(osintEdge(input.entity.id, summary.id, 'Breach records'));

  const seenPw = new Set<string>();
  for (const r of results.slice(0, MAX_RESULTS)) {
    for (const s of (r.sources ?? []) as string[]) if (s) allSources.add(String(s));

    const pw = typeof r.password === 'string' ? r.password.trim() : '';
    if (pw && !seenPw.has(pw)) {
      seenPw.add(pw);
      const cred = osintEntity(SOURCE, 'credential', pw, 'Leaked password', {
        sha1: r.sha1,
        hash: r.hash,
        hasPassword: r.has_password
      });
      entities.push(cred);
      edges.push(osintEdge(summary.id, cred.id, 'Leaked password', 'extracted_from'));
    }
  }

  summary.metadata = {
    ...summary.metadata,
    sources: Array.from(allSources).slice(0, 40)
  };

  return {
    success: true,
    entities,
    edges,
    message: `Found ${data.found ?? results.length} record(s) across ${
      allSources.size || 1
    } source(s).`,
    executionTime: Date.now() - startTime
  };
}

export const breachDirectoryPluginExecutor: PluginExecutor = {
  async execute(
    transformId: string,
    input: TransformInput
  ): Promise<TransformResult> {
    switch (transformId) {
      case 'breachdirectory-email':
      case 'breachdirectory-username':
        return search(input);
      default:
        return {
          success: false,
          entities: [],
          edges: [],
          error: `Unknown transform: ${transformId}`
        };
    }
  }
};

export default breachDirectoryPluginExecutor;
