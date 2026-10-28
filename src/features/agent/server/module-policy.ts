import { getServers } from 'node:dns';
import { isIP } from 'node:net';
import { z } from 'zod';
import type {
  PluginDefinition,
  TransformDefinition,
  TransformInput
} from '@/features/plugins/types';
import { isPrivateIp } from '@/lib/security/ssrf';
import { localImageFileId } from '@/lib/security/image-bytes';
import { agentPluginExecutor } from './plugin-executors';

export const MODULE_POLICY_VERSION = 'passive-v1';
export const MODULE_LIMITS = {
  // Builtin transforms (WhatsMyName ~55s, Wayback/image ~30s) must finish
  // inside this budget; the manual UI uses the same plugin deadlines.
  timeoutMs: 120_000,
  requestTimeoutMs: 30_000,
  maxRequests: 8,
  maxResponseBytes: 1_000_000,
  maxResultBytes: 512_000,
  maxEntities: 400,
  maxEdges: 800
} as const;

type AdapterKind = 'local' | 'dns' | 'http';
// A registry/manifest entry is discovery, never authority to execute code.
const REVIEWED: Record<
  string,
  { version: string; transforms: Record<string, AdapterKind> }
> = {
  'email-parser': {
    version: '1.0.0',
    transforms: {
      'email-extract-domain': 'local',
      'email-validate': 'dns'
    }
  },
  'url-parser': {
    version: '1.2.0',
    transforms: {
      'url-extract-domain': 'local',
      'domain-to-root': 'local',
      'domain-to-website': 'local',
      'url-resolve-ip': 'dns',
      'domain-wayback': 'http'
    }
  },
  'dns-lookup': {
    version: '1.0.0',
    transforms: {
      'dns-resolve-a': 'dns',
      'dns-resolve-mx': 'dns',
      'dns-resolve-ns': 'dns',
      'dns-resolve-txt': 'dns',
      'dns-resolve-extra': 'dns'
    }
  },
  'ip-geolocation': {
    version: '1.1.0',
    transforms: {
      'ip-reverse-dns': 'dns',
      'cidr-to-ips': 'local',
      'ip-reverse-ip': 'http',
      'asn-to-cidrs': 'http',
      'org-to-asn': 'http'
    }
  },
  'disposable-email': {
    version: '1.0.0',
    transforms: {
      'disposable-check-email': 'local',
      'disposable-check-domain': 'local'
    }
  },
  'social-media': {
    version: '1.0.0',
    transforms: {
      'social-extract-info': 'local',
      'social-generate-url': 'local'
    }
  },
  whatsmyname: {
    version: '1.0.0',
    transforms: { 'whatsmyname-search': 'http' }
  }
};

export function moduleAvailability(
  plugin: PluginDefinition,
  transform: TransformDefinition
) {
  if (plugin.enabled === false)
    return { reason: 'agent_module_disabled', kind: null };
  if (plugin.type === 'container-tool')
    return {
      reason: 'agent_container_requires_pinned_image_egress_and_cancellation',
      kind: null
    };
  if (plugin.type !== 'builtin-js' || plugin.runtime !== 'nextjs')
    return {
      reason: 'agent_transform_not_reviewed_for_bounded_execution',
      kind: null
    };
  if (!agentPluginExecutor(plugin.id))
    return { reason: 'agent_transform_unavailable', kind: null };
  const reviewed = REVIEWED[plugin.id];
  const kind = reviewed?.transforms[transform.id] ?? 'http';
  return { reason: null, kind };
}

const domainSchema = z
  .string()
  .max(253)
  .regex(
    /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/
  );
export function checkedDomain(value: string, external = false) {
  const domain = domainSchema.parse(value).toLowerCase();
  if (
    external &&
    /(?:^|\.)(?:localhost|local|internal|invalid|test|onion|home|lan|arpa)$/.test(
      domain
    )
  )
    throw new Error('agent_private_target');
  return domain;
}

export function checkedPublicIp(value: string) {
  if (!isIP(value) || isPrivateIp(value))
    throw new Error('agent_private_target');
  return value;
}

