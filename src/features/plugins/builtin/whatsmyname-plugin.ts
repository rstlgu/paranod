/**
 * WhatsMyName Plugin — username enumeration keyless, data-driven.
 *
 * Basato sul dataset WhatsMyName (github.com/WebBreacher/WhatsMyName): per ogni
 * sito, se GET uri_check (con {account}) risponde con `e_code` E il body contiene
 * `e_string`, l'account esiste. Motore nativo in-app (niente container).
 * Uses public data without a provider API key.
 *
 * Nota: enumerazione = molte richieste HTTP. Concorrenza limitata + deadline
 * globale; oltre il budget, i siti restanti sono saltati (best-effort).
 */

import type {
  TransformInput,
  TransformResult,
  OSINTEntity,
  OSINTEdge,
  PluginExecutor
} from '../types';
import { osintEntity, osintEdge, osintFail } from './osint-utils';
import sitesData from './data/whatsmyname.json';

const SOURCE = 'whatsmyname';
const CONCURRENCY = 40;
const PER_SITE_TIMEOUT_MS = 6_000;
const GLOBAL_DEADLINE_MS = 55_000;
const MAX_BODY_BYTES = 200_000;

interface Site {
  n: string; // name
  u: string; // uri_check template
  c: number | null; // expected HTTP code
  s: string; // expected string in body
  cat: string; // category
}

const SITES = sitesData as Site[];

const USERNAME_RE = /^[a-zA-Z0-9._-]{1,64}$/;

/** Verifica un singolo sito; ritorna la URL del profilo se l'account esiste. */
async function checkSite(
  site: Site,
  username: string,
  deadline: number
): Promise<{ site: Site; url: string } | null> {
  const url = site.u.replace(/\{account\}/g, encodeURIComponent(username));
  const remaining = deadline - Date.now();
  if (remaining <= 0) return null;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.min(PER_SITE_TIMEOUT_MS, remaining)
  );
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; PARANOD-OSINT/1.0; +https://paranod.com)',
        Accept: 'text/html,application/xhtml+xml,application/json'
      }
    });
    if (site.c != null && res.status !== site.c) return null;
    if (!site.s) return res.status === site.c ? { site, url } : null;

    // Legge solo la parte iniziale del body.
    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      return text.includes(site.s) ? { site, url } : null;
    }
    let received = 0;
    let buf = '';
    const decoder = new TextDecoder();
    while (received < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      buf += decoder.decode(value, { stream: true });
      if (buf.includes(site.s)) {
        void reader.cancel();
        return { site, url };
      }
    }
    return buf.includes(site.s) ? { site, url } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Pool a concorrenza limitata con deadline globale. */
async function runPool(
  username: string
): Promise<Array<{ site: Site; url: string }>> {
  const deadline = Date.now() + GLOBAL_DEADLINE_MS;
  const results: Array<{ site: Site; url: string }> = [];
  let index = 0;

  async function worker() {
    while (index < SITES.length && Date.now() < deadline) {
      const site = SITES[index++];
      const hit = await checkSite(site, username, deadline);
      if (hit) results.push(hit);
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
  return results;
}

async function findAccounts(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const username = input.entity.value.trim();
  if (!USERNAME_RE.test(username)) {
    return osintFail('Invalid username format', startTime);
  }

  const hits = await runPool(username);
  const checked = SITES.length;

  if (hits.length === 0) {
    return {
      success: true,
      entities: [],
      edges: [],
      message: `No accounts found across ${checked} sites.`,
      executionTime: Date.now() - startTime
    };
  }

  const isImageUrl = (u: string): boolean =>
    /\.(jpe?g|png|gif|webp|bmp|svg|ico)(\?|#|$)/i.test(u) ||
    /(gravatar\.com\/avatar|\/avatar[s]?\/|profile_images|pbs\.twimg\.com\/profile|avatars\.githubusercontent)/i.test(
      u
    );

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];
  for (const { site, url } of hits) {
    if (isImageUrl(url)) {
      const img = osintEntity(
        SOURCE,
        'media_url',
        url,
        url,
        {
          site: site.n,
          category: site.cat,
          username,
          url,
          fileUrl: url,
          customTitle: `${site.n} image`,
          provider: 'whatsmyname'
        },
        true
      );
      entities.push(img);
      edges.push(osintEdge(input.entity.id, img.id, `Image on ${site.n}`, 'associated_with'));
      continue;
    }
    const e = osintEntity(
      SOURCE,
      'social',
      url,
      url,
      {
        site: site.n,
        category: site.cat,
        username,
        url,
        customTitle: `${site.n} account`,
        provider: 'whatsmyname'
      },
      true
    );
    entities.push(e);
    edges.push(osintEdge(input.entity.id, e.id, `Account on ${site.n}`, 'associated_with'));
  }

  return {
    success: true,
    entities,
    edges,
    message: `Found ${hits.length} account(s) across ${checked} sites.`,
    metadata: { found: hits.length, checked },
    executionTime: Date.now() - startTime
  };
}

export const whatsMyNamePluginExecutor: PluginExecutor = {
  async execute(
    transformId: string,
    input: TransformInput
  ): Promise<TransformResult> {
    switch (transformId) {
      case 'whatsmyname-search':
        return findAccounts(input);
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

export default whatsMyNamePluginExecutor;
