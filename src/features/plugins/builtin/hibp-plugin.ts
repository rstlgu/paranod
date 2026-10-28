/**
 * Have I Been Pwned (HIBP) Plugin — richiede API key.
 *
 *
 * API v3 (docs: https://haveibeenpwned.com/API/v3):
 *   GET /breachedaccount/{account}?truncateResponse=false
 *   GET /pasteaccount/{account}
 *   Header: hibp-api-key, user-agent (obbligatorio).
 *   404 = nessun risultato; 401 = chiave errata; 429 = rate limit.
 */

import type {
  TransformInput,
  TransformResult,
  OSINTEntity,
  OSINTEdge,
  PluginExecutor
} from '../types';
import { osintEntity, osintEdge, osintFail } from './osint-utils';

const SOURCE = 'hibp';
const API = 'https://haveibeenpwned.com/api/v3';
const MAX_ENTITIES = 100;

interface HibpBreach {
  Name: string;
  Title?: string;
  Domain?: string;
  BreachDate?: string;
  PwnCount?: number;
  DataClasses?: string[];
  IsVerified?: boolean;
  Description?: string;
}

interface HibpPaste {
  Source?: string;
  Id?: string;
  Title?: string;
  Date?: string;
  EmailCount?: number;
}

function getApiKey(input: TransformInput): string | undefined {
  const key = input.config?.apiKey;
  return typeof key === 'string' && key.trim() ? key.trim() : undefined;
}

async function hibpGet(
  path: string,
  apiKey: string
): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${API}${path}`, {
      headers: {
        'hibp-api-key': apiKey,
        'user-agent': 'PARANOD-OSINT/1.0',
        Accept: 'application/json'
      },
      signal: controller.signal
    });
    const json = res.status === 200 ? await res.json().catch(() => null) : null;
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null };
  } finally {
    clearTimeout(timer);
  }
}

function statusError(status: number, startTime: number): TransformResult | null {
  if (status === 200 || status === 404) return null;
  if (status === 401)
    return osintFail('HIBP: invalid or missing API key', startTime);
  if (status === 429)
    return osintFail('HIBP: rate limit exceeded, retry later', startTime);
  if (status === 0) return osintFail('HIBP: request failed or timed out', startTime);
  return osintFail(`HIBP error: ${status}`, startTime);
}

async function emailBreaches(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const email = input.entity.value.trim();
  if (!email) return osintFail('Empty email', startTime);
  const apiKey = getApiKey(input);
  if (!apiKey) return osintFail('HIBP API key not configured', startTime);

  const { status, json } = await hibpGet(
    `/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
    apiKey
  );
  const err = statusError(status, startTime);
  if (err) return err;

  const breaches = (Array.isArray(json) ? json : []) as HibpBreach[];
  if (breaches.length === 0) {
    return {
      success: true,
      entities: [],
      edges: [],
      message: 'No breaches found for this email.',
      executionTime: Date.now() - startTime
    };
  }

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];
  const seenDomains = new Set<string>();

  for (const b of breaches.slice(0, MAX_ENTITIES)) {
    const breach = osintEntity(
      SOURCE,
      'breach',
      `hibp:${b.Name}`,
      b.Title || b.Name,
      {
        provider: 'haveibeenpwned',
        breachDate: b.BreachDate,
        pwnCount: b.PwnCount,
        dataClasses: b.DataClasses,
        verified: b.IsVerified,
        domain: b.Domain
      },
      b.IsVerified ?? false
    );
    entities.push(breach);
    edges.push(osintEdge(input.entity.id, breach.id, 'Breached in', 'associated_with'));

    if (b.Domain && !seenDomains.has(b.Domain.toLowerCase())) {
      seenDomains.add(b.Domain.toLowerCase());
      const dom = osintEntity(SOURCE, 'domain', b.Domain, b.Domain, {
        breach: b.Name
      });
      entities.push(dom);
      edges.push(osintEdge(breach.id, dom.id, 'Breached site', 'associated_with'));
    }
  }

  return {
    success: true,
    entities,
    edges,
    message: `Found ${breaches.length} breach(es).`,
    executionTime: Date.now() - startTime
  };
}

async function emailPastes(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const email = input.entity.value.trim();
  if (!email) return osintFail('Empty email', startTime);
  const apiKey = getApiKey(input);
  if (!apiKey) return osintFail('HIBP API key not configured', startTime);

  const { status, json } = await hibpGet(
    `/pasteaccount/${encodeURIComponent(email)}`,
    apiKey
  );
  const err = statusError(status, startTime);
  if (err) return err;

  const pastes = (Array.isArray(json) ? json : []) as HibpPaste[];
  if (pastes.length === 0) {
    return {
      success: true,
      entities: [],
      edges: [],
      message: 'No pastes found for this email.',
      executionTime: Date.now() - startTime
    };
  }

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  for (const p of pastes.slice(0, MAX_ENTITIES)) {
    const label = p.Title || `${p.Source ?? 'Paste'} ${p.Id ?? ''}`.trim();
    const leak = osintEntity(
      SOURCE,
      'leak',
      `hibp-paste:${p.Source ?? ''}:${p.Id ?? label}`,
      label,
      {
        provider: 'haveibeenpwned',
        pasteSource: p.Source,
        pasteId: p.Id,
        date: p.Date,
        emailCount: p.EmailCount
      }
    );
    entities.push(leak);
    edges.push(osintEdge(input.entity.id, leak.id, 'Found in paste', 'associated_with'));
  }

  return {
    success: true,
    entities,
    edges,
    message: `Found ${pastes.length} paste(s).`,
    executionTime: Date.now() - startTime
  };
}

export const hibpPluginExecutor: PluginExecutor = {
  async execute(
    transformId: string,
    input: TransformInput
  ): Promise<TransformResult> {
    switch (transformId) {
      case 'hibp-email-breaches':
        return emailBreaches(input);
      case 'hibp-email-pastes':
        return emailPastes(input);
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

export default hibpPluginExecutor;
