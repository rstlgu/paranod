/**
 * Config service (server-only) — gestione strutturata delle configurazioni di
 * plugin builtin e addon: schema tipizzato (string/number/boolean/select,
 * secret, required), validazione, cifratura at-rest dei secret e mascheramento
 * verso il client.
 *
 * Regole secret:
 * - Il valore di un campo `secret: true` NON lascia mai il server: al client
 *   arriva solo il sentinel `SECRET_PLACEHOLDER` se impostato.
 * - Al salvataggio, un valore uguale al sentinel = "non cambiato" (mantiene
 *   l'esistente); stringa vuota = rimozione; altro valore = nuova chiave,
 *   cifrata con AES-256-GCM (src/lib/security/secrets.ts).
 * - La decifratura avviene solo al momento dell'esecuzione, server-side.
 */

import type { ConfigField, PluginDefinition } from './types';
import { getPlugin } from './registry';
import {
  encryptSecret,
  decryptSecret,
  isEncryptedSecret
} from '@/lib/security/secrets';

import { SECRET_PLACEHOLDER } from './config-constants';

export { SECRET_PLACEHOLDER };

export type ConfigSchema = Record<string, ConfigField>;

export function getBuiltinConfigSchema(pluginId: string): ConfigSchema {
  const plugin: PluginDefinition | undefined = getPlugin(pluginId);
  return plugin?.configSchema ?? {};
}

// NB addon: il manifest NON può dichiarare campi config da mostrare in app
// (deciso 2026-07-08, vettore phishing: un manifest malevolo può chiedere
// "OpenAI API Key" e raccogliere chiavi altrui). L'eventuale `configuration`
// nel manifest viene ignorata; l'auth degli addon passa dalla manifest URL
// personalizzata (stile Stremio).

export function safeParseConfig(
  value: string | null | undefined
): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Config da mandare al client: i secret impostati diventano il sentinel,
 * quelli vuoti spariscono. I campi non a schema vengono comunque mascherati
 * se sembrano cifrati (difesa in profondità su config legacy).
 */
export function sanitizeConfigForClient(
  config: Record<string, unknown>,
  schema: ConfigSchema
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    const field = schema[key];
    if (field?.secret) {
      if (value !== undefined && value !== null && value !== '') {
        out[key] = SECRET_PLACEHOLDER;
      }
      continue;
    }
    if (!field && isEncryptedSecret(value)) {
      out[key] = SECRET_PLACEHOLDER;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function coerceValue(field: ConfigField, value: unknown): unknown | undefined {
  switch (field.type) {
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      return undefined;
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'select': {
      const s = String(value ?? '');
      const valid = (field.options ?? []).some((o) => o.value === s);
      return valid ? s : undefined;
    }
    case 'string':
    default:
      return typeof value === 'string' ? value : String(value ?? '');
  }
}

/**
 * Prepara la config in arrivo dal client per lo storage:
 * - scarta le chiavi non presenti nello schema (se lo schema esiste);
 * - valida/coerce i tipi (select: solo valori tra le options);
 * - secret: sentinel → mantiene l'esistente; vuoto → rimuove; nuovo → cifra.
 *
 * Ritorna anche gli eventuali errori di validazione (campi required mancanti,
 * valori select non validi).
 */
export function prepareConfigForStorage(args: {
  incoming: Record<string, unknown>;
  existing: Record<string, unknown>;
  schema: ConfigSchema;
}): { config: Record<string, unknown>; errors: string[] } {
  const { incoming, existing, schema } = args;
  const hasSchema = Object.keys(schema).length > 0;
  const out: Record<string, unknown> = {};
  const errors: string[] = [];

  const keys = hasSchema ? Object.keys(schema) : Object.keys(incoming);

  for (const key of keys) {
    const field: ConfigField | undefined = schema[key];
    const raw = incoming[key];

    if (field?.secret) {
      if (raw === SECRET_PLACEHOLDER) {
        // Non cambiato: mantieni il valore (già cifrato) esistente
        if (existing[key] !== undefined) out[key] = existing[key];
      } else if (raw === undefined || raw === null || raw === '') {
        // Rimosso: non riportare la chiave
      } else {
        out[key] = encryptSecret(String(raw));
      }
      continue;
    }

    if (raw === undefined || raw === null || raw === '') continue;

    if (!field) {
      // Nessuno schema: passthrough (custom addon senza schema dichiarato)
      out[key] = raw;
      continue;
    }

    const coerced = coerceValue(field, raw);
    if (coerced === undefined) {
      errors.push(`Invalid value for "${field.label || key}".`);
      continue;
    }
    out[key] = coerced;
  }

  // Required check (un secret già presente conta come impostato)
  for (const [key, field] of Object.entries(schema)) {
    if (field.required && (out[key] === undefined || out[key] === '')) {
      errors.push(`"${field.label || key}" is required.`);
    }
  }

  return { config: out, errors };
}

/**
 * Config pronta per l'esecuzione (server-only): parse + decifratura dei
 * secret. Valori legacy in chiaro passano invariati.
 *
 * Quando lo schema dichiara dei campi, le chiavi non riconosciute vengono scartate.
 */
export function resolveConfigForExecution(
  configString: string | null | undefined,
  schema: ConfigSchema
): Record<string, unknown> {
  const config = safeParseConfig(configString);
  const hasSchema = Object.keys(schema).length > 0;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    const field = schema[key];
    if (hasSchema && !field) continue;
    if (
      (field?.secret || isEncryptedSecret(value)) &&
      typeof value === 'string'
    ) {
      try {
        out[key] = decryptSecret(value);
      } catch {
        // Chiave assente/cambiata: meglio campo vuoto che crash del transform
        out[key] = '';
      }
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** Config non-secret (per il bulk client-side: mai spedire secret al browser). */
export function stripSecrets(
  config: Record<string, unknown>,
  schema: ConfigSchema
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (schema[key]?.secret || isEncryptedSecret(value)) continue;
    out[key] = value;
  }
  return out;
}
