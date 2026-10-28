/**
 * IP Geolocation Plugin
 * Geolocalizza IP e ottiene info ASN
 * Utilizza ip-api.com (gratuito, 45 req/min)
 */

import { promises as dns } from 'dns';
import type {
  TransformInput,
  TransformResult,
  OSINTEntity,
  OSINTEdge,
  PluginExecutor,
  GeoLocation
} from '../types';
import { osintEntity, osintEdge, osintFail, osintFetch } from './osint-utils';

const IP_SOURCE = 'ip-geolocation';

function generateId(): string {
  return `entity-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function generateEdgeId(): string {
  return `edge-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Valida formato IP (v4)
 */
function isValidIPv4(ip: string): boolean {
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return ipv4Regex.test(ip);
}

/**
 * Valida formato IP (v6)
 */
function isValidIPv6(ip: string): boolean {
  const ipv6Regex =
    /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,7}:$|^(?:[0-9a-fA-F]{1,4}:){0,6}::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}$/;
  return ipv6Regex.test(ip);
}

function isValidIP(ip: string): boolean {
  return isValidIPv4(ip) || isValidIPv6(ip);
}

/**
 * Chiama ip-api.com per geolocalizzazione
 */
async function fetchIPInfo(ip: string): Promise<GeoLocation | null> {
  try {
    const response = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as`,
      { next: { revalidate: 3600 } } // Cache 1 ora
    );

    const data = await response.json();

    if (data.status === 'fail') {
      return null;
    }

    return {
      country: data.country,
      countryCode: data.countryCode,
      region: data.region,
      regionName: data.regionName,
      city: data.city,
      zip: data.zip,
      lat: data.lat,
      lon: data.lon,
      timezone: data.timezone,
      isp: data.isp,
      org: data.org,
      as: data.as
    };
  } catch {
    return null;
  }
}

/**
 * Geolocalizza IP
 */
async function geolocateIP(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const ip = input.entity.value.trim();
  const sourceId = input.entity.id;

  if (!isValidIP(ip)) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: 'Invalid IP address format',
      executionTime: Date.now() - startTime
    };
  }

  const geoInfo = await fetchIPInfo(ip);

  if (!geoInfo) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: 'Failed to fetch IP geolocation',
      executionTime: Date.now() - startTime
    };
  }

  const locationLabel = [geoInfo.city, geoInfo.regionName, geoInfo.country]
    .filter(Boolean)
    .join(', ');

  const entity: OSINTEntity = {
    id: generateId(),
    type: 'location',
    value: `${geoInfo.lat},${geoInfo.lon}`,
    label: locationLabel || 'Unknown Location',
    metadata: {
      country: geoInfo.country,
      countryCode: geoInfo.countryCode,
      region: geoInfo.region,
      regionName: geoInfo.regionName,
      city: geoInfo.city,
      zip: geoInfo.zip,
      latitude: geoInfo.lat,
      longitude: geoInfo.lon,
      timezone: geoInfo.timezone,
      sourceIP: ip
    },
    source: 'ip-geolocation',
    verified: true,
    timestamp: new Date().toISOString()
  };

  const edge: OSINTEdge = {
    id: generateEdgeId(),
    sourceId: sourceId,
    targetId: entity.id,
    label: 'Located at',
    relationship: 'located_at',
    metadata: {}
  };

  return {
    success: true,
    entities: [entity],
    edges: [edge],
    message: `IP located in ${locationLabel}`,
    metadata: { geoLocation: geoInfo },
    executionTime: Date.now() - startTime
  };
}

/**
 * ASN Lookup
 */
async function asnLookup(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const ip = input.entity.value.trim();
  const sourceId = input.entity.id;

  if (!isValidIP(ip)) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: 'Invalid IP address format',
      executionTime: Date.now() - startTime
    };
  }

  const geoInfo = await fetchIPInfo(ip);

  if (!geoInfo) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: 'Failed to fetch ASN information',
      executionTime: Date.now() - startTime
    };
  }

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  // ISP Entity
  if (geoInfo.isp) {
    const ispEntity: OSINTEntity = {
      id: generateId(),
      type: 'organization',
      value: geoInfo.isp,
      label: `${geoInfo.isp} (ISP)`,
      metadata: {
        type: 'ISP',
        asn: geoInfo.as,
        sourceIP: ip
      },
      source: 'ip-geolocation',
      verified: true,
      timestamp: new Date().toISOString()
    };

    entities.push(ispEntity);
    edges.push({
      id: generateEdgeId(),
      sourceId: sourceId,
      targetId: ispEntity.id,
      label: 'ISP',
      relationship: 'belongs_to',
      metadata: {}
    });
  }

  // Organization Entity (se diversa da ISP)
  if (geoInfo.org && geoInfo.org !== geoInfo.isp) {
    const orgEntity: OSINTEntity = {
      id: generateId(),
      type: 'organization',
      value: geoInfo.org,
      label: `${geoInfo.org} (Org)`,
      metadata: {
        type: 'Organization',
        asn: geoInfo.as,
        sourceIP: ip
      },
      source: 'ip-geolocation',
      verified: true,
      timestamp: new Date().toISOString()
    };

    entities.push(orgEntity);
    edges.push({
      id: generateEdgeId(),
      sourceId: sourceId,
      targetId: orgEntity.id,
      label: 'Organization',
      relationship: 'belongs_to',
      metadata: {}
    });
  }

  return {
    success: true,
    entities,
    edges,
    message: `Found ${entities.length} organization(s) - ASN: ${geoInfo.as}`,
    metadata: { asn: geoInfo.as, isp: geoInfo.isp, org: geoInfo.org },
    executionTime: Date.now() - startTime
  };
}

/**
 * Crea un nodo mappa dall'IP geolocalizzato
 */
async function createMapFromIP(
  input: TransformInput
): Promise<TransformResult> {
  const startTime = Date.now();
  const ip = input.entity.value.trim();
  const sourceId = input.entity.id;

  if (!isValidIP(ip)) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: 'Invalid IP address format',
      executionTime: Date.now() - startTime
    };
  }

  const geoInfo = await fetchIPInfo(ip);

  if (!geoInfo || geoInfo.lat === undefined || geoInfo.lon === undefined) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: 'Failed to geolocate IP for map',
      executionTime: Date.now() - startTime
    };
  }

  const locationLabel = [geoInfo.city, geoInfo.regionName, geoInfo.country]
    .filter(Boolean)
    .join(', ');

  const mapEntity: OSINTEntity = {
    id: generateId(),
    type: 'maps',
    value: `${geoInfo.lat}, ${geoInfo.lon}`,
    label: `${geoInfo.lat}, ${geoInfo.lon}`,
    metadata: {
      title: `Map: ${locationLabel || ip}`,
      sourceIP: ip,
      country: geoInfo.country,
      city: geoInfo.city,
      latitude: geoInfo.lat,
      longitude: geoInfo.lon,
      isp: geoInfo.isp
    },
    source: 'ip-geolocation',
    verified: true,
    timestamp: new Date().toISOString()
  };

  const edge: OSINTEdge = {
    id: generateEdgeId(),
    sourceId: sourceId,
    targetId: mapEntity.id,
    label: 'visualized on',
    relationship: 'related_to',
    metadata: {}
  };

  return {
    success: true,
    entities: [mapEntity],
    edges: [edge],
    message: `Created map for IP location: ${locationLabel}`,
    executionTime: Date.now() - startTime
  };
}

/**
 * Reverse DNS (PTR): hostname associati all'IP (dns.reverse, no key).
 */
async function reverseDns(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const ip = input.entity.value.trim();
  const sourceId = input.entity.id;
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && !ip.includes(':')) {
    return osintFail('Invalid IP address', startTime);
  }

  let hostnames: string[] = [];
  try {
    hostnames = await dns.reverse(ip);
  } catch {
    return {
      success: true,
      entities: [],
      edges: [],
      message: 'No PTR record for this IP.',
      executionTime: Date.now() - startTime
    };
  }

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];
  for (const host of hostnames) {
    const h = osintEntity(IP_SOURCE, 'hostname', host, host, {}, true);
    entities.push(h);
    edges.push(osintEdge(sourceId, h.id, 'Reverse DNS (PTR)', 'resolves_to'));
  }

  return {
    success: true,
    entities,
    edges,
    message: `PTR: ${hostnames.join(', ')}`,
    executionTime: Date.now() - startTime
  };
}

// ============================================
// Network infrastructure (keyless): Domain→ASN, ASN→CIDRs, CIDR→IPs, Org→ASN
// via bgpview.io (no key) + DNS.
// ============================================

const BGPVIEW = 'https://api.bgpview.io';
const MAX_CIDRS = 200;
const MAX_IPS = 1024;
const MAX_ASNS = 50;

/** Estrae il numero ASN da "AS15169" / "15169" / "asn 15169". */
function parseAsnNumber(value: string): number | null {
  const m = value.trim().match(/(\d{1,10})/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isValidCidrV4(value: string): boolean {
  const m = value.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!m) return false;
  if (!isValidIPv4(m[1])) return false;
  const prefix = Number(m[2]);
  return prefix >= 0 && prefix <= 32;
}

/** Domain to ASN: risolve il dominio e ricava l'ASN dell'IP. */
async function domainToAsn(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const domain = input.entity.value.trim().toLowerCase().replace(/^www\./, '');
  const sourceId = input.entity.id;
  if (!domain) return osintFail('Empty domain', startTime);

  let ip: string | undefined;
  try {
    const addrs = await dns.resolve4(domain);
    ip = addrs[0];
  } catch {
    return osintFail('Could not resolve domain to an IP', startTime);
  }
  if (!ip) return osintFail('Domain did not resolve to any IP', startTime);

  const geoInfo = await fetchIPInfo(ip);
  if (!geoInfo?.as) return osintFail('Could not determine ASN for the domain', startTime);

  const asnNum = parseAsnNumber(geoInfo.as);
  const asnValue = asnNum ? `AS${asnNum}` : geoInfo.as;

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  const asnEntity = osintEntity(IP_SOURCE, 'asn', asnValue, geoInfo.as, {
    resolvedIp: ip,
    org: geoInfo.org || geoInfo.isp,
    domain
  }, true);
  entities.push(asnEntity);
  edges.push(osintEdge(sourceId, asnEntity.id, 'ASN', 'belongs_to'));

  if (geoInfo.isp) {
    const org = osintEntity(IP_SOURCE, 'organization', geoInfo.isp, `${geoInfo.isp} (ISP)`, {
      asn: geoInfo.as
    });
    entities.push(org);
    edges.push(osintEdge(asnEntity.id, org.id, 'Operated by', 'belongs_to'));
  }

  return {
    success: true,
    entities,
    edges,
    message: `Domain ${domain} → ${asnValue}`,
    executionTime: Date.now() - startTime
  };
}

/** ASN to CIDRs: prefissi annunciati dall'ASN (bgpview). */
async function asnToCidrs(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const asnNum = parseAsnNumber(input.entity.value);
  const sourceId = input.entity.id;
  if (!asnNum) return osintFail('Invalid ASN', startTime);

  const res = await osintFetch(`${BGPVIEW}/asn/${asnNum}/prefixes`);
  if (!res || !res.ok) return osintFail('bgpview request failed', startTime);
  const data = (await res.json().catch(() => null)) as {
    data?: {
      ipv4_prefixes?: Array<{ prefix: string; description?: string | null }>;
      ipv6_prefixes?: Array<{ prefix: string; description?: string | null }>;
    };
  } | null;

  const prefixes = [
    ...(data?.data?.ipv4_prefixes ?? []),
    ...(data?.data?.ipv6_prefixes ?? [])
  ];
  if (prefixes.length === 0) {
    return {
      success: true,
      entities: [],
      edges: [],
      message: 'No prefixes announced by this ASN.',
      executionTime: Date.now() - startTime
    };
  }

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];
  const seen = new Set<string>();
  for (const p of prefixes) {
    if (!p.prefix || seen.has(p.prefix)) continue;
    seen.add(p.prefix);
    const e = osintEntity(IP_SOURCE, 'cidr', p.prefix, p.prefix, {
      asn: `AS${asnNum}`,
      description: p.description ?? undefined
    }, true);
    entities.push(e);
    edges.push(osintEdge(sourceId, e.id, 'Announces', 'contains'));
    if (entities.length >= MAX_CIDRS) break;
  }

  return {
    success: true,
    entities,
    edges,
    message: `Found ${entities.length} prefix(es) for AS${asnNum}.`,
    executionTime: Date.now() - startTime
  };
}

/** CIDR to IPs: espande un blocco IPv4 in indirizzi (cap MAX_IPS). */
async function cidrToIps(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const cidr = input.entity.value.trim();
  const sourceId = input.entity.id;
  if (!isValidCidrV4(cidr)) {
    return osintFail('Only IPv4 CIDR blocks are supported (e.g. 1.2.3.0/24)', startTime);
  }

  const [base, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  const octets = base.split('.').map(Number);
  const baseInt =
    ((octets[0] << 24) >>> 0) +
    (octets[1] << 16) +
    (octets[2] << 8) +
    octets[3];
  const hostBits = 32 - prefix;
  const total = 2 ** hostBits;
  const networkInt = hostBits === 0 ? baseInt : ((baseInt >>> hostBits) << hostBits) >>> 0;

  const count = Math.min(total, MAX_IPS);
  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];
  for (let i = 0; i < count; i++) {
    const ipInt = (networkInt + i) >>> 0;
    const ip = [
      (ipInt >>> 24) & 255,
      (ipInt >>> 16) & 255,
      (ipInt >>> 8) & 255,
      ipInt & 255
    ].join('.');
    const e = osintEntity(IP_SOURCE, 'ip', ip, ip, { cidr }, true);
    entities.push(e);
    edges.push(osintEdge(sourceId, e.id, 'In range', 'contains'));
  }

  const truncated = total > MAX_IPS;
  return {
    success: true,
    entities,
    edges,
    message: truncated
      ? `Expanded ${count} of ${total} IPs (capped).`
      : `Expanded ${count} IP(s).`,
    executionTime: Date.now() - startTime
  };
}

/** Organization to ASN: cerca ASN per nome organizzazione (bgpview search). */
async function orgToAsn(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const term = input.entity.value.trim();
  const sourceId = input.entity.id;
  if (!term) return osintFail('Empty organization name', startTime);

  const res = await osintFetch(
    `${BGPVIEW}/search?query_term=${encodeURIComponent(term)}`
  );
  if (!res || !res.ok) return osintFail('bgpview request failed', startTime);
  const data = (await res.json().catch(() => null)) as {
    data?: {
      asns?: Array<{
        asn: number;
        name?: string;
        description?: string | null;
        country_code?: string | null;
      }>;
    };
  } | null;

  const asns = data?.data?.asns ?? [];
  if (asns.length === 0) {
    return {
      success: true,
      entities: [],
      edges: [],
      message: 'No ASN found for this organization.',
      executionTime: Date.now() - startTime
    };
  }

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];
  const seen = new Set<number>();
  for (const a of asns) {
    if (seen.has(a.asn)) continue;
    seen.add(a.asn);
    const label = a.description || a.name || `AS${a.asn}`;
    const e = osintEntity(IP_SOURCE, 'asn', `AS${a.asn}`, `AS${a.asn} · ${label}`, {
      name: a.name,
      description: a.description ?? undefined,
      country: a.country_code ?? undefined
    });
    entities.push(e);
    edges.push(osintEdge(sourceId, e.id, 'Owns ASN', 'owns'));
    if (entities.length >= MAX_ASNS) break;
  }

  return {
    success: true,
    entities,
    edges,
    message: `Found ${entities.length} ASN(s) for "${term}".`,
    executionTime: Date.now() - startTime
  };
}

/** Reverse IP: domini ospitati sullo stesso IP (HackerTarget, keyless). */
async function reverseIpLookup(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const ip = input.entity.value.trim();
  const sourceId = input.entity.id;
  if (!isValidIPv4(ip)) return osintFail('Only IPv4 is supported', startTime);

  const res = await osintFetch(
    `https://api.hackertarget.com/reverseiplookup/?q=${encodeURIComponent(ip)}`,
    { timeoutMs: 20_000 }
  );
  if (!res || !res.ok) return osintFail('reverse IP request failed', startTime);
  const text = await res.text();
  if (/error|exceeded|invalid|no records|no dns/i.test(text.split('\n')[0] ?? '')) {
    return {
      success: true,
      entities: [],
      edges: [],
      message: 'No domains found on this IP (or rate limited).',
      executionTime: Date.now() - startTime
    };
  }

  const hosts = Array.from(
    new Set(
      text
        .split('\n')
        .map((l) => l.trim().toLowerCase())
        .filter((l) => l && l.includes('.') && !l.includes(' '))
    )
  ).slice(0, MAX_CIDRS);

  if (hosts.length === 0) {
    return {
      success: true,
      entities: [],
      edges: [],
      message: 'No domains found on this IP.',
      executionTime: Date.now() - startTime
    };
  }

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];
  for (const host of hosts) {
    const e = osintEntity(IP_SOURCE, 'domain', host, host, {
      hostedOn: ip,
      source: 'reverse-ip'
    }, true);
    entities.push(e);
    edges.push(osintEdge(sourceId, e.id, 'Hosts', 'hosts'));
  }

  return {
    success: true,
    entities,
    edges,
    message: `Found ${hosts.length} domain(s) on ${ip}.`,
    executionTime: Date.now() - startTime
  };
}

/**
 * IP Plugin Executor
 */
export const ipPluginExecutor: PluginExecutor = {
  async execute(
    transformId: string,
    input: TransformInput
  ): Promise<TransformResult> {
    switch (transformId) {
      case 'ip-geolocate':
        return geolocateIP(input);
      case 'ip-asn-lookup':
        return asnLookup(input);
      case 'ip-show-on-map':
        return createMapFromIP(input);
      case 'ip-reverse-dns':
        return reverseDns(input);
      case 'ip-reverse-ip':
        return reverseIpLookup(input);
      case 'domain-to-asn':
        return domainToAsn(input);
      case 'asn-to-cidrs':
        return asnToCidrs(input);
      case 'cidr-to-ips':
        return cidrToIps(input);
      case 'org-to-asn':
        return orgToAsn(input);
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

export default ipPluginExecutor;
