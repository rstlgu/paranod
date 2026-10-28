/**
 * EmailRep.io Plugin — richiede API key.
 *
 *
 * API: GET https://emailrep.io/{email}  (header Key, User-Agent obbligatorio)
 *   → { email, reputation, suspicious, references, details:{ blacklisted,
 *       malicious_activity, credentials_leaked, data_breach, profiles:[...],
 *       last_seen, ... } }
 */

import type {
  TransformInput,
  TransformResult,
  OSINTEntity,
  OSINTEdge,
  PluginExecutor
} from '../types';
import { osintEntity, osintEdge, osintFail } from './osint-utils';

const SOURCE = 'emailrep';

function getApiKey(input: TransformInput): string | undefined {
  const key = input.config?.apiKey;
  return typeof key === 'string' && key.trim() ? key.trim() : undefined;
}

async function emailReputation(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const email = input.entity.value.trim().toLowerCase();
  if (!email.includes('@')) return osintFail('Invalid email', startTime);
  const apiKey = getApiKey(input);
  if (!apiKey) return osintFail('EmailRep API key not configured', startTime);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let data: any;
  let status = 0;
  try {
    const res = await fetch(`https://emailrep.io/${encodeURIComponent(email)}`, {
      headers: {
        Key: apiKey,
        'User-Agent': 'PARANOD-OSINT/1.0',
        Accept: 'application/json'
      },
      signal: controller.signal
    });
    status = res.status;
    if (status === 401) return osintFail('EmailRep: invalid API key', startTime);
    if (status === 429) return osintFail('EmailRep: rate limit exceeded', startTime);
    if (!res.ok) return osintFail(`EmailRep error: ${status}`, startTime);
    data = await res.json().catch(() => null);
  } catch {
    return osintFail('EmailRep request failed or timed out', startTime);
  } finally {
    clearTimeout(timer);
  }
  if (!data) return osintFail('EmailRep returned no data', startTime);

  const details = data.details ?? {};
  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  const summary = osintEntity(
    SOURCE,
    'note',
    `Reputation: ${data.reputation ?? 'unknown'}${data.suspicious ? ' (suspicious)' : ''}`,
    `EmailRep: ${data.reputation ?? 'unknown'}`,
    {
      provider: 'emailrep.io',
      reputation: data.reputation,
      suspicious: data.suspicious,
      references: data.references,
      blacklisted: details.blacklisted,
      maliciousActivity: details.malicious_activity,
      credentialsLeaked: details.credentials_leaked,
      dataBreach: details.data_breach,
      lastSeen: details.last_seen,
      profiles: details.profiles
    },
    true
  );
  entities.push(summary);
  edges.push(osintEdge(input.entity.id, summary.id, 'Reputation', 'associated_with'));

  // Profili social collegati (details.profiles = ['twitter','github',...]).
  for (const profile of (details.profiles ?? []) as string[]) {
    const u = osintEntity(SOURCE, 'username', `${email}@${profile}`, `${profile}`, {
      service: profile,
      email
    });
    entities.push(u);
    edges.push(osintEdge(summary.id, u.id, `Profile on ${profile}`, 'associated_with'));
  }

  const flags: string[] = [];
  if (details.credentials_leaked) flags.push('credentials leaked');
  if (details.data_breach) flags.push('data breach');
  if (details.malicious_activity) flags.push('malicious activity');
  if (details.blacklisted) flags.push('blacklisted');

  return {
    success: true,
    entities,
    edges,
    message: `Reputation: ${data.reputation ?? 'unknown'}${
      flags.length ? ` · ${flags.join(', ')}` : ''
    }`,
    executionTime: Date.now() - startTime
  };
}

export const emailRepPluginExecutor: PluginExecutor = {
  async execute(
    transformId: string,
    input: TransformInput
  ): Promise<TransformResult> {
    switch (transformId) {
      case 'emailrep-reputation':
        return emailReputation(input);
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

export default emailRepPluginExecutor;