export function checkedModuleInput(
  input: TransformInput['entity'],
  external: boolean
) {
  const parsed = z
    .object({
      id: z.string().min(1).max(200),
      type: z.string().min(1).max(100),
      value: z
        .string()
        .trim()
        .min(1)
        .max(500)
        .regex(/^[^\u0000-\u001f\u007f]+$/)
    })
    .strict()
    .parse(input);
  const value = parsed.value;
  if (input.type === 'domain') checkedDomain(value, external);
  else if (input.type === 'email') {
    z.string()
      .max(254)
      .regex(/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[^@]+$/)
      .parse(value);
    checkedDomain(value.split('@')[1], external);
  } else if (input.type === 'url') {
    const url = new URL(value);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.port
    )
      throw new Error('agent_sensitive_target');
    checkedDomain(url.hostname, external);
  } else if (input.type === 'media_url') {
    if (!localImageFileId(value)) {
      const url = new URL(value);
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.port
      )
        throw new Error('agent_sensitive_target');
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      if (isIP(hostname)) checkedPublicIp(hostname);
      else checkedDomain(hostname, true);
    }
  } else if (input.type === 'ip') checkedPublicIp(value);
  else if (input.type === 'cidr') {
    const [ip, prefix] = value.split('/');
    checkedPublicIp(ip);
    // Local expansion is deliberately limited to at most 64 addresses.
    if (
      isIP(ip) !== 4 ||
      !/^(?:2[6-9]|3[0-2])$/.test(prefix) ||
      value.split('/').length !== 2
    )
      throw new Error('agent_cidr_limit');
  } else if (input.type === 'asn') {
    if (
      !/^(?:AS)?[1-9][0-9]{0,9}$/i.test(value) ||
      Number(value.replace(/^AS/i, '')) > 4294967295
    )
      throw new Error('agent_invalid_asn');
  } else if (input.type === 'organization') {
    z.string().max(200).parse(value);
  } else if (input.type === 'person') {
    z.string().max(200).parse(value);
  } else if (input.type === 'phone') {
    z.string()
      .regex(/^\+?[0-9 ()-]{3,32}$/)
      .parse(value);
  } else {
    z.string()
      .regex(/^[a-zA-Z0-9._-]{1,64}$/)
      .parse(value);
  }
  return { ...parsed, type: input.type };
}

export interface ModulePlan {
  kind: AdapterKind;
  destination: string;
  requests: string[];
  dnsServers: string[];
}

export function planModule(
  kind: AdapterKind,
  transformId: string,
  input: TransformInput['entity']
): ModulePlan {
  const plan: ModulePlan = {
    kind,
    destination: 'Local processing',
    requests: [],
    dnsServers: []
  };
  if (kind === 'dns') {
    plan.destination = 'DNS resolvers configured on the server';
    plan.dnsServers = getServers();
    if (!plan.dnsServers.length) throw new Error('agent_dns_unavailable');
  }
  const value = encodeURIComponent(input.value);
  switch (transformId) {
    case 'org-to-asn':
      plan.destination = 'BGPView';
      plan.requests = [`https://api.bgpview.io/search?query_term=${value}`];
      break;
    case 'asn-to-cidrs':
      plan.destination = 'BGPView';
      plan.requests = [
        `https://api.bgpview.io/asn/${input.value.replace(/^AS/i, '')}/prefixes`
      ];
      break;
    case 'ip-reverse-ip':
      if (isIP(input.value) !== 4) throw new Error('agent_ipv4_required');
      plan.destination = 'HackerTarget';
      plan.requests = [
        `https://api.hackertarget.com/reverseiplookup/?q=${value}`
      ];
      break;
    case 'domain-wayback':
      plan.destination = 'Internet Archive';
      plan.requests = [
        `https://web.archive.org/cdx/search/cdx?url=${value}/*&output=json&fl=original,timestamp&collapse=urlkey&limit=100`
      ];
      break;
    case 'whatsmyname-search':
      // Deliberately reviewed subset. Never expand to the entire dataset implicitly.
      plan.destination = 'WhatsMyName: GitLab, Hacker News, Reddit (3 sites)';
      plan.requests = [
        `https://gitlab.com/api/v4/users?username=${value}`,
        `https://hacker-news.firebaseio.com/v0/user/${value}.json?print=pretty`,
        `https://www.reddit.com/user/${value}/about.json`
      ];
      break;
  }
  if (kind === 'http' && !plan.requests.length)
    throw new Error('agent_transform_unavailable');
  return plan;
}
