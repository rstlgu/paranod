import { Resolver } from 'node:dns/promises';
import { z } from 'zod';
import { emailPluginExecutor } from '@/features/plugins/builtin/email-plugin';
import { urlPluginExecutor } from '@/features/plugins/builtin/url-plugin';
import { ipPluginExecutor } from '@/features/plugins/builtin/ip-plugin';
import { disposableEmailPluginExecutor } from '@/features/plugins/builtin/disposable-email-plugin';
import {
  extractPlatformInfo,
  generateSearchLinks
} from '@/features/plugins/builtin/social-plugin';
import { osintEntity, osintEdge } from '@/features/plugins/builtin/osint-utils';
import type {
  OSINTEntity,
  OSINTEdge,
  PluginExecutionContext,
  TransformInput,
  TransformResult
} from '@/features/plugins/types';
import { safePublicFetch } from '@/lib/security/safe-fetch';
import { parseAddonResult } from '@/lib/validators/addon-result';
import { isEntityType } from '@/features/osint/entity-types';
import { publicText, withoutCredentials } from './policy';
import { agentPluginExecutor } from './plugin-executors';
import {
  checkedDomain,
  checkedPublicIp,
  MODULE_LIMITS,
  type ModulePlan
} from './module-policy';

export interface ModuleExecution {
  moduleId: string;
  transformId: string;
  input: TransformInput['entity'];
  outputTypes: readonly string[];
  plan: ModulePlan;
  config?: Record<string, unknown>;
}

function resultBuilder(execution: ModuleExecution) {
  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];
  return {
    add(
      type: OSINTEntity['type'],
      value: string,
      label = value,
      relation = 'Related'
    ) {
      if (entities.length >= MODULE_LIMITS.maxEntities) return;
      const entity = osintEntity(execution.moduleId, type, value, label);
      entities.push(entity);
      edges.push(osintEdge(execution.input.id, entity.id, relation));
    },
    result(): TransformResult {
      return { success: true, entities, edges };
    }
  };
}

async function executeLocal(execution: ModuleExecution) {
  const { moduleId, transformId, input } = execution;
  const arg: TransformInput = { entity: input, config: {} };
  switch (moduleId) {
    case 'email-parser':
      return emailPluginExecutor.execute(transformId, arg);
    case 'url-parser':
      return urlPluginExecutor.execute(transformId, arg);
    case 'ip-geolocation':
      return ipPluginExecutor.execute(transformId, arg);
    case 'disposable-email':
      return disposableEmailPluginExecutor.execute(transformId, arg);
    case 'social-media':
      return transformId === 'social-extract-info'
        ? extractPlatformInfo(arg)
        : generateSearchLinks(arg);
    default:
      throw new Error('agent_transform_unavailable');
  }
}

// Legacy DNS executors use the process-global resolver. A per-call resolver is
// necessary here: cancellation must never cancel another user's DNS requests.
async function executeDns(
  execution: ModuleExecution,
  signal: AbortSignal,
  beforeRequest: () => Promise<void>
) {
  const resolver = new Resolver({ timeout: 2000, tries: 1 });
  resolver.setServers(execution.plan.dnsServers);
  const cancel = () => resolver.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  const out = resultBuilder(execution);
  const { transformId, input } = execution;
  const target =
    input.type === 'email'
      ? input.value.split('@')[1]
      : input.type === 'url'
        ? new URL(input.value).hostname
        : input.value;
  let requests = 0;
  async function query<T>(operation: () => Promise<T>, empty: T): Promise<T> {
    await beforeRequest();
    signal.throwIfAborted();
    if (++requests > MODULE_LIMITS.maxRequests)
      throw new Error('agent_request_limit');
    try {
      return await operation();
    } catch (error) {
      signal.throwIfAborted();
      // NXDOMAIN is not an empty successful lookup; only absent record types are.
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENODATA'
      )
        return empty;
      throw new Error('agent_dns_failed');
    }
  }
  try {
    signal.throwIfAborted();
    if (transformId === 'dns-resolve-a' || transformId === 'url-resolve-ip') {
      for (const ip of await query(() => resolver.resolve4(target), []))
        out.add('ip', checkedPublicIp(ip), ip, 'Resolves to');
    } else if (
      transformId === 'dns-resolve-mx' ||
      transformId === 'email-validate'
    ) {
      const records = await query(() => resolver.resolveMx(target), []);
      for (const mx of records) {
        const host = checkedDomain(mx.exchange, true);
        out.add('domain', host, `${host} (MX ${mx.priority})`, 'Mail server');
      }
      // MX records establish mail infrastructure, never existence of a mailbox.
    } else if (transformId === 'dns-resolve-ns') {
      for (const host of await query(() => resolver.resolveNs(target), []))
        out.add('domain', checkedDomain(host, true), host, 'Nameserver');
    } else if (transformId === 'dns-resolve-txt') {
      for (const parts of await query(() => resolver.resolveTxt(target), []))
        out.add('dns_record', parts.join(''), 'TXT record', 'TXT record');
    } else if (transformId === 'ip-reverse-dns') {
      for (const host of await query(() => resolver.reverse(target), []))
        out.add(
          'hostname',
          checkedDomain(host, true),
          host,
          'Reverse DNS (PTR)'
        );
    } else if (transformId === 'dns-resolve-extra') {
      for (const ip of await query(() => resolver.resolve6(target), []))
        out.add('ip', checkedPublicIp(ip), ip, 'AAAA');
      for (const host of await query(() => resolver.resolveCname(target), []))
        out.add('domain', checkedDomain(host, true), host, 'CNAME');
      const soa = await query(() => resolver.resolveSoa(target), null);
      if (soa)
        out.add('dns_record', `${soa.nsname} ${soa.hostmaster}`, 'SOA', 'SOA');
      for (const caa of await query(() => resolver.resolveCaa(target), [])) {
        const value = caa.issue || caa.issuewild || caa.iodef;
        if (value) out.add('dns_record', value, 'CAA', 'CAA');
      }
    } else throw new Error('agent_transform_unavailable');
    signal.throwIfAborted();
    return out.result();
  } finally {
    signal.removeEventListener('abort', cancel);
    resolver.cancel();
  }
}

