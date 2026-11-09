/**
 * breach.vip Plugin
 * Ricerca in database di breach/leak via breach.vip (free API, no key).
 *
 * API: POST https://breach.vip/api/search
 *   body: { term, fields: string[], categories?, wildcard?, case_sensitive? }
 *   fields validi: email, password, domain, username, ip, name, uuid,
 *                  steamid, phone, discordid
 *   response: { results: Array<Record<string, any>> }
 *
 * NB: breach.vip è dietro Cloudflare; da alcuni IP (datacenter) può rispondere
 * 403 con challenge — in quel caso il transform ritorna un errore chiaro.
 */

import { ProxyAgent } from 'undici';
import type {
  TransformInput,
  TransformResult,
  OSINTEntity,
  OSINTEdge,
  EntityType,
  PluginExecutor
} from '../types';
import { osintEntity, osintEdge, osintFail } from './osint-utils';

const SOURCE = 'breach-vip';
const API = 'https://breach.vip/api/search';
const MAX_RESULTS = 80;
const MAX_DERIVED = 60;

/** Mappa il tipo entità di input → campo di ricerca breach.vip. */
const FIELD_BY_INPUT: Record<string, string> = {
  email: 'email',
  username: 'username',
  domain: 'domain',
  ip: 'ip',
  phone: 'phone',
  person: 'name'
};

/**
 * Fetch breach.vip; se è configurato un `proxyUrl` (OSS), instrada la richiesta
 * attraverso quel proxy (IP pulito) per aggirare il blocco Cloudflare sugli IP
 * datacenter. Timeout 30s. Ritorna null su errore/timeout.
 */
async function breachFetch(
  body: string,
  proxyUrl?: string
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const init: RequestInit & { dispatcher?: ProxyAgent } = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PARANOD-OSINT/1.0'
      },
      body,
      signal: controller.signal
    };
    if (proxyUrl) init.dispatcher = new ProxyAgent(proxyUrl);
    return await fetch(API, init as RequestInit);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function searchBreaches(
  input: TransformInput,
  field: string
): Promise<TransformResult> {
  const startTime = Date.now();
  const term = input.entity.value.trim();
  const sourceId = input.entity.id;
  if (!term) return osintFail('Empty search term', startTime);

  const proxyUrl =
    typeof input.config?.proxyUrl === 'string' && input.config.proxyUrl.trim()
      ? input.config.proxyUrl.trim()
      : undefined;

  const res = await breachFetch(
    JSON.stringify({ term, fields: [field] }),
    proxyUrl
  );
  if (!res) return osintFail('breach.vip request failed', startTime);
  if (res.status === 403) {
    return osintFail(
      proxyUrl
        ? 'breach.vip returned 403 through the configured proxy (its IP may also be blocked by Cloudflare). Try a cleaner proxy.'
        : 'breach.vip is blocking this server IP (Cloudflare 403). On a self-hosted installation, set an HTTP proxy in the plugin settings to route through a clean IP.',
      startTime
    );
  }
  if (!res.ok) return osintFail(`breach.vip error: ${res.status}`, startTime);

  const data = (await res.json().catch(() => null)) as {
    results?: Array<Record<string, any>>;
  } | null;
  const results = Array.isArray(data?.results) ? data!.results : [];

  if (results.length === 0) {
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

  // Sorgenti/database distinti
  const sources = new Set<string>();
  for (const r of results) {
    const src = r.database ?? r.source ?? r.breach ?? r.db;
    if (src) sources.add(String(src));
  }

  // Entità breach di riepilogo
  const summary = osintEntity(
    SOURCE,
    'breach',
    `breachvip:${field}:${term}`,
    `${results.length} breach record(s)`,
    {
      provider: 'breach.vip',
      field,
      recordCount: results.length,
      sources: Array.from(sources).slice(0, 30)
    },
    true
  );
  entities.push(summary);
  edges.push(osintEdge(sourceId, summary.id, 'Breach records'));

  // Entità derivate (email/username/password) dedup, con cap
  const seen = new Set<string>();
  const pushDerived = (
    type: EntityType,
    value: string,
    label: string,
    rel = 'associated_with' as OSINTEdge['relationship']
  ) => {
    const v = value.trim();
    if (!v) return;
    const key = `${type}:${v.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (entities.length - 1 >= MAX_DERIVED) return;
    const e = osintEntity(SOURCE, type, v, label);
    entities.push(e);
    edges.push(osintEdge(summary.id, e.id, label, rel));
  };

  for (const r of results.slice(0, MAX_RESULTS)) {
    const emails = normalizeField(r.email);
    for (const em of emails) pushDerived('email', em, 'Leaked email');

    const usernames = normalizeField(r.username);
    for (const un of usernames) pushDerived('username', un, 'Leaked username');

    const passwords = normalizeField(r.password);
    for (const pw of passwords)
      pushDerived('credential', pw, 'Leaked password', 'extracted_from');
  }

  return {
    success: true,
    entities,
    edges,
    message: `Found ${results.length} breach record(s) across ${sources.size || 1} source(s).`,
    metadata: { recordCount: results.length, sources: Array.from(sources) },
    executionTime: Date.now() - startTime
  };
}

/** Un valore può essere string o string[] a seconda del record. */
function normalizeField(val: unknown): string[] {
  if (typeof val === 'string') return val ? [val] : [];
  if (Array.isArray(val))
    return val.filter((x) => typeof x === 'string' && x) as string[];
  return [];
}

export const breachVipPluginExecutor: PluginExecutor = {
  async execute(
    transformId: string,
    input: TransformInput
  ): Promise<TransformResult> {
    // transformId: breachvip-<inputType>; campo dedotto dal tipo entità.
    const field =
      FIELD_BY_INPUT[String(input.entity.type)] ??
      FIELD_BY_INPUT[transformId.replace('breachvip-', '')];
    if (!field) {
      return {
        success: false,
        entities: [],
        edges: [],
        error: `Unsupported input type for breach.vip: ${input.entity.type}`
      };
    }
    return searchBreaches(input, field);
  }
};

export default breachVipPluginExecutor;
