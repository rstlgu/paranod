/**
 * WHOIS Lookup Plugin
 * Ottiene informazioni di registrazione per domini
 * Utilizza API gratuite per ottenere dati WHOIS
 */

import type {
  TransformInput,
  TransformResult,
  OSINTEntity,
  OSINTEdge,
  PluginExecutor
} from '../types';

function generateId(): string {
  return `entity-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function generateEdgeId(): string {
  return `edge-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

interface WhoisData {
  domainName?: string;
  registrar?: string;
  registrarUrl?: string;
  creationDate?: string;
  expirationDate?: string;
  updatedDate?: string;
  nameServers?: string[];
  status?: string[];
  registrantName?: string;
  registrantOrg?: string;
  registrantCountry?: string;
  adminEmail?: string;
  techEmail?: string;
}

/**
 * Fetch WHOIS data using free APIs
 * Prima prova RDAP, poi fallback su who-dat.as93.net
 */
async function fetchWhoisData(
  domain: string
): Promise<{ data: WhoisData | null; error?: string }> {
  // Prova prima con RDAP (più strutturato)
  try {
    const rdapResponse = await fetch(`https://rdap.org/domain/${domain}`, {
      headers: { Accept: 'application/rdap+json' },
      next: { revalidate: 3600 }
    });

    if (rdapResponse.ok) {
      const data = await rdapResponse.json();
      return { data: parseRdapResponse(data, domain) };
    }
  } catch {
    // RDAP failed, try fallback
  }

  // Fallback: who-dat.as93.net (supporta più TLD)
  try {
    const whodatResponse = await fetch(`https://who-dat.as93.net/${domain}`, {
      next: { revalidate: 3600 }
    });

    if (whodatResponse.ok) {
      const data = await whodatResponse.json();
      return { data: parseWhodatResponse(data, domain) };
    }
  } catch {
    // Fallback also failed
  }

  // Ultimo tentativo: whoisjsonapi (più limitato)
  try {
    const jsonApiResponse = await fetch(
      `https://whoisjsonapi.com/v1/${domain}`,
      {
        headers: { Accept: 'application/json' },
        next: { revalidate: 3600 }
      }
    );

    if (jsonApiResponse.ok) {
      const data = await jsonApiResponse.json();
      return { data: parseGenericWhoisResponse(data, domain) };
    }
  } catch {
    // All APIs failed
  }

  return {
    data: null,
    error: `WHOIS lookup failed for ${domain}. The domain may not exist or WHOIS data is not publicly available.`
  };
}

/**
 * Parse who-dat.as93.net response
 */
function parseWhodatResponse(data: any, domain: string): WhoisData {
  const result: WhoisData = {
    domainName: data.domain?.name || domain
  };

  // Date
  if (data.domain?.created_date) {
    result.creationDate = data.domain.created_date;
  }
  if (data.domain?.expiration_date) {
    result.expirationDate = data.domain.expiration_date;
  }
  if (data.domain?.updated_date) {
    result.updatedDate = data.domain.updated_date;
  }

  // Nameservers
  if (data.domain?.name_servers) {
    result.nameServers = data.domain.name_servers;
  }

  // Status
  if (data.domain?.status) {
    result.status = Array.isArray(data.domain.status)
      ? data.domain.status
      : [data.domain.status];
  }

  // Registrar
  if (data.registrar?.name) {
    result.registrar = data.registrar.name;
    result.registrarUrl = data.registrar.url;
  }

  // Registrant
  if (data.registrant) {
    result.registrantName = data.registrant.name;
    result.registrantOrg = data.registrant.organization;
    result.registrantCountry = data.registrant.country;
  }

  return result;
}

/**
 * Parse generic WHOIS JSON response
 */
function parseGenericWhoisResponse(data: any, domain: string): WhoisData {
  const result: WhoisData = {
    domainName: data.domainName || data.domain || domain
  };

  // Common field names for different APIs
  result.creationDate = data.creationDate || data.created || data.creation_date;
  result.expirationDate =
    data.expirationDate || data.expires || data.expiration_date;
  result.updatedDate = data.updatedDate || data.updated || data.updated_date;
  result.registrar = data.registrar?.name || data.registrar;
  result.registrantName = data.registrant?.name || data.registrantName;
  result.registrantOrg =
    data.registrant?.organization || data.registrantOrganization;
  result.registrantCountry = data.registrant?.country || data.registrantCountry;

  if (data.nameServers || data.name_servers) {
    result.nameServers = data.nameServers || data.name_servers;
  }

  if (data.status) {
    result.status = Array.isArray(data.status) ? data.status : [data.status];
  }

  return result;
}

/**
 * Parse RDAP response to WhoisData
 */
function parseRdapResponse(data: any, domain: string): WhoisData {
  const result: WhoisData = {
    domainName: data.ldhName || domain
  };

  // Eventi (date)
  if (data.events) {
    for (const event of data.events) {
      if (event.eventAction === 'registration') {
        result.creationDate = event.eventDate;
      } else if (event.eventAction === 'expiration') {
        result.expirationDate = event.eventDate;
      } else if (event.eventAction === 'last changed') {
        result.updatedDate = event.eventDate;
      }
    }
  }

  // Nameservers
  if (data.nameservers) {
    result.nameServers = data.nameservers.map(
      (ns: any) => ns.ldhName || ns.unicodeName
    );
  }

  // Status
  if (data.status) {
    result.status = data.status;
  }

  // Entities (registrar, registrant, etc.)
  if (data.entities) {
    for (const entity of data.entities) {
      const roles = entity.roles || [];

      if (roles.includes('registrar')) {
        result.registrar =
          entity.vcardArray?.[1]?.find((v: any) => v[0] === 'fn')?.[3] ||
          entity.publicIds?.[0]?.identifier;
        result.registrarUrl = entity.links?.find(
          (l: any) => l.rel === 'self'
        )?.href;
      }

      if (roles.includes('registrant')) {
        const vcard = entity.vcardArray?.[1] || [];
        result.registrantName = vcard.find((v: any) => v[0] === 'fn')?.[3];
        result.registrantOrg = vcard.find((v: any) => v[0] === 'org')?.[3];
        const adr = vcard.find((v: any) => v[0] === 'adr');
        if (adr && adr[3]) {
          result.registrantCountry = adr[3].country || adr[3][6];
        }
      }
    }
  }

  return result;
}

/**
 * WHOIS Lookup transform
 */
async function whoisLookup(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const domain = input.entity.value.toLowerCase().trim();
  const sourceId = input.entity.id;

  // Valida dominio
  const domainRegex =
    /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
  if (!domainRegex.test(domain)) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: 'Invalid domain format',
      executionTime: Date.now() - startTime
    };
  }

  const whoisResult = await fetchWhoisData(domain);

  if (!whoisResult.data) {
    const errorMsg = whoisResult.error || 'Failed to fetch WHOIS data';
    return {
      success: false,
      entities: [],
      edges: [],
      error: `WHOIS lookup failed: ${errorMsg}`,
      executionTime: Date.now() - startTime
    };
  }

  const whoisData = whoisResult.data;
  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  // Registrar entity
  if (whoisData.registrar) {
    const registrarEntity: OSINTEntity = {
      id: generateId(),
      type: 'organization',
      value: whoisData.registrar,
      label: `${whoisData.registrar} (Registrar)`,
      metadata: {
        type: 'registrar',
        url: whoisData.registrarUrl
      },
      source: 'whois-lookup',
      verified: true,
      timestamp: new Date().toISOString()
    };
    entities.push(registrarEntity);
    edges.push({
      id: generateEdgeId(),
      sourceId,
      targetId: registrarEntity.id,
      label: 'Registered by',
      relationship: 'registered_by'
    });
  }

  // Registrant organization
  if (whoisData.registrantOrg) {
    const orgEntity: OSINTEntity = {
      id: generateId(),
      type: 'organization',
      value: whoisData.registrantOrg,
      label: `${whoisData.registrantOrg} (Owner)`,
      metadata: {
        type: 'registrant',
        country: whoisData.registrantCountry
      },
      source: 'whois-lookup',
      verified: true,
      timestamp: new Date().toISOString()
    };
    entities.push(orgEntity);
    edges.push({
      id: generateEdgeId(),
      sourceId,
      targetId: orgEntity.id,
      label: 'Owned by',
      relationship: 'owns'
    });
  }

  // Registrant person (if different from org)
  if (
    whoisData.registrantName &&
    whoisData.registrantName !== whoisData.registrantOrg
  ) {
    const personEntity: OSINTEntity = {
      id: generateId(),
      type: 'person',
      value: whoisData.registrantName,
      label: whoisData.registrantName,
      metadata: {
        role: 'registrant',
        country: whoisData.registrantCountry
      },
      source: 'whois-lookup',
      verified: true,
      timestamp: new Date().toISOString()
    };
    entities.push(personEntity);
    edges.push({
      id: generateEdgeId(),
      sourceId,
      targetId: personEntity.id,
      label: 'Registered by',
      relationship: 'registered_by'
    });
  }

  // Nameservers come nodi separati
  if (whoisData.nameServers && whoisData.nameServers.length > 0) {
    for (const ns of whoisData.nameServers) {
      const nsEntity: OSINTEntity = {
        id: generateId(),
        type: 'domain',
        value: ns.toLowerCase(),
        label: `NS: ${ns}`,
        metadata: {
          type: 'nameserver',
          parentDomain: domain
        },
        source: 'whois-lookup',
        verified: true,
        timestamp: new Date().toISOString()
      };
      entities.push(nsEntity);
      edges.push({
        id: generateEdgeId(),
        sourceId,
        targetId: nsEntity.id,
        label: 'Uses NS',
        relationship: 'uses_nameserver'
      });
    }
  }

  // Formatta le date per visualizzazione
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toLocaleDateString('it-IT', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  const createdStr = formatDate(whoisData.creationDate);
  const expiresStr = formatDate(whoisData.expirationDate);

  // Build a descriptive label
  const labelParts: string[] = [];
  if (createdStr) labelParts.push(`📅 Created: ${createdStr}`);
  if (expiresStr) labelParts.push(`⏰ Expires: ${expiresStr}`);
  if (whoisData.status && whoisData.status.length > 0) {
    labelParts.push(`Status: ${whoisData.status[0]}`);
  }

  // Domain info entity (con date e status)
  const domainInfoEntity: OSINTEntity = {
    id: generateId(),
    type: 'note',
    value: `WHOIS: ${domain}`,
    label: labelParts.length > 0 ? labelParts.join('\n') : 'WHOIS Record',
    metadata: {
      domainName: whoisData.domainName,
      creationDate: whoisData.creationDate,
      expirationDate: whoisData.expirationDate,
      updatedDate: whoisData.updatedDate,
      status: whoisData.status?.join(', ') || 'active',
      // Date formattate per visualizzazione
      created: createdStr,
      expires: expiresStr,
      updated: formatDate(whoisData.updatedDate)
    },
    source: 'whois-lookup',
    verified: true,
    timestamp: new Date().toISOString()
  };
  entities.push(domainInfoEntity);
  edges.push({
    id: generateEdgeId(),
    sourceId,
    targetId: domainInfoEntity.id,
    label: 'WHOIS Info',
    relationship: 'contains'
  });

  return {
    success: true,
    entities,
    edges,
    message: `Found WHOIS data: ${entities.length} entities`,
    metadata: { whoisData },
    executionTime: Date.now() - startTime
  };
}

/**
 * WHOIS Plugin Executor
 */
export const whoisPluginExecutor: PluginExecutor = {
  async execute(
    transformId: string,
    input: TransformInput
  ): Promise<TransformResult> {
    switch (transformId) {
      case 'whois-lookup':
        return whoisLookup(input);
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

export default whoisPluginExecutor;