const text = z.string().max(2000);
const asnNumber = z.number().int().min(1).max(4294967295);

async function executeHttp(
  execution: ModuleExecution,
  signal: AbortSignal,
  beforeRequest: () => Promise<void>
) {
  const { transformId, input, plan } = execution;
  const out = resultBuilder(execution);
  let requests = 0;
  const read = async (index: number, notFound = false) => {
    await beforeRequest();
    signal.throwIfAborted();
    if (++requests > MODULE_LIMITS.maxRequests || !plan.requests[index])
      throw new Error('agent_request_limit');
    // All destinations come from the approved server-generated plan. No provider
    // redirect, discovered URL, cookie, authorization, or user config is forwarded.
    const response = await safePublicFetch(plan.requests[index], {
      method: 'GET',
      signal,
      redirect: 'error',
      maxRedirects: 0,
      timeoutMs: MODULE_LIMITS.requestTimeoutMs,
      maxBytes: MODULE_LIMITS.maxResponseBytes,
      allowLocalAddon: false,
      headers: {
        Accept: 'application/json,text/plain',
        'User-Agent': 'PARANOD-OSINT/1.0'
      }
    });
    signal.throwIfAborted();
    if (notFound && response.status === 404) return null;
    if (!response.ok) throw new Error('agent_provider_failed');
    return response;
  };
  if (transformId === 'org-to-asn') {
    const response = await read(0);
    const data = z
      .object({
        data: z.object({
          asns: z
            .array(
              z.object({
                asn: asnNumber,
                name: text.nullish(),
                description: text.nullish()
              })
            )
            .max(100)
        })
      })
      .parse(await response!.json());
    const seen = new Set<number>();
    for (const item of data.data.asns) {
      if (seen.has(item.asn)) continue;
      seen.add(item.asn);
      out.add(
        'asn',
        `AS${item.asn}`,
        `AS${item.asn}: ${item.description || item.name || input.value}`,
        'Owns ASN'
      );
    }
  } else if (transformId === 'asn-to-cidrs') {
    const prefix = z.object({ prefix: text });
    const data = z
      .object({
        data: z.object({
          ipv4_prefixes: z.array(prefix).max(100),
          ipv6_prefixes: z.array(prefix).max(100)
        })
      })
      .parse(await (await read(0))!.json());
    for (const value of Array.from(
      new Set(
        [...data.data.ipv4_prefixes, ...data.data.ipv6_prefixes].map(
          (item) => item.prefix
        )
      )
    )) {
      const [address, bits, extra] = value.split('/');
      checkedPublicIp(address);
      if (
        extra !== undefined ||
        !/^\d{1,3}$/.test(bits) ||
        Number(bits) > (address.includes(':') ? 128 : 32)
      )
        throw new Error('agent_invalid_result');
      out.add('cidr', value, value, 'Announces');
    }
  } else if (transformId === 'ip-reverse-ip') {
    const body = await (await read(0))!.text();
    if (/error|exceeded|invalid/i.test(body))
      throw new Error('agent_provider_failed');
    for (const host of Array.from(
      new Set(body.trim().split(/\r?\n/).filter(Boolean))
    ))
      out.add('domain', checkedDomain(host, true), host, 'Hosts');
  } else if (transformId === 'domain-wayback') {
    const rows = z
      .array(z.tuple([text, text]))
      .max(101)
      .parse(await (await read(0))!.json());
    if (
      rows.length &&
      (rows[0][0] !== 'original' || rows[0][1] !== 'timestamp')
    )
      throw new Error('agent_invalid_result');
    const seen = new Set<string>();
    for (const [raw] of rows.slice(1)) {
      const url = new URL(raw);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error('agent_invalid_result');
      const host = checkedDomain(url.hostname, true);
      if (
        host !== input.value.toLowerCase() &&
        !host.endsWith(`.${input.value.toLowerCase()}`)
      )
        throw new Error('agent_result_outside_target');
      url.search = '';
      url.hash = '';
      const value = url.toString();
      if (seen.has(value)) continue;
      seen.add(value);
      out.add('url', value, value, 'Archived URL');
    }
  } else if (transformId === 'whatsmyname-search') {
    // Same three public services as the builtin dataset, with schema and exact
    // username checks instead of a generic substring match in an arbitrary body.
    const gitlab = await read(0, true);
    if (gitlab) {
      const users = z
        .array(z.object({ id: z.number().int().positive(), username: text }))
        .max(100)
        .parse(await gitlab.json());
      if (
        users.some(
          (user) => user.username.toLowerCase() === input.value.toLowerCase()
        )
      )
        out.add(
          'social',
          `https://gitlab.com/${encodeURIComponent(input.value)}`,
          'GitLab profile candidate',
          'Candidate account'
        );
    }
    const hn = await read(1, true);
    if (hn) {
      const user = z
        .object({ id: text })
        .nullable()
        .parse(await hn.json());
      if (user?.id === input.value)
        out.add(
          'social',
          `Hacker News: ${input.value}`,
          `Hacker News: ${input.value}`,
          'Candidate account'
        );
    }
    const reddit = await read(2, true);
    if (reddit) {
      const user = z
        .object({
          kind: z.literal('t2'),
          data: z.object({ name: text, id: text })
        })
        .parse(await reddit.json());
      if (user.data.name.toLowerCase() === input.value.toLowerCase())
        out.add(
          'social',
          `https://www.reddit.com/user/${encodeURIComponent(input.value)}`,
          'Reddit profile candidate',
          'Candidate account'
        );
    }
  } else throw new Error('agent_transform_unavailable');
  signal.throwIfAborted();
  return out.result();
}

