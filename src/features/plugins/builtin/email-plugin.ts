/**
 * Email Parser Plugin
 * Analizza e valida indirizzi email
 */

import crypto from 'crypto';
import { promises as dns } from 'dns';
import type {
  TransformInput,
  TransformResult,
  OSINTEntity,
  OSINTEdge,
  PluginExecutor,
  EmailValidation
} from '../types';
import { osintEntity, osintEdge, osintFetch, osintFail } from './osint-utils';

const SOURCE = 'email-parser';

function generateId(): string {
  return `entity-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function generateEdgeId(): string {
  return `edge-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Valida formato email
 */
function isValidEmailFormat(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Lista domini email temporanei/disposable comuni
 */
const disposableDomains = new Set([
  'tempmail.com',
  'throwaway.email',
  'guerrillamail.com',
  'mailinator.com',
  '10minutemail.com',
  'temp-mail.org',
  'fakeinbox.com',
  'trashmail.com',
  'yopmail.com'
]);

/**
 * Estrae il dominio dall'email
 */
async function extractDomain(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const email = input.entity.value.toLowerCase().trim();
  const sourceId = input.entity.id;

  if (!isValidEmailFormat(email)) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: 'Invalid email format',
      executionTime: Date.now() - startTime
    };
  }

  const [localPart, domain] = email.split('@');

  const entity: OSINTEntity = {
    id: generateId(),
    type: 'domain',
    value: domain,
    label: domain,
    metadata: {
      extractedFrom: email,
      localPart: localPart
    },
    source: 'email-parser',
    verified: true,
    timestamp: new Date().toISOString()
  };

  const edge: OSINTEdge = {
    id: generateEdgeId(),
    sourceId: sourceId,
    targetId: entity.id,
    label: 'Domain',
    relationship: 'extracted_from',
    metadata: {}
  };

  return {
    success: true,
    entities: [entity],
    edges: [edge],
    message: `Extracted domain: ${domain}`,
    executionTime: Date.now() - startTime
  };
}

/**
 * Valida email (formato + verifica MX del dominio)
 */
async function validateEmail(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const email = input.entity.value.toLowerCase().trim();
  const sourceId = input.entity.id;

  const validation: EmailValidation = {
    valid: false,
    domain: '',
    local: '',
    format: false
  };

  // Check formato
  if (!isValidEmailFormat(email)) {
    return {
      success: true,
      entities: [
        {
          id: generateId(),
          type: 'email',
          value: email,
          label: `${email} (Invalid)`,
          metadata: {
            validation: {
              ...validation,
              error: 'Invalid format'
            }
          },
          source: 'email-parser',
          verified: false,
          timestamp: new Date().toISOString()
        }
      ],
      edges: [],
      message: 'Email format is invalid',
      executionTime: Date.now() - startTime
    };
  }

  const [localPart, domain] = email.split('@');
  validation.format = true;
  validation.local = localPart;
  validation.domain = domain;
  validation.disposable = disposableDomains.has(domain);

  // Verifica MX records del dominio (deliverability): conserva i mail server.
  let hasMX = false;
  let mxRecords: { exchange: string; priority: number }[] = [];
  try {
    mxRecords = await dns.resolveMx(domain);
    hasMX = mxRecords.length > 0;
  } catch {
    hasMX = false;
  }

  validation.valid = hasMX && !validation.disposable;

  const mxSorted = [...mxRecords].sort((a, b) => a.priority - b.priority);
  const entity: OSINTEntity = {
    id: generateId(),
    type: 'email',
    value: email,
    label: `${email} (${validation.valid ? 'Valid' : 'Invalid'})`,
    metadata: {
      validation,
      hasMX,
      isDisposable: validation.disposable,
      mxRecords: mxSorted
    },
    source: 'email-parser',
    verified: validation.valid,
    timestamp: new Date().toISOString()
  };

  const edge: OSINTEdge = {
    id: generateEdgeId(),
    sourceId: sourceId,
    targetId: entity.id,
    label: 'Validated',
    relationship: 'associated_with',
    metadata: { validated: true }
  };

  const entities: OSINTEntity[] = [entity];
  const edges: OSINTEdge[] = [edge];

  // Mail server (MX) come entità domain: mostra l'infrastruttura mail (es. Google
  // Workspace, Outlook) e permette pivot su di essa.
  const seenMx = new Set<string>();
  for (const mx of mxSorted) {
    const host = mx.exchange?.trim().toLowerCase();
    if (!host || seenMx.has(host)) continue;
    seenMx.add(host);
    const mxEntity: OSINTEntity = {
      id: generateId(),
      type: 'domain',
      value: host,
      label: `${host} (MX)`,
      metadata: { recordType: 'MX', priority: mx.priority, forEmailDomain: domain },
      source: 'email-parser',
      verified: true,
      timestamp: new Date().toISOString()
    };
    entities.push(mxEntity);
    edges.push({
      id: generateEdgeId(),
      sourceId: entity.id,
      targetId: mxEntity.id,
      label: `Mail server (pri ${mx.priority})`,
      relationship: 'resolves_to',
      metadata: { recordType: 'MX' }
    });
  }

  let message = '';
  if (!hasMX) message = 'Domain has no MX records (likely undeliverable)';
  else if (validation.disposable) message = 'Disposable email domain detected';
  else message = `Email appears valid · ${mxSorted.length} MX server(s)`;

  return {
    success: true,
    entities,
    edges,
    message,
    metadata: { validation, mxRecords: mxSorted },
    executionTime: Date.now() - startTime
  };
}

