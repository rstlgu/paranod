/**
 * Subdomain Finder Plugin — enumerazione sottodomini keyless, multi-fonte.
 *
 * Fonti (unite + dedup, best-effort ognuna):
 *  1. certSpotter (Certificate Transparency) — affidabile e veloce, primario.
 *     GET api.certspotter.com/v1/issuances?domain=X&include_subdomains=true&expand=dns_names
 *  2. HackerTarget hostsearch — passive DNS, dà anche l'IP (rate-limit giornaliero).
 *     GET api.hackertarget.com/hostsearch/?q=X  → CSV "host,ip"
 *  3. crt.sh — Certificate Transparency, fallback (spesso 503/lento).
 *
 * Nessuna chiave. Output: entità `domain` (sottodomini) + `ip` (da HackerTarget).
 */

import type {
  TransformInput,
  TransformResult,
  OSINTEntity,
  OSINTEdge,
  PluginExecutor
} from '../types';
import { osintEntity, osintEdge, osintFetch, osintFail } from './osint-utils';

const SOURCE = 'subdomain-finder';
const MAX_SUBDOMAINS = 100;
const DOMAIN_RE =
  /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/;

/** Normalizza e valida un nome come sottodominio di `domain`. */
function keepSub(name: string, domain: string): string | null {
  const clean = name.trim().toLowerCase().replace(/^\*\./, '');
  if (!clean || clean.startsWith('*')) return null;
  if (clean === domain) return null;
  if (!clean.endsWith(`.${domain}`)) return null;
  return clean;
}

/** certSpotter — Certificate Transparency (primario). */
async function fromCertspotter(domain: string): Promise<string[]> {
  const res = await osintFetch(
    `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(
      domain
    )}&include_subdomains=true&expand=dns_names`,
    { timeoutMs: 20_000 }
  );
  if (!res || !res.ok) return [];
  const data = (await res.json().catch(() => null)) as
    | Array<{ dns_names?: string[] }>
    | null;
  if (!Array.isArray(data)) return [];
  const out = new Set<string>();
  for (const entry of data) {
    for (const name of entry.dns_names ?? []) {
      const sub = keepSub(name, domain);
      if (sub) out.add(sub);
    }
  }
  return Array.from(out);
}

/** HackerTarget hostsearch — passive DNS con IP (CSV host,ip). */
async function fromHackerTarget(
  domain: string
): Promise<Array<{ host: string; ip?: string }>> {
  const res = await osintFetch(
    `https://api.hackertarget.com/hostsearch/?q=${encodeURIComponent(domain)}`,
    { timeoutMs: 20_000 }
  );
  if (!res || !res.ok) return [];
  const text = await res.text();
  // Il rate-limit/errore ritorna testo tipo "API count exceeded" senza virgole.
  if (!text.includes(',') || /error|exceeded|invalid/i.test(text.split('\n')[0]))
    return [];
  const out: Array<{ host: string; ip?: string }> = [];
  for (const line of text.split('\n')) {
    const [rawHost, rawIp] = line.split(',');
    const host = keepSub(rawHost ?? '', domain);
    if (!host) continue;
    const ip = rawIp && IPV4_RE.test(rawIp.trim()) ? rawIp.trim() : undefined;
    out.push({ host, ip });
  }
  return out;
}

/** crt.sh — Certificate Transparency, fallback best-effort. */
async function fromCrtSh(domain: string): Promise<string[]> {
  const res = await osintFetch(
    `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`,
    { timeoutMs: 20_000 }
  );
  if (!res || !res.ok) return [];
  const data = (await res.json().catch(() => null)) as
    | Array<{ name_value?: string; common_name?: string }>
    | null;
  if (!Array.isArray(data)) return [];
  const out = new Set<string>();
  for (const entry of data) {
    const names = (entry.name_value ?? '').split('\n');
    if (entry.common_name) names.push(entry.common_name);
    for (const name of names) {
      const sub = keepSub(name, domain);
      if (sub) out.add(sub);
    }
  }
  return Array.from(out);
}

async function findSubdomains(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const domain = input.entity.value.toLowerCase().trim().replace(/^www\./, '');
  const sourceId = input.entity.id;

  if (!DOMAIN_RE.test(domain)) {
    return osintFail('Invalid domain format', startTime);
  }

  // Interroga le fonti in parallelo (ognuna best-effort).
  const [cs, ht, crt] = await Promise.all([
    fromCertspotter(domain),
    fromHackerTarget(domain),
    fromCrtSh(domain)
  ]);

  const usedSources: string[] = [];
  if (cs.length) usedSources.push('certSpotter');
  if (ht.length) usedSources.push('HackerTarget');
  if (crt.length) usedSources.push('crt.sh');

  // Unione sottodomini + mappa host→IP da HackerTarget.
  const ipByHost = new Map<string, string>();
  for (const { host, ip } of ht) if (ip) ipByHost.set(host, ip);

  const allSubs = new Set<string>([...cs, ...ht.map((h) => h.host), ...crt]);
  const subdomains = Array.from(allSubs).sort();

  if (subdomains.length === 0) {
    return {
      success: true,
      entities: [],
      edges: [],
      message: usedSources.length
        ? 'No subdomains found.'
        : 'No subdomains found (all sources unavailable — rate limit or downtime).',
      executionTime: Date.now() - startTime
    };
  }

  const limited = subdomains.slice(0, MAX_SUBDOMAINS);
  const hasMore = subdomains.length > MAX_SUBDOMAINS;

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];
  const ipEntityByValue = new Map<string, OSINTEntity>();

  for (const sub of limited) {
    const subEntity = osintEntity(
      SOURCE,
      'domain',
      sub,
      sub,
      { parentDomain: domain, sources: usedSources },
      true
    );
    entities.push(subEntity);
    edges.push(osintEdge(sourceId, subEntity.id, 'Subdomain', 'contains'));

    const ip = ipByHost.get(sub);
    if (ip) {
      let ipEntity = ipEntityByValue.get(ip);
      if (!ipEntity) {
        ipEntity = osintEntity(SOURCE, 'ip', ip, ip, { source: 'passive-dns' }, true);
        ipEntityByValue.set(ip, ipEntity);
        entities.push(ipEntity);
      }
      edges.push(osintEdge(subEntity.id, ipEntity.id, 'Resolves to', 'resolves_to'));
    }
  }

  return {
    success: true,
    entities,
    edges,
    message: `Found ${subdomains.length} subdomain(s) via ${usedSources.join(
      ', '
    )}${hasMore ? ` (showing first ${MAX_SUBDOMAINS})` : ''}.`,
    metadata: {
      totalFound: subdomains.length,
      displayed: limited.length,
      sources: usedSources
    },
    executionTime: Date.now() - startTime
  };
}

export const subdomainPluginExecutor: PluginExecutor = {
  async execute(
    transformId: string,
    input: TransformInput
  ): Promise<TransformResult> {
    switch (transformId) {
      case 'subdomain-find':
        return findSubdomains(input);
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

export default subdomainPluginExecutor;
