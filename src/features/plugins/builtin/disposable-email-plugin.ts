/**
 * Disposable Email Domains Plugin — keyless, dataset locale.
 *
 * Basato sulla lista disposable-email-domains (github.com/disposable-email-domains).
 * Verifica se un'email (o un dominio) è un provider usa-e-getta / temporaneo.
 * Nessuna rete: lookup O(1) su un Set vendorizzato (data/disposable-domains.json).
 * Uses public data without a provider API key.
 */

import type {
  TransformInput,
  TransformResult,
  PluginExecutor
} from '../types';
import { osintEntity, osintEdge, osintFail } from './osint-utils';
import disposableList from './data/disposable-domains.json';

const SOURCE = 'disposable-email';
const DISPOSABLE = new Set<string>(disposableList as string[]);

/** Estrae il dominio da un'email o normalizza un dominio. */
function domainOf(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (v.includes('@')) {
    const d = v.split('@')[1]?.trim();
    return d && d.includes('.') ? d : null;
  }
  return v.includes('.') ? v.replace(/^www\./, '') : null;
}

async function checkDisposable(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const domain = domainOf(input.entity.value);
  if (!domain) return osintFail('Invalid email or domain', startTime);

  const isDisposable = DISPOSABLE.has(domain);

  const entity = osintEntity(
    SOURCE,
    'note',
    isDisposable ? `Disposable: ${domain}` : `Not disposable: ${domain}`,
    isDisposable
      ? `⚠️ Disposable email domain: ${domain}`
      : `✓ Not a known disposable domain: ${domain}`,
    {
      domain,
      disposable: isDisposable,
      listSize: DISPOSABLE.size,
      provider: 'disposable-email-domains'
    },
    true
  );

  return {
    success: true,
    entities: [entity],
    edges: [
      osintEdge(
        input.entity.id,
        entity.id,
        isDisposable ? 'Disposable domain' : 'Domain reputation',
        'associated_with'
      )
    ],
    message: isDisposable
      ? `${domain} is a disposable/temporary email domain.`
      : `${domain} is not in the disposable list (${DISPOSABLE.size} domains).`,
    metadata: { disposable: isDisposable, domain },
    executionTime: Date.now() - startTime
  };
}

export const disposableEmailPluginExecutor: PluginExecutor = {
  async execute(
    transformId: string,
    input: TransformInput
  ): Promise<TransformResult> {
    switch (transformId) {
      case 'disposable-check-email':
      case 'disposable-check-domain':
        return checkDisposable(input);
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

export default disposableEmailPluginExecutor;