function boundedRawResult(raw: unknown) {
  if (!raw || typeof raw !== 'object') return raw;
  const value = { ...(raw as Record<string, unknown>) };
  delete value.metadata;
  if (Array.isArray(value.entities))
    value.entities = value.entities.slice(0, 1000);
  if (Array.isArray(value.edges)) value.edges = value.edges.slice(0, 4000);
  return value;
}

function entityIsApplicable(
  entity: { type: string; value: string; label?: string },
  execution: ModuleExecution
) {
  if (
    !isEntityType(entity.type) ||
    entity.value.length > 2000 ||
    (entity.label?.length ?? 0) > 2000
  )
    return false;
  if (
    entity.type !== 'note' &&
    execution.outputTypes.length > 0 &&
    !execution.outputTypes.includes(entity.type)
  )
    return false;
  if (entity.type === 'domain' || entity.type === 'hostname')
    checkedDomain(entity.value, execution.plan.kind !== 'local');
  if (entity.type === 'ip') checkedPublicIp(entity.value);
  if (
    entity.type === 'url' ||
    entity.type === 'media_url' ||
    (entity.type === 'social' &&
      /^[a-z][a-z0-9+.-]*:/i.test(entity.value) &&
      !entity.value.startsWith('Hacker News: '))
  ) {
    const url = new URL(entity.value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return false;
    checkedDomain(url.hostname, execution.plan.kind !== 'local');
  }
  return true;
}

const RESULT_ENVELOPE_BYTES = 64;

type ParsedResult = ReturnType<typeof parseAddonResult>;
type StoredEntity = Omit<ParsedResult['entities'][number], 'metadata'> & {
  metadata?: Record<string, unknown>;
};

/** Agent nodes keep what the plugin returned, exactly as a manual run does. */
function storedEntity(entity: ParsedResult['entities'][number]): StoredEntity {
  const { metadata, ...rest } = entity;
  return metadata ? { ...rest, metadata: withoutCredentials(metadata) } : rest;
}

function storedEdge(edge: ParsedResult['edges'][number]) {
  return {
    id: edge.id,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    label: edge.label,
    ...(edge.relationship ? { relationship: edge.relationship } : {})
  };
}

function jsonBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8') + 1;
}

