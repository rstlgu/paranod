/**
 * URL Parser Plugin
 * Estrae componenti da URL e risolve IP
 */

import { promises as dns } from 'dns';
import type {
  TransformInput,
  TransformResult,
  OSINTEntity,
  OSINTEdge,
  PluginExecutor
} from '../types';
import { osintEntity, osintEdge, osintFail } from './osint-utils';

import { safePublicFetch } from '@/lib/security/safe-fetch';
const osintFetch = (url: string, init?: RequestInit & { timeoutMs?: number }) =>
  safePublicFetch(url, init).catch(() => null);

function generateId(): string {
  return `entity-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function generateEdgeId(): string {
  return `edge-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================
// Website Enrichers (keyless, fetch page HTML)
// ============================================

const MAX_HTML_BYTES = 3_000_000;
const MAX_LINKS = 150;
const MAX_CRAWL_PAGES = 40;
const MAX_TEXT_CHARS = 8_000;

/** Normalizza un valore in URL assoluto http(s), o null se invalido. */
function toUrl(value: string, base?: string): URL | null {
  try {
    const raw = value.trim();
    if (base) return new URL(raw, base);
    return new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

/** Scarica l'HTML della pagina; ritorna { html, finalUrl } o null. */
async function fetchPageHtml(
  url: URL
): Promise<{ html: string; finalUrl: URL } | null> {
  const res = await osintFetch(url.toString(), {
    headers: { Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow'
  });
  if (!res || !res.ok) return null;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType && !/html|xml|text\/plain/i.test(contentType)) return null;
  const body = await res.text();
  const html = body.slice(0, MAX_HTML_BYTES);
  const finalUrl = toUrl(res.url || url.toString()) ?? url;
  return { html, finalUrl };
}

/** Estrae gli href grezzi (anchor + link) dall'HTML. */
function extractHrefs(html: string): string[] {
  const out: string[] = [];
  const re = /<(?:a|link)\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

/** Rileva script di tracking/analytics comuni via pattern URL/globali. */
const TRACKER_SIGNATURES: {
  name: string;
  category: string;
  patterns: RegExp[];
}[] = [
  {
    name: 'Google Analytics',
    category: 'analytics',
    patterns: [
      /google-analytics\.com\/analytics\.js/i,
      /ga\(\s*['"]create/i,
      /gtag\/js\?id=UA-/i
    ]
  },
  {
    name: 'Google Analytics 4',
    category: 'analytics',
    patterns: [/gtag\/js\?id=G-/i, /googletagmanager\.com\/gtag\/js/i]
  },
  {
    name: 'Google Tag Manager',
    category: 'tag-manager',
    patterns: [/googletagmanager\.com\/gtm\.js/i, /GTM-[A-Z0-9]+/]
  },
  {
    name: 'Google Ads / DoubleClick',
    category: 'advertising',
    patterns: [
      /googlesyndication\.com/i,
      /doubleclick\.net/i,
      /googleadservices\.com/i
    ]
  },
  {
    name: 'Meta Pixel',
    category: 'advertising',
    patterns: [
      /connect\.facebook\.net\/[^"']*\/fbevents\.js/i,
      /fbq\(\s*['"]init/i
    ]
  },
  {
    name: 'Hotjar',
    category: 'behavior',
    patterns: [/static\.hotjar\.com/i, /hj\(\s*['"]/i]
  },
  {
    name: 'Microsoft Clarity',
    category: 'behavior',
    patterns: [/clarity\.ms\/tag/i]
  },
  {
    name: 'LinkedIn Insight',
    category: 'advertising',
    patterns: [/snap\.licdn\.com\/li\.lms-analytics/i]
  },
  {
    name: 'TikTok Pixel',
    category: 'advertising',
    patterns: [/analytics\.tiktok\.com/i, /ttq\.load\(/i]
  },
  {
    name: 'Twitter/X Pixel',
    category: 'advertising',
    patterns: [/static\.ads-twitter\.com\/uwt\.js/i]
  },
  {
    name: 'HubSpot',
    category: 'marketing',
    patterns: [/js\.hs-scripts\.com/i, /js\.hubspot\.com/i]
  },
  {
    name: 'Segment',
    category: 'analytics',
    patterns: [/cdn\.segment\.com\/analytics\.js/i]
  },
  {
    name: 'Matomo / Piwik',
    category: 'analytics',
    patterns: [/matomo\.js/i, /piwik\.js/i]
  },
  {
    name: 'Plausible',
    category: 'analytics',
    patterns: [/plausible\.io\/js/i]
  },
  {
    name: 'Cloudflare Insights',
    category: 'analytics',
    patterns: [/static\.cloudflareinsights\.com/i]
  },
  {
    name: 'Intercom',
    category: 'marketing',
    patterns: [/widget\.intercom\.io/i]
  },
  {
    name: 'Amplitude',
    category: 'analytics',
    patterns: [/cdn\.amplitude\.com/i]
  },
  {
    name: 'Mixpanel',
    category: 'analytics',
    patterns: [/cdn\.mxpnl\.com/i]
  }
];

/**
 * Website to Links — estrae tutti i link (interni/esterni) dalla pagina.
 */
async function websiteToLinks(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const url = toUrl(input.entity.value);
  if (!url) return osintFail('Invalid URL format', startTime);

  const page = await fetchPageHtml(url);
  if (!page) return osintFail('Unable to fetch the page', startTime);

  const base = page.finalUrl;
  const seen = new Set<string>();
  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  for (const href of extractHrefs(page.html)) {
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    const abs = toUrl(href, base.toString());
    if (!abs || !/^https?:$/i.test(abs.protocol)) continue;
    abs.hash = '';
    const key = abs.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    const internal = abs.hostname === base.hostname;
    const entity = osintEntity('website-links', 'url', key, key, {
      internal,
      host: abs.hostname
    });
    entities.push(entity);
    edges.push(
      osintEdge(
        input.entity.id,
        entity.id,
        internal ? 'Internal link' : 'External link',
        'contains'
      )
    );
    if (entities.length >= MAX_LINKS) break;
  }

  if (entities.length === 0) {
    return {
      success: true,
      entities: [],
      edges: [],
      message: 'No links found',
      executionTime: Date.now() - startTime
    };
  }

  return {
    success: true,
    entities,
    edges,
    message: `Extracted ${entities.length} link(s)`,
    executionTime: Date.now() - startTime
  };
}

/**
 * Website to Webtrackers — identifica script di tracking/analytics.
 */
async function websiteToTrackers(
  input: TransformInput
): Promise<TransformResult> {
  const startTime = Date.now();
  const url = toUrl(input.entity.value);
  if (!url) return osintFail('Invalid URL format', startTime);

  const page = await fetchPageHtml(url);
  if (!page) return osintFail('Unable to fetch the page', startTime);

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  for (const sig of TRACKER_SIGNATURES) {
    const hit = sig.patterns.find((p) => p.test(page.html));
    if (!hit) continue;
    const entity = osintEntity(
      'website-trackers',
      'organization',
      sig.name,
      sig.name,
      {
        tracker: true,
        category: sig.category,
        detectedOn: page.finalUrl.toString()
      }
    );
    entities.push(entity);
    edges.push(
      osintEdge(
        input.entity.id,
        entity.id,
        `Uses ${sig.name}`,
        'associated_with'
      )
    );
  }

  return {
    success: true,
    entities,
    edges,
    message: entities.length
      ? `Detected ${entities.length} tracker(s)`
      : 'No known trackers detected',
    executionTime: Date.now() - startTime
  };
}

/**
 * Website to Text — estrae il contenuto testuale della pagina.
 */
async function websiteToText(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const url = toUrl(input.entity.value);
  if (!url) return osintFail('Invalid URL format', startTime);

  const page = await fetchPageHtml(url);
  if (!page) return osintFail('Unable to fetch the page', startTime);

  const titleMatch = page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : '';

  const text = decodeEntities(
    page.html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_CHARS);

  if (!text) return osintFail('No text content found', startTime);

  const label = title || page.finalUrl.hostname;
  const entity = osintEntity('website-text', 'note', text, `Text: ${label}`, {
    title,
    sourceUrl: page.finalUrl.toString(),
    length: text.length,
    truncated: text.length >= MAX_TEXT_CHARS
  });
  const edge = osintEdge(
    input.entity.id,
    entity.id,
    'Page text',
    'associated_with'
  );

  return {
    success: true,
    entities: [entity],
    edges: [edge],
    message: `Extracted ${text.length} chars of text`,
    executionTime: Date.now() - startTime
  };
}

/**
 * Website Crawler — mappa struttura del sito seguendo i link interni (1 livello).
 */
async function crawlWebsite(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const url = toUrl(input.entity.value);
  if (!url) return osintFail('Invalid URL format', startTime);

  const root = await fetchPageHtml(url);
  if (!root) return osintFail('Unable to fetch the page', startTime);

  const base = root.finalUrl;
  const internal = new Set<string>();

  for (const href of extractHrefs(root.html)) {
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    const abs = toUrl(href, base.toString());
    if (!abs || !/^https?:$/i.test(abs.protocol)) continue;
    if (abs.hostname !== base.hostname) continue;
    abs.hash = '';
    internal.add(abs.toString());
    if (internal.size >= MAX_CRAWL_PAGES) break;
  }

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  for (const pageUrl of Array.from(internal)) {
    const u = new URL(pageUrl);
    const entity = osintEntity(
      'website-crawler',
      'url',
      pageUrl,
      u.pathname || '/',
      {
        host: u.hostname,
        path: u.pathname
      }
    );
    entities.push(entity);
    edges.push(osintEdge(input.entity.id, entity.id, 'Page', 'contains'));
  }

  return {
    success: true,
    entities,
    edges,
    message: `Mapped ${entities.length} internal page(s)`,
    executionTime: Date.now() - startTime
  };
}

/**
 * Estrae il dominio dall'URL
 */
async function extractDomain(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const urlValue = input.entity.value;
  const sourceId = input.entity.id;

  try {
    // Parse URL
    let url: URL;
    try {
      url = new URL(
        urlValue.startsWith('http') ? urlValue : `https://${urlValue}`
      );
    } catch {
      return {
        success: false,
        entities: [],
        edges: [],
        error: 'Invalid URL format',
        executionTime: Date.now() - startTime
      };
    }

    const domain = url.hostname;

    const entities: OSINTEntity[] = [
      {
        id: generateId(),
        type: 'domain',
        value: domain,
        label: domain,
        metadata: {
          protocol: url.protocol,
          port: url.port || (url.protocol === 'https:' ? '443' : '80'),
          path: url.pathname,
          originalUrl: urlValue
        },
        source: 'url-parser',
        verified: true,
        timestamp: new Date().toISOString()
      }
    ];

    const edges: OSINTEdge[] = [
      {
        id: generateEdgeId(),
        sourceId: sourceId,
        targetId: entities[0].id,
        label: 'Hosts',
        relationship: 'hosts'
      }
    ];

    return {
      success: true,
      entities,
      edges,
      message: `Extracted domain: ${domain}`,
      executionTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      entities: [],
      edges: [],
      error:
        error instanceof Error ? error.message : 'Failed to extract domain',
      executionTime: Date.now() - startTime
    };
  }
}

/**
 * Risolve l'IP dell'URL
 */
async function resolveUrlIp(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const urlValue = input.entity.value;
  const sourceId = input.entity.id;

  try {
    // Parse URL
    let url: URL;
    try {
      url = new URL(
        urlValue.startsWith('http') ? urlValue : `https://${urlValue}`
      );
    } catch {
      return {
        success: false,
        entities: [],
        edges: [],
        error: 'Invalid URL format',
        executionTime: Date.now() - startTime
      };
    }

    const domain = url.hostname;

    // Risolvi IP
    const addresses = await dns.resolve4(domain);

    const entities: OSINTEntity[] = addresses.map((ip) => ({
      id: generateId(),
      type: 'ip',
      value: ip,
      label: ip,
      metadata: {
        resolvedFrom: domain,
        originalUrl: urlValue
      },
      source: 'url-parser',
      verified: true,
      timestamp: new Date().toISOString()
    }));

    const edges: OSINTEdge[] = entities.map((entity) => ({
      id: generateEdgeId(),
      sourceId: sourceId,
      targetId: entity.id,
      label: 'Resolves to',
      relationship: 'resolves_to'
    }));

    return {
      success: true,
      entities,
      edges,
      message: `Resolved ${addresses.length} IP(s) for ${domain}`,
      executionTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: error instanceof Error ? error.message : 'Failed to resolve IP',
      executionTime: Date.now() - startTime
    };
  }
}

// ============================================
// Domain utilities (keyless): Domain→Root, Domain→Website
// ============================================

// Suffissi di secondo livello comuni (eTLD a due label): per estrarre il
// dominio root senza dipendere dalla Public Suffix List completa.
const MULTI_PART_TLDS = new Set([
  'co.uk',
  'org.uk',
  'gov.uk',
  'ac.uk',
  'me.uk',
  'ltd.uk',
  'plc.uk',
  'com.au',
  'net.au',
  'org.au',
  'gov.au',
  'edu.au',
  'id.au',
  'co.nz',
  'org.nz',
  'govt.nz',
  'ac.nz',
  'com.br',
  'net.br',
  'org.br',
  'gov.br',
  'co.jp',
  'or.jp',
  'ne.jp',
  'go.jp',
  'ac.jp',
  'com.cn',
  'net.cn',
  'org.cn',
  'gov.cn',
  'co.in',
  'net.in',
  'org.in',
  'gov.in',
  'com.mx',
  'com.ar',
  'com.tr',
  'com.sg',
  'com.hk',
  'com.tw',
  'co.za',
  'org.za',
  'co.kr',
  'or.kr'
]);

/** Estrae il dominio root (eTLD+1) da un hostname. */
function rootDomain(host: string): string {
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_PART_TLDS.has(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

/** Domain to Root Domain. */
async function domainToRoot(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const host = input.entity.value
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
  if (!host || !host.includes('.'))
    return osintFail('Invalid domain', startTime);

  const root = rootDomain(host);
  if (root === host) {
    return {
      success: true,
      entities: [],
      edges: [],
      message: 'Already a root domain.',
      executionTime: Date.now() - startTime
    };
  }

  const entity = osintEntity(
    'domain-utils',
    'domain',
    root,
    root,
    {
      derivedFrom: host
    },
    true
  );
  return {
    success: true,
    entities: [entity],
    edges: [osintEdge(input.entity.id, entity.id, 'Root domain', 'belongs_to')],
    message: `Root domain: ${root}`,
    executionTime: Date.now() - startTime
  };
}

/** Domain to Website: crea l'entità URL/website del dominio. */
async function domainToWebsite(
  input: TransformInput
): Promise<TransformResult> {
  const startTime = Date.now();
  const host = input.entity.value.trim().toLowerCase();
  if (!host || !host.includes('.'))
    return osintFail('Invalid domain', startTime);

  const website = `https://${host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  const entity = osintEntity(
    'domain-utils',
    'url',
    website,
    website,
    {
      derivedFrom: host
    },
    true
  );
  return {
    success: true,
    entities: [entity],
    edges: [osintEdge(input.entity.id, entity.id, 'Website', 'hosts')],
    message: `Website: ${website}`,
    executionTime: Date.now() - startTime
  };
}

// ============================================
// Wayback Machine + HTTP headers (keyless)
// ============================================

const MAX_WAYBACK = 150;

/** Domain to Wayback URLs: URL archiviate su web.archive.org (CDX API). */
async function domainWayback(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const domain = input.entity.value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (!domain || !domain.includes('.'))
    return osintFail('Invalid domain', startTime);

  const res = await osintFetch(
    `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(
      domain
    )}/*&output=json&fl=original,timestamp&collapse=urlkey&limit=${MAX_WAYBACK}`,
    { timeoutMs: 30_000 }
  );
  if (!res || !res.ok) return osintFail('Wayback request failed', startTime);
  const rows = (await res.json().catch(() => null)) as string[][] | null;
  if (!Array.isArray(rows) || rows.length <= 1) {
    return {
      success: true,
      entities: [],
      edges: [],
      message: 'No archived URLs found.',
      executionTime: Date.now() - startTime
    };
  }

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];
  const seen = new Set<string>();
  // rows[0] è l'header ["original","timestamp"]
  for (const row of rows.slice(1)) {
    const original = row[0];
    const timestamp = row[1];
    if (!original || seen.has(original)) continue;
    seen.add(original);
    const e = osintEntity('wayback', 'url', original, original, {
      firstSeen: timestamp,
      archive: `https://web.archive.org/web/${timestamp}/${original}`
    });
    entities.push(e);
    edges.push(
      osintEdge(input.entity.id, e.id, 'Archived URL', 'associated_with')
    );
    if (entities.length >= MAX_WAYBACK) break;
  }

  return {
    success: true,
    entities,
    edges,
    message: `Found ${entities.length} archived URL(s).`,
    executionTime: Date.now() - startTime
  };
}

// Firma → software server dai valori degli header.
function detectServerTech(headers: Record<string, string>): string[] {
  const tech: string[] = [];
  const server = headers['server'];
  const powered = headers['x-powered-by'];
  if (server) tech.push(server);
  if (powered) tech.push(powered);
  if (headers['x-aspnet-version'])
    tech.push(`ASP.NET ${headers['x-aspnet-version']}`);
  if (headers['x-drupal-cache'] || headers['x-generator']?.includes('Drupal'))
    tech.push('Drupal');
  if (headers['x-shopify-stage']) tech.push('Shopify');
  if (headers['x-wix-request-id']) tech.push('Wix');
  if (/cloudflare/i.test(server ?? '')) tech.push('Cloudflare');
  if (headers['x-vercel-id']) tech.push('Vercel');
  return Array.from(new Set(tech));
}

/** HTTP headers / server fingerprint della URL. */
async function httpHeaders(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const url = toUrl(input.entity.value);
  if (!url) return osintFail('Invalid URL format', startTime);

  const res = await osintFetch(url.toString(), {
    redirect: 'follow',
    timeoutMs: 20_000
  });
  if (!res) return osintFail('Unable to reach the URL', startTime);

  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const tech = detectServerTech(headers);
  const interesting = [
    'server',
    'x-powered-by',
    'content-type',
    'via',
    'x-cache',
    'strict-transport-security',
    'content-security-policy',
    'x-frame-options',
    'set-cookie'
  ]
    .filter((h) => headers[h])
    .map((h) => `${h}: ${headers[h]}`);

  const summary = `HTTP ${res.status} · ${tech.length ? tech.join(', ') : headers['server'] || 'unknown server'}`;
  const entity = osintEntity(
    'http-headers',
    'note',
    interesting.join('\n') || summary,
    summary,
    {
      status: res.status,
      finalUrl: res.url,
      tech,
      headers
    },
    true
  );
  const edges: OSINTEdge[] = [
    osintEdge(input.entity.id, entity.id, 'HTTP headers', 'associated_with')
  ];
  const entities: OSINTEntity[] = [entity];

  // Server/tech come organizzazione (se identificabile)
  if (headers['server']) {
    const org = osintEntity(
      'http-headers',
      'organization',
      headers['server'],
      headers['server'],
      {
        role: 'web-server',
        fromHeader: 'Server'
      }
    );
    entities.push(org);
    edges.push(osintEdge(entity.id, org.id, 'Server', 'associated_with'));
  }

  return {
    success: true,
    entities,
    edges,
    message: summary,
    executionTime: Date.now() - startTime
  };
}

/**
 * URL Plugin Executor
 */
export const urlPluginExecutor: PluginExecutor = {
  async execute(
    transformId: string,
    input: TransformInput
  ): Promise<TransformResult> {
    switch (transformId) {
      case 'url-extract-domain':
        return extractDomain(input);
      case 'url-resolve-ip':
        return resolveUrlIp(input);
      case 'domain-to-root':
        return domainToRoot(input);
      case 'domain-to-website':
        return domainToWebsite(input);
      case 'domain-wayback':
        return domainWayback(input);
      case 'url-http-headers':
        return httpHeaders(input);
      case 'url-website-links':
        return websiteToLinks(input);
      case 'url-website-trackers':
        return websiteToTrackers(input);
      case 'url-website-text':
        return websiteToText(input);
      case 'url-website-crawl':
        return crawlWebsite(input);
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

export default urlPluginExecutor;