/**
 * Gravatar: profilo/avatar pubblico legato all'email (gravatar.com, no key).
 */
async function gravatarLookup(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const email = input.entity.value.trim().toLowerCase();
  const sourceId = input.entity.id;
  if (!isValidEmailFormat(email)) return osintFail('Invalid email format', startTime);

  const hash = crypto.createHash('md5').update(email).digest('hex');
  const res = await osintFetch(`https://www.gravatar.com/${hash}.json`);
  if (!res || res.status === 404) {
    return {
      success: true,
      entities: [],
      edges: [],
      message: 'No public Gravatar profile for this email.',
      executionTime: Date.now() - startTime
    };
  }
  if (!res.ok) return osintFail(`Gravatar error: ${res.status}`, startTime);

  const data = (await res.json().catch(() => null)) as {
    entry?: Array<Record<string, any>>;
  } | null;
  const entry = data?.entry?.[0];
  if (!entry) {
    return {
      success: true,
      entities: [],
      edges: [],
      message: 'No public Gravatar profile for this email.',
      executionTime: Date.now() - startTime
    };
  }

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  const avatarUrl = `https://www.gravatar.com/avatar/${hash}?s=400`;
  const avatar = osintEntity(
    SOURCE,
    'media_url',
    avatarUrl,
    entry.displayName ? `${entry.displayName} (avatar)` : 'Gravatar avatar',
    { url: avatarUrl, displayName: entry.displayName, aboutMe: entry.aboutMe },
    true
  );
  entities.push(avatar);
  edges.push(osintEdge(sourceId, avatar.id, 'Gravatar avatar'));

  const profileUrl: string =
    entry.profileUrl || `https://gravatar.com/${entry.hash ?? hash}`;
  const profile = osintEntity(SOURCE, 'url', profileUrl, 'Gravatar profile', {
    displayName: entry.displayName
  });
  entities.push(profile);
  edges.push(osintEdge(sourceId, profile.id, 'Gravatar profile'));

  for (const acc of (entry.accounts ?? []) as Array<Record<string, any>>) {
    const uname = String(acc.username ?? acc.display ?? '').trim();
    if (!uname) continue;
    const u = osintEntity(
      SOURCE,
      'username',
      uname,
      `${uname} (${acc.shortname ?? acc.name ?? 'account'})`,
      { service: acc.shortname ?? acc.name, url: acc.url }
    );
    entities.push(u);
    edges.push(osintEdge(avatar.id, u.id, String(acc.name ?? 'account')));
  }

  return {
    success: true,
    entities,
    edges,
    message: `Gravatar profile found${entry.displayName ? `: ${entry.displayName}` : ''}.`,
    executionTime: Date.now() - startTime
  };
}

/**
 * Email Plugin Executor
 */
export const emailPluginExecutor: PluginExecutor = {
  async execute(
    transformId: string,
    input: TransformInput
  ): Promise<TransformResult> {
    switch (transformId) {
      case 'email-extract-domain':
        return extractDomain(input);
      case 'email-validate':
        return validateEmail(input);
      case 'email-gravatar':
        return gravatarLookup(input);
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

export default emailPluginExecutor;
