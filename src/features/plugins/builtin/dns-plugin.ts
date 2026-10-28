/**
 * DNS Lookup Plugin
 * Risolve record DNS per domini
 */

import { promises as dns } from 'dns';
import type {
  TransformInput,
  TransformResult,
  OSINTEntity,
  OSINTEdge,
  PluginExecutor,
  DNSRecord
} from '../types';

function generateId(): string {
  return `entity-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function generateEdgeId(): string {
  return `edge-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Risolve A records (IPv4)
 */
async function resolveARecords(
  input: TransformInput
): Promise<TransformResult> {
  const startTime = Date.now();
  const domain = input.entity.value;
  const sourceId = input.entity.id;

  try {
    const addresses = await dns.resolve4(domain);

    const entities: OSINTEntity[] = addresses.map((ip) => ({
      id: generateId(),
      type: 'ip',
      value: ip,
      label: ip,
      metadata: {
        recordType: 'A',
        domain: domain
      },
      source: 'dns-lookup',
      verified: true,
      timestamp: new Date().toISOString()
    }));

    const edges: OSINTEdge[] = entities.map((entity) => ({
      id: generateEdgeId(),
      sourceId: sourceId,
      targetId: entity.id,
      label: 'Resolves to',
      relationship: 'resolves_to',
      metadata: { recordType: 'A' }
    }));

    return {
      success: true,
      entities,
      edges,
      message: `Found ${addresses.length} A record(s)`,
      executionTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: error instanceof Error ? error.message : 'DNS resolution failed',
      executionTime: Date.now() - startTime
    };
  }
}

/**
 * Risolve MX records (mail servers)
 */
async function resolveMXRecords(
  input: TransformInput
): Promise<TransformResult> {
  const startTime = Date.now();
  const domain = input.entity.value;
  const sourceId = input.entity.id;

  // Prova prima con il dominio originale, poi con il dominio base
  const domainsToTry = [domain];
  const baseDomain = getBaseDomain(domain);
  if (baseDomain !== domain) {
    domainsToTry.push(baseDomain);
  }

  for (const tryDomain of domainsToTry) {
    try {
      const records = await dns.resolveMx(tryDomain);

      const entities: OSINTEntity[] = records.map((record) => ({
        id: generateId(),
        type: 'domain',
        value: record.exchange,
        label: `${record.exchange} (MX)`,
        metadata: {
          recordType: 'MX',
          priority: record.priority,
          parentDomain: tryDomain
        },
        source: 'dns-lookup',
        verified: true,
        timestamp: new Date().toISOString()
      }));

      const edges: OSINTEdge[] = entities.map((entity) => ({
        id: generateEdgeId(),
        sourceId: sourceId,
        targetId: entity.id,
        label: `MX (pri: ${(entity.metadata as Record<string, unknown>).priority})`,
        relationship: 'resolves_to',
        metadata: { recordType: 'MX' }
      }));

      const message =
        tryDomain !== domain
          ? `Found ${records.length} MX record(s) for ${tryDomain}`
          : `Found ${records.length} MX record(s)`;

      return {
        success: true,
        entities,
        edges,
        message,
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('ENODATA') &&
        domainsToTry.indexOf(tryDomain) < domainsToTry.length - 1
      ) {
        continue;
      }
      if (domainsToTry.indexOf(tryDomain) === domainsToTry.length - 1) {
        const errorMsg =
          error instanceof Error ? error.message : 'MX resolution failed';
        return {
          success: false,
          entities: [],
          edges: [],
          error: errorMsg.includes('ENODATA')
            ? `No MX records found for ${domain}. Try with the base domain (${baseDomain}).`
            : errorMsg,
          executionTime: Date.now() - startTime
        };
      }
    }
  }

  return {
    success: false,
    entities: [],
    edges: [],
    error: 'MX resolution failed',
    executionTime: Date.now() - startTime
  };
}

/**
 * Estrae il dominio base da un subdomain (es. www.google.com -> google.com)
 */
function getBaseDomain(domain: string): string {
  const parts = domain.split('.');
  if (parts.length > 2) {
    // Gestisce TLD composti come .co.uk, .com.br
    const knownCompoundTLDs = ['co.uk', 'com.br', 'com.au', 'co.jp', 'org.uk'];
    const lastTwo = parts.slice(-2).join('.');
    if (knownCompoundTLDs.includes(lastTwo)) {
      return parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
  }
  return domain;
}

/**
 * Risolve NS records (nameservers)
 */
async function resolveNSRecords(
  input: TransformInput
): Promise<TransformResult> {
  const startTime = Date.now();
  const domain = input.entity.value;
  const sourceId = input.entity.id;

  // Prova prima con il dominio originale, poi con il dominio base
  const domainsToTry = [domain];
  const baseDomain = getBaseDomain(domain);
  if (baseDomain !== domain) {
    domainsToTry.push(baseDomain);
  }

  for (const tryDomain of domainsToTry) {
    try {
      const nameservers = await dns.resolveNs(tryDomain);

      const entities: OSINTEntity[] = nameservers.map((ns) => ({
        id: generateId(),
        type: 'domain',
        value: ns,
        label: `${ns} (NS)`,
        metadata: {
          recordType: 'NS',
          parentDomain: tryDomain,
          queriedDomain: domain
        },
        source: 'dns-lookup',
        verified: true,
        timestamp: new Date().toISOString()
      }));

      const edges: OSINTEdge[] = entities.map((entity) => ({
        id: generateEdgeId(),
        sourceId: sourceId,
        targetId: entity.id,
        label: 'Nameserver',
        relationship: 'resolves_to',
        metadata: { recordType: 'NS' }
      }));

      const message =
        tryDomain !== domain
          ? `Found ${nameservers.length} nameserver(s) for ${tryDomain}`
          : `Found ${nameservers.length} nameserver(s)`;

      return {
        success: true,
        entities,
        edges,
        message,
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      // Se ENODATA e abbiamo altri domini da provare, continua
      if (
        error instanceof Error &&
        error.message.includes('ENODATA') &&
        domainsToTry.indexOf(tryDomain) < domainsToTry.length - 1
      ) {
        continue;
      }
      // Altrimenti, se è l'ultimo tentativo, ritorna errore
      if (domainsToTry.indexOf(tryDomain) === domainsToTry.length - 1) {
        const errorMsg =
          error instanceof Error ? error.message : 'NS resolution failed';
        return {
          success: false,
          entities: [],
          edges: [],
          error: errorMsg.includes('ENODATA')
            ? `No NS records found for ${domain}. Try with the base domain (${baseDomain}).`
            : errorMsg,
          executionTime: Date.now() - startTime
        };
      }
    }
  }

  return {
    success: false,
    entities: [],
    edges: [],
    error: 'NS resolution failed',
    executionTime: Date.now() - startTime
  };
}

/**
 * Risolve TXT records
 */
async function resolveTXTRecords(
  input: TransformInput
): Promise<TransformResult> {
  const startTime = Date.now();
  const domain = input.entity.value;
  const sourceId = input.entity.id;

  try {
    const records = await dns.resolveTxt(domain);

    const entities: OSINTEntity[] = records.map((record, index) => {
      const txtValue = record.join('');
      let label = `TXT Record ${index + 1}`;

      // Detect common TXT record types
      if (txtValue.startsWith('v=spf1')) label = 'SPF Record';
      else if (txtValue.startsWith('v=DKIM1')) label = 'DKIM Record';
      else if (txtValue.startsWith('v=DMARC1')) label = 'DMARC Record';
      else if (txtValue.includes('google-site-verification'))
        label = 'Google Verification';
      else if (txtValue.includes('MS=')) label = 'Microsoft Verification';

      return {
        id: generateId(),
        type: 'dns_record' as const,
        value:
          txtValue.substring(0, 100) + (txtValue.length > 100 ? '...' : ''),
        label,
        metadata: {
          recordType: 'TXT',
          fullValue: txtValue,
          parentDomain: domain
        },
        source: 'dns-lookup',
        verified: true,
        timestamp: new Date().toISOString()
      };
    });

    const edges: OSINTEdge[] = entities.map((entity) => ({
      id: generateEdgeId(),
      sourceId: sourceId,
      targetId: entity.id,
      label: 'TXT Record',
      relationship: 'contains',
      metadata: { recordType: 'TXT' }
    }));

    return {
      success: true,
      entities,
      edges,
      message: `Found ${records.length} TXT record(s)`,
      executionTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: error instanceof Error ? error.message : 'TXT resolution failed',
      executionTime: Date.now() - startTime
    };
  }
}

/**
 * Record DNS aggiuntivi in un colpo solo: AAAA (IPv6), CNAME, SOA, CAA.
 * Ogni lookup è best-effort (ENODATA/NXDOMAIN → semplicemente assente).
 */
async function resolveExtraRecords(
  input: TransformInput
): Promise<TransformResult> {
  const startTime = Date.now();
  const domain = input.entity.value.trim().toLowerCase();
  const sourceId = input.entity.id;

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  const add = (
    type: OSINTEntity['type'],
    value: string,
    label: string,
    metadata: Record<string, unknown>,
    rel: OSINTEdge['relationship'],
    edgeLabel: string
  ) => {
    const e: OSINTEntity = {
      id: generateId(),
      type,
      value,
      label,
      metadata: { ...metadata, parentDomain: domain },
      source: 'dns-lookup',
      verified: true,
      timestamp: new Date().toISOString()
    };
    entities.push(e);
    edges.push({
      id: generateEdgeId(),
      sourceId,
      targetId: e.id,
      label: edgeLabel,
      relationship: rel,
      metadata: {}
    });
  };

  // AAAA (IPv6)
  try {
    for (const ip of await dns.resolve6(domain))
      add('ip', ip, ip, { recordType: 'AAAA' }, 'resolves_to', 'AAAA');
  } catch {
    /* assente */
  }

  // CNAME
  try {
    for (const cname of await dns.resolveCname(domain))
      add('domain', cname, `${cname} (CNAME)`, { recordType: 'CNAME' }, 'resolves_to', 'CNAME');
  } catch {
    /* assente */
  }

  // SOA
  try {
    const soa = await dns.resolveSoa(domain);
    add(
      'dns_record',
      `${soa.nsname} ${soa.hostmaster}`,
      `SOA (${soa.nsname})`,
      { recordType: 'SOA', ...soa },
      'contains',
      'SOA'
    );
  } catch {
    /* assente */
  }

  // CAA
  try {
    const caa = await dns.resolveCaa(domain);
    for (const rec of caa) {
      const issuer = rec.issue || rec.issuewild || rec.iodef || JSON.stringify(rec);
      add(
        'dns_record',
        String(issuer),
        `CAA: ${issuer}`,
        { recordType: 'CAA', ...rec },
        'contains',
        'CAA'
      );
    }
  } catch {
    /* assente */
  }

  return {
    success: true,
    entities,
    edges,
    message: entities.length
      ? `Found ${entities.length} additional DNS record(s) (AAAA/CNAME/SOA/CAA)`
      : 'No AAAA/CNAME/SOA/CAA records found',
    executionTime: Date.now() - startTime
  };
}

/**
 * DNS Plugin Executor
 */
export const dnsPluginExecutor: PluginExecutor = {
  async execute(
    transformId: string,
    input: TransformInput
  ): Promise<TransformResult> {
    switch (transformId) {
      case 'dns-resolve-a':
        return resolveARecords(input);
      case 'dns-resolve-mx':
        return resolveMXRecords(input);
      case 'dns-resolve-ns':
        return resolveNSRecords(input);
      case 'dns-resolve-txt':
        return resolveTXTRecords(input);
      case 'dns-resolve-extra':
        return resolveExtraRecords(input);
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

export default dnsPluginExecutor;
