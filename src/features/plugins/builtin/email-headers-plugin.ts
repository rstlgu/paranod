import { isIP } from 'node:net';
import type { OSINTEntity, PluginExecutor } from '../types';
import { evidenceText } from './evidence-utils';
import { osintEdge, osintEntity, osintFail } from './osint-utils';

const MAX_HEADERS = 500;
const MAX_ENTITIES = 200;
const ADDRESS_FIELDS = new Set([
  'from',
  'to',
  'cc',
  'bcc',
  'reply-to',
  'sender',
  'return-path'
]);
const AUTH_WARNING =
  'Authentication results are claims copied from the supplied headers. SPF, DKIM and DMARC were not independently verified. Received headers can be forged; no originating IP or identity is established.';

type Header = { name: string; value: string };

function parseHeaders(text: string): Header[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const headers: Header[] = [];
  for (const line of lines) {
    if (line === '') break; // Never extract addresses from the message body.
    if (/^[ \t]/.test(line)) {
      if (!headers.length)
        throw new Error('Header continuation has no preceding field');
      headers[headers.length - 1].value += ` ${line.trim()}`;
      continue;
    }
    const match = /^([\x21-\x39\x3b-\x7e]+):[ \t]*(.*)$/.exec(line);
    if (!match)
      throw new Error('Paste raw email headers as Field: value lines');
    headers.push({ name: match[1].toLowerCase(), value: match[2] });
    if (headers.length > MAX_HEADERS)
      throw new Error('Too many headers (maximum 500)');
  }
  if (!headers.length) throw new Error('No email headers found');
  return headers;
}

export const emailHeadersPluginExecutor: PluginExecutor = {
  async execute(transformId, input) {
    const startedAt = Date.now();
    if (
      transformId !== 'email-headers-extract' ||
      input.entity.type !== 'note'
    ) {
      return osintFail(
        'Expected email-headers-extract with a note entity',
        startedAt
      );
    }
    try {
      const headers = parseHeaders(evidenceText(input));
      const found = new Map<string, OSINTEntity>();
      let truncated = false;
      const add = (type: OSINTEntity['type'], value: string, field: string) => {
        const key = `${type}:${value}`;
        const existing = found.get(key);
        if (existing) {
          const fields = existing.metadata.headerFields as string[];
          if (!fields.includes(field)) fields.push(field);
          return;
        }
        if (found.size >= MAX_ENTITIES) {
          truncated = true;
          return;
        }
        found.set(
          key,
          osintEntity('email-headers', type, value, value, {
            headerFields: [field],
            evidence: 'User-supplied email header; unverified'
          })
        );
      };
      const authResults: string[] = [];
      let receivedCount = 0;
      for (const header of headers) {
        if (ADDRESS_FIELDS.has(header.name)) {
          // Conservative ASCII mailbox extraction, not a complete MIME address parser.
          // Bound each candidate before regex matching to avoid quadratic scans
          // on long malformed address fields.
          for (const candidate of header.value.split(/[\s<>,;():"\[\]]+/)) {
            if (candidate.length > 254 || !candidate.includes('@')) continue;
            if (
              !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
                candidate
              )
            )
              continue;
            const at = candidate.lastIndexOf('@');
            const domain = candidate.slice(at + 1).toLowerCase();
            add('email', `${candidate.slice(0, at)}@${domain}`, header.name);
            add('domain', domain, header.name);
          }
        }
        if (header.name === 'received' || header.name === 'x-originating-ip') {
          if (header.name === 'received') receivedCount++;
          for (const match of Array.from(
            header.value.matchAll(
              /\[([^\[\]\r\n]{1,80})\]|\b(?:\d{1,3}\.){3}\d{1,3}\b/g
            )
          )) {
            const candidate = (match[1] ?? match[0])
              .replace(/^IPv6:/i, '')
              .trim();
            if (isIP(candidate))
              add('ip', candidate.toLowerCase(), header.name);
          }
        }
        if (
          [
            'authentication-results',
            'arc-authentication-results',
            'received-spf'
          ].includes(header.name)
        ) {
          authResults.push(`${header.name}: ${header.value}`);
        }
      }
      const content = `Email header analysis\n\nHeader fields: ${headers.length}\nReceived hops (header order, newest normally first): ${receivedCount}\nExtracted entities: ${found.size}${truncated ? ' (limit reached)' : ''}\n\nDeclared authentication results:\n${authResults.join('\n') || 'No authentication result headers supplied.'}\n\n${AUTH_WARNING}\n\nASCII mailbox extraction only; encoded display names and internationalized mailboxes are not decoded.`;
      const summary = osintEntity('email-headers', 'note', content, content, {
        content,
        headerCount: headers.length,
        receivedCount,
        declaredAuthenticationResults: authResults,
        truncated,
        warning: AUTH_WARNING
      });
      const entities = [...Array.from(found.values()), summary];
      return {
        success: true,
        entities,
        edges: entities.map((entity) =>
          osintEdge(
            input.entity.id,
            entity.id,
            'Extracted from headers',
            'extracted_from'
          )
        ),
        message:
          'Headers parsed locally. Authentication and sender identity remain unverified.',
        executionTime: Date.now() - startedAt
      };
    } catch (error) {
      return osintFail(
        error instanceof Error ? error.message : 'Invalid email headers',
        startedAt
      );
    }
  }
};
