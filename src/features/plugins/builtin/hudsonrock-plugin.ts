/**
 * HudsonRock Plugin
 * Esposizione infostealer/malware via HudsonRock Cavalier (free, no API key).
 * Input: email, username, domain.
 */

import type {
  TransformInput,
  TransformResult,
  PluginExecutor
} from '../types';
import { osintEntity, osintEdge, osintFetch, osintFail } from './osint-utils';

const SOURCE = 'hudsonrock';
const BASE = 'https://cavalier.hudsonrock.com/api/json/v2/osint-tools';

async function search(
  input: TransformInput,
  kind: 'email' | 'username' | 'domain'
): Promise<TransformResult> {
  const startTime = Date.now();
  const value = input.entity.value.trim();
  const sourceId = input.entity.id;
  if (!value) return osintFail('Empty value', startTime);

  const url = `${BASE}/search-by-${kind}?${kind}=${encodeURIComponent(value)}`;
  const res = await osintFetch(url);
  if (!res) return osintFail('HudsonRock request failed', startTime);
  if (!res.ok) return osintFail(`HudsonRock error: ${res.status}`, startTime);

  const data = (await res.json().catch(() => null)) as Record<string, any> | null;
  if (!data) return osintFail('HudsonRock returned no data', startTime);

  const message = String(data.message ?? '');
  const stealers: any[] = Array.isArray(data.stealers) ? data.stealers : [];

  // Vista dominio: HudsonRock ritorna conteggi employees/users invece di stealers.
  const employees = Number(data.total_employees ?? data.employees ?? 0);
  const users = Number(data.total_users ?? data.users ?? 0);
  const thirdParties = Number(data.total_third_parties ?? 0);

  const isExposed =
    stealers.length > 0 ||
    employees > 0 ||
    users > 0 ||
    /associated with a computer that was infected|found in/i.test(message);

  if (!isExposed) {
    return {
      success: true,
      entities: [],
      edges: [],
      message: message || 'No infostealer exposure found.',
      executionTime: Date.now() - startTime
    };
  }

  const count =
    kind === 'domain'
      ? `${employees} employees / ${users} users`
      : String(stealers.length || 'detected');

  const breach = osintEntity(
    SOURCE,
    'breach',
    `hudsonrock:${kind}:${value}`,
    `Infostealer exposure (${count})`,
    {
      provider: 'HudsonRock Cavalier',
      kind,
      message,
      stealerCount: stealers.length,
      totalEmployees: employees || undefined,
      totalUsers: users || undefined,
      totalThirdParties: thirdParties || undefined,
      totalCorporateServices: data.total_corporate_services,
      totalUserServices: data.total_user_services
    },
    true
  );

  return {
    success: true,
    entities: [breach],
    edges: [osintEdge(sourceId, breach.id, 'Infostealer exposure')],
    message: `Infostealer exposure detected for ${value}.`,
    executionTime: Date.now() - startTime
  };
}

export const hudsonRockPluginExecutor: PluginExecutor = {
  async execute(
    transformId: string,
    input: TransformInput
  ): Promise<TransformResult> {
    switch (transformId) {
      case 'hudsonrock-email':
        return search(input, 'email');
      case 'hudsonrock-username':
        return search(input, 'username');
      case 'hudsonrock-domain':
        return search(input, 'domain');
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

export default hudsonRockPluginExecutor;