export function validateModuleResult(raw: unknown, execution: ModuleExecution) {
  try {
    const bounded = boundedRawResult(raw);
    if (
      !bounded ||
      typeof bounded !== 'object' ||
      !('success' in bounded) ||
      bounded.success !== true ||
      ('async' in bounded && bounded.async)
    )
      throw new Error('status');
    const result = parseAddonResult(bounded, execution.input.id);
    const observations: Array<{ text: string; label: string }> = [];
    const observationIds = new Set<string>();
    const applicable: typeof result.entities = [];
    let omittedEntities = 0;
    for (const entity of result.entities) {
      let accepted = false;
      try {
        accepted = entityIsApplicable(entity, execution);
      } catch {
        accepted = false;
      }
      if (!accepted) {
        omittedEntities += 1;
        continue;
      }
      if (entity.type === 'note') {
        observationIds.add(entity.id);
        observations.push({
          text: publicText(entity.value),
          label: publicText(entity.label || entity.value, 200)
        });
        continue;
      }
      if (applicable.length >= MODULE_LIMITS.maxEntities) {
        omittedEntities += 1;
        continue;
      }
      applicable.push(entity);
    }
    if (!applicable.length && !observations.length && result.entities.length)
      throw new Error('count');
    // Edges to observations never reach the graph; the rest may.
    const linkable = result.edges.filter(
      (edge) =>
        !observationIds.has(edge.sourceId) && !observationIds.has(edge.targetId)
    );
    const edgeBytes = linkable
      .slice(0, MODULE_LIMITS.maxEdges)
      .reduce((sum, edge) => sum + jsonBytes(storedEdge(edge)), 0);
    // Whole entities stay, in order, while the stored result fits its budget.
    let entityBytes = 0;
    const entities: StoredEntity[] = [];
    for (const entity of applicable) {
      const stored = storedEntity(entity);
      const bytes = jsonBytes(stored);
      if (
        RESULT_ENVELOPE_BYTES + edgeBytes + entityBytes + bytes >
        MODULE_LIMITS.maxResultBytes
      ) {
        omittedEntities += 1;
        continue;
      }
      entityBytes += bytes;
      entities.push(stored);
    }
    const keptIds = new Set([
      execution.input.id,
      ...entities.map((entity) => entity.id)
    ]);
    const keptEdges = linkable
      .filter(
        (edge) => keptIds.has(edge.sourceId) && keptIds.has(edge.targetId)
      )
      .slice(0, MODULE_LIMITS.maxEdges);
    const omittedEdges = linkable.length - keptEdges.length;
    const stored = {
      success: true as const,
      entities,
      edges: keptEdges.map(storedEdge)
    };
    if (jsonBytes(stored) > MODULE_LIMITS.maxResultBytes)
      throw new Error('size');
    return {
      // Result-level diagnostics never persist, and the model only ever reads
      // the public values the graph projection returns.
      result: stored,
      observations,
      omittedEntities,
      omittedEdges
    };
  } catch {
    throw new Error('agent_invalid_module_result');
  }
}

function untilModuleDeadline<T>(work: Promise<T>, signal: AbortSignal) {
  if (signal.aborted)
    return Promise.reject(new Error('agent_module_cancelled'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('agent_module_cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

export async function executeAgentModule(
  execution: ModuleExecution,
  signal: AbortSignal,
  beforeRequest: () => Promise<void>,
  context?: PluginExecutionContext
) {
  const bounded = AbortSignal.any([
    signal,
    AbortSignal.timeout(MODULE_LIMITS.timeoutMs)
  ]);
  bounded.throwIfAborted();
  try {
    const executor = agentPluginExecutor(execution.moduleId);
    const boundedDns = execution.plan.kind === 'dns';
    const boundedHttp =
      execution.plan.kind === 'http' && execution.plan.requests.length > 0;
    const raw = await untilModuleDeadline(
      boundedDns
        ? executeDns(execution, bounded, beforeRequest)
        : boundedHttp
          ? executeHttp(execution, bounded, beforeRequest)
          : executor
            ? (async () => {
                await beforeRequest();
                bounded.throwIfAborted();
                return executor.execute(
                  execution.transformId,
                  { entity: execution.input, config: execution.config ?? {} },
                  undefined,
                  context
                );
              })()
            : execution.plan.kind === 'local'
              ? executeLocal(execution)
              : executeHttp(execution, bounded, beforeRequest),
      bounded
    );
    if (signal.aborted) throw new Error('agent_module_cancelled');
    if (raw && typeof raw === 'object' && 'success' in raw && !raw.success)
      throw new Error('agent_module_failed');
    return validateModuleResult(raw, execution);
  } catch (error) {
    // Providers must not reflect URLs, headers, or private diagnostics to the model.
    if (bounded.aborted) throw new Error('agent_module_cancelled');
    if (error instanceof Error && /^agent_[a-z_]+$/.test(error.message))
      throw error;
    throw new Error('agent_module_failed');
  }
}
