/**
 * WHOIS History Plugin — richiede API key (WhoisXML API).
 *
 *
 * API: https://whois-history.whoisxmlapi.com/api/v1
 *   ?apiKey=...&domainName=...&mode=purchase&outputFormat=JSON
 *   response: { records: Array<{ createdDateISO8601, expiresDateISO8601,
 *     registrarName, registrantContact:{ name, organization, email, country } }> }
 */

import type {
  TransformInput,
  TransformResult,
  OSINTEntity,
  OSINTEdge,
  PluginExecutor
} from '../types';
import { osintEntity, osintEdge, osintFail } from './osint-utils';

const SOURCE = 'whois-history';
const API = 'https://whois-history.whoisxmlapi.com/api/v1';
const MAX_RECORDS = 60;

interface WhoisHistoryContact {
  name?: string;
  organization?: string;
  email?: string;
  country?: string;
}

interface WhoisHistoryRecord {
  domainName?: string;
  createdDateISO8601?: string;
  updatedDateISO8601?: string;
  expiresDateISO8601?: string;
  registrarName?: string;
  registrantContact?: WhoisHistoryContact;
  administrativeContact?: WhoisHistoryContact;
}

function getApiKey(input: TransformInput): string | undefined {
  const key = input.config?.apiKey;
  return typeof key === 'string' && key.trim() ? key.trim() : undefined;
}

/**
 * Normalizza l'input in un dominio: accetta sia un dominio che un URL
 * (estrae l'hostname, rimuove `www.`).
 */
function toDomain(value: string): string {
  const raw = value.trim().toLowerCase();
  if (!raw) return '';
  let host = raw;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(raw) || raw.includes('/')) {
    try {
      host = new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname;
    } catch {
      host = raw.split('/')[0];
    }
  }
  return host.replace(/^www\./, '');
}

async function whoisHistoryLookup(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const domain = toDomain(input.entity.value);
  if (!domain) return osintFail('Empty or invalid domain/URL', startTime);
  const apiKey = getApiKey(input);
  if (!apiKey) return osintFail('WhoisXML API key not configured', startTime);

  const qs = new URLSearchParams({
    apiKey,
    domainName: domain,
    mode: 'purchase',
    outputFormat: 'JSON'
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  let data: { records?: WhoisHistoryRecord[]; recordsCount?: number } | null;
  try {
    const res = await fetch(`${API}?${qs.toString()}`, {
      headers: { 'User-Agent': 'PARANOD-OSINT/1.0', Accept: 'application/json' },
      signal: controller.signal
    });
    if (res.status === 401 || res.status === 403)
      return osintFail('WhoisXML: invalid API key or no access', startTime);
    if (!res.ok) return osintFail(`WhoisXML error: ${res.status}`, startTime);
    data = (await res.json().catch(() => null)) as typeof data;
  } catch {
    return osintFail('WhoisXML request failed or timed out', startTime);
  } finally {
    clearTimeout(timer);
  }

  const records = Array.isArray(data?.records) ? data!.records! : [];
  if (records.length === 0) {
    return {
      success: true,
      entities: [],
      edges: [],
      message: 'No historical WHOIS records found.',
      executionTime: Date.now() - startTime
    };
  }

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];
  const seenEmails = new Set<string>();
  const seenOrgs = new Set<string>();
  const seenPersons = new Set<string>();

  for (const r of records.slice(0, MAX_RECORDS)) {
    const contact = r.registrantContact ?? r.administrativeContact ?? {};
    const label = `WHOIS ${r.createdDateISO8601?.slice(0, 10) ?? ''} · ${r.registrarName ?? 'unknown registrar'}`.trim();

    const rec = osintEntity(
      SOURCE,
      'whois_record',
      `whois-hist:${domain}:${r.createdDateISO8601 ?? r.updatedDateISO8601 ?? Math.random()}`,
      label,
      {
        provider: 'whoisxmlapi',
        domain,
        createdDate: r.createdDateISO8601,
        updatedDate: r.updatedDateISO8601,
        expiresDate: r.expiresDateISO8601,
        registrar: r.registrarName,
        registrantName: contact.name,
        registrantOrg: contact.organization,
        registrantEmail: contact.email,
        registrantCountry: contact.country
      },
      true
    );
    entities.push(rec);
    edges.push(osintEdge(input.entity.id, rec.id, 'Historical WHOIS', 'registered_by'));

    const email = contact.email?.trim().toLowerCase();
    if (email && email.includes('@') && !seenEmails.has(email)) {
      seenEmails.add(email);
      const e = osintEntity(SOURCE, 'email', email, email, { role: 'registrant', domain });
      entities.push(e);
      edges.push(osintEdge(rec.id, e.id, 'Registrant email', 'associated_with'));
    }

    const org = contact.organization?.trim();
    if (org && !seenOrgs.has(org.toLowerCase())) {
      seenOrgs.add(org.toLowerCase());
      const o = osintEntity(SOURCE, 'organization', org, org, { role: 'registrant', domain });
      entities.push(o);
      edges.push(osintEdge(rec.id, o.id, 'Registrant org', 'associated_with'));
    }

    const name = contact.name?.trim();
    if (name && !seenPersons.has(name.toLowerCase())) {
      seenPersons.add(name.toLowerCase());
      const p = osintEntity(SOURCE, 'person', name, name, { role: 'registrant', domain });
      entities.push(p);
      edges.push(osintEdge(rec.id, p.id, 'Registrant', 'associated_with'));
    }
  }

  return {
    success: true,
    entities,
    edges,
    message: `Found ${records.length} historical WHOIS record(s).`,
    executionTime: Date.now() - startTime
  };
}

export const whoisHistoryPluginExecutor: PluginExecutor = {
  async execute(
    transformId: string,
    input: TransformInput
  ): Promise<TransformResult> {
    switch (transformId) {
      case 'whois-history-lookup':
      case 'whois-history-lookup-url':
        return whoisHistoryLookup(input);
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

export default whoisHistoryPluginExecutor;
