/**
 * OSINT Industries plugin.
 *
 * API: https://api.osint.industries/openapi.json (v2, served by the API and
 * newer than docs.osint.industries).
 *   POST /v2/request/stream sends one `data:{json}` line per module as soon as
 *   it finishes; `info_signals` adds a final `{type:'info',status:'finished'}`.
 *   Header: api-key. Body: type (email, phone, username, name, wallet, ip,
 *   domain), query, timeout, premium, exact_match (names).
 *   Errors carry `{ error }`: 400 bad input or no credits, 401 bad key,
 *   402 no credits, 429 rate limited, 500 failed with credits refunded.
 *   /sandbox/request/stream returns the same shape with free, fake data,
 *   except for ip and domain.
 *
 * Every module returns `spec_format` (typed fields) and `front_schemas` (what
 * their UI shows: image, body, tags, timeline), one entry per record. Each
 * record becomes one card node that keeps every public field, whatever the
 * module, plus links to the emails, phones and usernames it reveals.
 *
 */

import type { EntityType } from '@/features/osint/entity-types';
import type {
  OSINTEdge,
  OSINTEntity,
  PluginExecutor,
  TransformInput,
  TransformProgress,
  TransformResult
} from '../types';
import { osintEdge, osintEntity, osintFail } from './osint-utils';

const SOURCE = 'osint-industries';
const PROVIDER = 'OSINT Industries';
const STREAM_API = 'https://api.osint.industries/v2/request/stream';
const SANDBOX_STREAM_API = 'https://api.osint.industries/sandbox/request/stream';
const TIMEOUT_SECONDS = 60;
// The sandbox spreads its fake results over a short run, like a real search.
const SANDBOX_TIMEOUT_SECONDS = 20;
const SANDBOX_LIMIT = 30;
const MAX_ENTITIES = 80;
const MAX_RECORDS_PER_MODULE = 20;
const MAX_FIELDS = 60;
const MAX_TEXT = 1000;
const MAX_LIST = 20;

const QUERY_TYPE: Record<string, string> = {
  'osintind-email': 'email',
  'osintind-phone': 'phone',
  'osintind-username': 'username',
  'osintind-name': 'name',
  'osintind-wallet': 'wallet',
  'osintind-ip': 'ip',
  'osintind-domain': 'domain'
};

const ACCOUNT_TYPE: Record<string, EntityType> = {
  github: 'github_user',
  youtube: 'youtube_channel',
  twitter: 'twitter_user',
  x: 'twitter_user',
  instagram: 'instagram_user',
  linkedin: 'linkedin_profile',
  reddit: 'reddit_user',
  discord: 'discord_user',
  tiktok: 'tiktok_user',
  facebook: 'facebook_user',
  telegram: 'telegram_user',
  whatsapp: 'whatsapp_number',
  signal: 'signal_number'
};

// The documented standard spec_format keys, in the order a card reads best.
// Keys outside this list still appear, after these.
const SPEC_ORDER = [
  'name',
  'first_name',
  'last_name',
  'username',
  'email',
  'phone',
  'email_hint',
  'phone_hint',
  'location',
  'gender',
  'age',
  'language',
  'bio',
  'website',
  'profile_url',
  'followers',
  'following',
  'verified',
  'premium',
  'private',
  'devices',
  'id',
  'creation_date',
  'last_seen',
  'banner_url'
];
// `registered` is always true, `breach` sets the node type and the picture
// becomes the card image.
const SPEC_SKIP = new Set([
  'registered',
  'breach',
  'picture_url',
  'platform_variables'
]);

const SENSITIVE_KEY =
  /password|passwd|secret|token|cookie|session|hash|ssn|cvv/i;
const EMPTY_TEXT = /^(none|null|undefined|n\/a|-)$/i;
const MASKED = /[*•…]/;

type FieldValue = string | number | boolean | string[];

interface SpecValue {
  key?: string;
  proper_key?: string;
  value?: unknown;
}

type SpecRecord = Record<string, unknown>;

interface FrontSchema {
  module?: string;
  kind?: string;
  image?: string | null;
  body?: Record<string, unknown>;
  tags?: Array<{ tag?: string; url?: string | null }>;
  timeline?: {
    registered_date?: string | null;
    last_seen_date?: string | null;
  } | null;
  map?: Array<{
    lat_lng?: unknown;
    popup?: { address?: string | null } | null;
  }> | null;
}

interface IndustryModule {
  module?: string;
  status?: string;
  query?: string;
  category?: { name?: string } | null;
  pretty_data?: Record<string, unknown>;
  spec_format?: SpecRecord[];
  front_schemas?: FrontSchema[];
}

interface ModuleRecord {
  front?: FrontSchema;
  spec?: SpecRecord;
  pretty?: Record<string, unknown>;
}

export function mapOsintIndustryResults(
  sourceId: string,
  modules: IndustryModule[],
  query: string,
  options: { queryType?: string; provider?: string } = {}
): { entities: OSINTEntity[]; edges: OSINTEdge[] } {
  const provider = options.provider ?? PROVIDER;
  // IP and domain lookups describe the searched selector, not accounts.
  const recordType: EntityType =
    options.queryType === 'ip' || options.queryType === 'domain'
      ? options.queryType
      : 'social';
  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];
  const entityByKey = new Map<string, OSINTEntity>();
  const edgeKeys = new Set<string>();
  const labels = new Map<string, Set<string>>();

  const link = (from: string, to: string, label: string) => {
    const key = `${from}>${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(osintEdge(from, to, label, 'associated_with'));
  };

  const pivot = (
    cardId: string,
    type: EntityType,
    value: string,
    label: string
  ) => {
    const key = `${type}:${value.toLowerCase()}`;
    let entity = entityByKey.get(key);
    if (!entity) {
      if (entities.length >= MAX_ENTITIES) return;
      entity = osintEntity(SOURCE, type, value, value, { provider });
      entityByKey.set(key, entity);
      entities.push(entity);
    }
    link(cardId, entity.id, label);
  };

  for (const result of modules) {
    if (entities.length >= MAX_ENTITIES) break;
    if (result.status && result.status !== 'found') continue;
    const slug = (result.module ?? '').trim().toLowerCase();
    if (!slug) continue;
    const searched = cleanText(result.query ?? '') ?? query;

    for (const record of moduleRecords(result)) {
      if (entities.length >= MAX_ENTITIES) break;
      const card = recordCard(slug, record, result, searched, recordType);
      const used = labels.get(card.label) ?? new Set<string>();
      if (used.has(card.value.toLowerCase())) continue;
      const label = used.size ? `${card.label} (${used.size + 1})` : card.label;
      used.add(card.value.toLowerCase());
      labels.set(card.label, used);

      const entity = osintEntity(SOURCE, card.type, card.value, label, {
        ...card.metadata,
        provider
      });
      entities.push(entity);
      link(
        sourceId,
        entity.id,
        card.type === 'breach'
          ? 'Breach'
          : card.type === recordType && recordType !== 'social'
            ? 'Record'
            : 'Account'
      );

      for (const email of card.emails)
        if (!sameSelector(email, query))
          pivot(entity.id, 'email', email, 'Email');
      for (const phone of card.phones)
        if (!sameSelector(phone, query))
          pivot(entity.id, 'phone', phone, 'Phone');
      if (card.username && !sameSelector(card.username, query))
        pivot(entity.id, 'username', card.username, 'Username');
    }
  }

  return { entities, edges };
}

/** Pairs front_schemas with spec_format; either list may be longer. */
function moduleRecords(result: IndustryModule): ModuleRecord[] {
  const fronts = Array.isArray(result.front_schemas) ? result.front_schemas : [];
  const specs = Array.isArray(result.spec_format) ? result.spec_format : [];
  const count = Math.min(
    Math.max(fronts.length, specs.length, 1),
    MAX_RECORDS_PER_MODULE
  );
  return Array.from({ length: count }, (_, index) => ({
    front: isObject(fronts[index]) ? fronts[index] : undefined,
    spec: isObject(specs[index]) ? specs[index] : undefined,
    pretty:
      index === 0 && isObject(result.pretty_data) ? result.pretty_data : undefined
  }));
}

function recordCard(
  slug: string,
  record: ModuleRecord,
  result: IndustryModule,
  searched: string,
  recordType: EntityType
) {
  const { front, spec, pretty } = record;
  const text = (key: string) =>
    specText(spec, key) ?? looseText(pretty?.[key]);
  const fullName = text('name');
  const name =
    fullName ??
    ([text('first_name'), text('last_name')].filter(Boolean).join(' ') ||
      undefined) ??
    bodyText(front, /^(full |display )?name$/i);
  const username = stripAt(
    text('username') ?? bodyText(front, /^(user ?name|handle|login)$/i)
  );
  const profileUrl = httpUrl(text('profile_url')) ?? tagUrl(front, /profile/i);
  const emails = splitList(text('email')).filter(isEmail);
  const phones = splitList(text('phone')).filter(isPhone);
  const image = httpUrl(front?.image) ?? httpUrl(text('picture_url'));
  const isBreach =
    specValue(spec, 'breach') === true || front?.kind === 'aggregator';
  const type: EntityType = isBreach
    ? 'breach'
    : (ACCOUNT_TYPE[slug] ?? recordType);
  // Older v2 responses name every breach record after the aggregator.
  const title =
    (isBreach ? bodyText(front, /^title$/i) : undefined) ??
    cleanText(front?.module ?? '') ??
    titleCase(slug);

  const fields = cardFields();
  for (const key of orderedSpecKeys(spec)) {
    if (
      (key === 'first_name' || key === 'last_name') &&
      fullName?.toLowerCase().includes(String(text(key)).toLowerCase())
    )
      continue;
    const entry = spec?.[key];
    if (isObject(entry))
      fields.add((entry as SpecValue).proper_key ?? key, (entry as SpecValue).value);
  }
  const variables = spec?.platform_variables;
  if (Array.isArray(variables)) {
    for (const variable of variables) {
      if (!isObject(variable)) continue;
      const { proper_key, key, value } = variable as SpecValue;
      fields.add(proper_key ?? key ?? '', value);
    }
  }
  if (!spec && pretty) {
    for (const [key, value] of Object.entries(pretty))
      if (key !== 'picture_url') fields.add(key, value);
  }
  if (isObject(front?.body)) {
    for (const [key, value] of Object.entries(front.body))
      fields.add(key, value);
  }
  const tags: string[] = [];
  for (const tag of Array.isArray(front?.tags) ? front.tags : []) {
    const label = cleanText(tag?.tag ?? '');
    if (!label) continue;
    const url = cleanText(tag?.url ?? '');
    if (url) fields.add(label, url);
    else if (!fields.hasValue(label)) tags.push(label);
  }
  fields.add('Tags', tags);
  fields.add('Registered', front?.timeline?.registered_date);
  fields.add('Last Seen', front?.timeline?.last_seen_date);
  fields.add('Map', mapPoints(front?.map));
  fields.add('Category', result.category?.name);

  const display = clip(
    name ?? username ?? emails[0] ?? phones[0] ?? searched,
    80
  );
  const label = isBreach || display === title ? title : `${title} · ${display}`;
  const value = isBreach
    ? (text('website') ?? bodyText(front, /^domain$/i) ?? title)
    : (username ?? profileUrl ?? emails[0] ?? phones[0] ?? searched);
  const logoDomain = !isBreach && profileUrl ? hostOf(profileUrl) : undefined;

  return {
    type,
    label,
    value,
    username,
    emails,
    phones,
    metadata: {
      nodeView: 'card',
      ...(isBreach ? {} : { customTitle: title }),
      ...(image ? { image } : {}),
      ...(logoDomain ? { logoDomain } : {}),
      module: slug,
      ...Object.fromEntries(fields.entries)
    }
  };
}

/** Ordered fields of one record, deduplicated by label and by value. */
function cardFields() {
  const entries = new Map<string, FieldValue>();
  const labelKeys = new Set<string>();
  const valueKeys = new Set<string>();
  const texts = new Set<string>();
  return {
    entries,
    hasValue(raw: string) {
      const text = raw.trim().toLowerCase();
      const key = valueKey(text);
      return texts.has(text) || (Boolean(key) && valueKeys.has(key));
    },
    add(rawLabel: string, raw: unknown) {
      const label = fieldLabel(rawLabel);
      const value = fieldValue(raw);
      if (!label || value === undefined || entries.size >= MAX_FIELDS) return;
      if (SENSITIVE_KEY.test(label) && typeof value !== 'boolean') return;
      const labelKey = label.toLowerCase().replace(/[^a-z0-9]/g, '');
      const dedupKey = valueKey(value);
      if (labelKeys.has(labelKey) || (dedupKey && valueKeys.has(dedupKey)))
        return;
      labelKeys.add(labelKey);
      if (dedupKey) valueKeys.add(dedupKey);
      if (typeof value === 'string') texts.add(value.toLowerCase());
      entries.set(label, value);
    }
  };
}

function orderedSpecKeys(spec: SpecRecord | undefined) {
  if (!spec) return [];
  const keys = Object.keys(spec).filter((key) => !SPEC_SKIP.has(key));
  const rank = (key: string) => {
    const index = SPEC_ORDER.indexOf(key);
    return index === -1 ? SPEC_ORDER.length : index;
  };
  return keys.sort((a, b) => rank(a) - rank(b));
}

/**
 * Labels start uppercase, so data can never overwrite the lowercase node keys
 * (value, image, customTitle...). snake_case keys become Title Case.
 */
function fieldLabel(raw: string) {
  const text = String(raw ?? '')
    .replace(/[_\s]+/g, ' ')
    .trim()
    .slice(0, 60);
  if (!text) return '';
  if (text === text.toLowerCase())
    return text.replace(/\b[a-z]/g, (char) => char.toUpperCase());
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function fieldValue(raw: unknown): FieldValue | undefined {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === 'string') return cleanText(raw);
  if (Array.isArray(raw)) {
    const items = raw
      .map((item) =>
        typeof item === 'string'
          ? cleanText(item)
          : typeof item === 'number' || typeof item === 'boolean'
            ? String(item)
            : undefined
      )
      .filter((item): item is string => Boolean(item));
    return items.length ? items.slice(0, MAX_LIST) : undefined;
  }
  return undefined;
}

/**
 * Same date in two formats or the same URL in body and tags count once.
 * Word breaks survive, so "Jack Sparrow" never matches "jacksparrow".
 */
function valueKey(value: FieldValue | undefined) {
  if (typeof value !== 'string') return '';
  const key = value
    .toLowerCase()
    .replace(/(\d)t(\d)/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return key.length >= 6 ? key : '';
}

function cleanText(raw: string | null | undefined) {
  const text = String(raw ?? '').trim();
  if (!text || EMPTY_TEXT.test(text)) return undefined;
  return clip(text, MAX_TEXT);
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function looseText(raw: unknown) {
  return typeof raw === 'string' || typeof raw === 'number'
    ? cleanText(String(raw))
    : undefined;
}

function specValue(spec: SpecRecord | undefined, key: string) {
  const entry = spec?.[key];
  return isObject(entry) ? (entry as SpecValue).value : undefined;
}

function specText(spec: SpecRecord | undefined, key: string) {
  return looseText(specValue(spec, key));
}

function bodyText(front: FrontSchema | undefined, pattern: RegExp) {
  for (const [key, value] of Object.entries(front?.body ?? {}))
    if (pattern.test(key.trim())) return looseText(value);
  return undefined;
}

function tagUrl(front: FrontSchema | undefined, pattern: RegExp) {
  for (const tag of Array.isArray(front?.tags) ? front.tags : [])
    if (pattern.test(tag?.tag ?? '')) {
      const url = httpUrl(tag?.url);
      if (url) return url;
    }
  return undefined;
}

function mapPoints(markers: FrontSchema['map']) {
  if (!Array.isArray(markers)) return undefined;
  const points: string[] = [];
  for (const marker of markers.slice(0, 5)) {
    const [lat, lng] = Array.isArray(marker?.lat_lng) ? marker.lat_lng : [];
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    const address = cleanText(marker?.popup?.address);
    points.push(address ? `${lat}, ${lng} (${address})` : `${lat}, ${lng}`);
  }
  return points;
}

function httpUrl(raw: unknown) {
  const text = looseText(raw);
  if (!text || !/^https?:\/\//i.test(text)) return undefined;
  try {
    const url = new URL(text);
    return url.username || url.password ? undefined : url.href;
  } catch {
    return undefined;
  }
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
}

function splitList(raw: string | undefined) {
  return (raw ?? '')
    .split(/,\s*/)
    .map((item) => item.trim())
    .filter((item) => item && !MASKED.test(item));
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isPhone(value: string) {
  return (
    /^\+?[\d\s().-]+$/.test(value) && value.replace(/\D/g, '').length >= 6
  );
}

function stripAt(value: string | undefined) {
  const text = value?.replace(/^@/, '').trim();
  return text && !MASKED.test(text) && !/\s/.test(text) ? text : undefined;
}

/** Phone numbers match with or without the country prefix. */
function sameSelector(a: string, b: string) {
  const normalize = (value: string) =>
    value.trim().toLowerCase().replace(/^@/, '');
  const left = normalize(a);
  const right = normalize(b);
  if (left === right) return true;
  const leftDigits = left.replace(/\D/g, '');
  const rightDigits = right.replace(/\D/g, '');
  if (!isPhone(left) || !isPhone(right)) return false;
  if (Math.min(leftDigits.length, rightDigits.length) < 8) return false;
  return leftDigits.endsWith(rightDigits) || rightDigits.endsWith(leftDigits);
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function errorMessage(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  const detail =
    typeof body?.error === 'string' ? body.error.trim().slice(0, 200) : '';
  switch (response.status) {
    case 401:
      return 'OSINT Industries: invalid or missing API key';
    case 402:
      return 'OSINT Industries: insufficient credits';
    case 429:
      return 'OSINT Industries: rate limit reached, try again shortly';
    case 400:
      return `OSINT Industries: ${detail || 'invalid query or insufficient credits'}`;
    case 500:
      return `OSINT Industries: ${detail || 'search failed, credits were refunded'}`;
    default:
      return `OSINT Industries error: ${response.status}`;
  }
}

/**
 * Reads the stream's `data:{json}` lines until it reports `finished`. Lines may
 * arrive split across chunks; anything that is not a module is skipped.
 */
async function readStream(
  response: Response,
  onModule: (result: IndustryModule) => void
) {
  const modules: IndustryModule[] = [];
  let error: string | undefined;
  let finished = false;
  let interrupted = false;
  const reader = response.body?.getReader();
  if (!reader) return { modules, error, interrupted: true };
  const decoder = new TextDecoder();
  let buffer = '';
  const handleLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    let event: unknown;
    try {
      event = JSON.parse(line.slice(5));
    } catch {
      return;
    }
    if (!isObject(event)) return;
    if (event.type === 'info') {
      if (event.status === 'finished') finished = true;
    } else if (typeof event.module === 'string') {
      modules.push(event as IndustryModule);
      onModule(event as IndustryModule);
    } else if (typeof event.error === 'string') {
      error = event.error.trim().slice(0, 200);
    }
  };
  try {
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line.trim());
    }
    handleLine((buffer + decoder.decode()).trim());
  } catch {
    interrupted = true;
  } finally {
    if (finished) await reader.cancel().catch(() => {});
  }
  return { modules, error, interrupted };
}

function moduleTitle(result: IndustryModule) {
  const front = Array.isArray(result.front_schemas)
    ? result.front_schemas[0]
    : undefined;
  return cleanText(front?.module ?? '') ?? titleCase(result.module ?? '');
}

async function search(
  input: TransformInput,
  queryType: string,
  onProgress?: (update: TransformProgress) => void
): Promise<TransformResult> {
  const startTime = Date.now();
  const query = input.entity.value.trim();
  if (!query) return osintFail('Empty search term', startTime);
  const apiKey = input.config?.apiKey;
  if (typeof apiKey !== 'string' || !apiKey.trim())
    return osintFail('OSINT Industries API key not configured', startTime);

  // Sandbox results are test data and must remain clearly labelled.
  const sandbox = input.config?.sandbox === true;
  if (sandbox && (queryType === 'ip' || queryType === 'domain'))
    return osintFail(
      'OSINT Industries: the sandbox has no IP or domain data, turn sandbox mode off',
      startTime
    );
  const timeout = sandbox ? SANDBOX_TIMEOUT_SECONDS : TIMEOUT_SECONDS;
  const body: Record<string, unknown> = {
    type: queryType,
    query,
    timeout,
    premium: input.config?.premiumModules === true,
    info_signals: true
  };
  if (queryType === 'name') body.exact_match = true;
  if (sandbox) Object.assign(body, { limit: SANDBOX_LIMIT, simulated_delay: true });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (timeout + 8) * 1000);
  try {
    let response: Response;
    try {
      response = await fetch(sandbox ? SANDBOX_STREAM_API : STREAM_API, {
        method: 'POST',
        headers: {
          accept: 'text/event-stream',
          'content-type': 'application/json',
          'api-key': apiKey.trim(),
          'user-agent': 'PARANOD-OSINT/1.0'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch {
      return osintFail(
        'OSINT Industries: request failed or timed out',
        startTime
      );
    }
    if (!response.ok) return osintFail(await errorMessage(response), startTime);

    let found = 0;
    const stream = await readStream(response, (result) => {
      if (result.status && result.status !== 'found') return;
      found += 1;
      onProgress?.({
        message: `${found} found so far, latest: ${moduleTitle(result)}`,
        progress: Math.min(
          95,
          Math.round(((Date.now() - startTime) / (timeout * 1000)) * 100)
        )
      });
    });
    // A stream cut short still returns the modules it already sent: they
    // were paid for.
    if (!stream.modules.length && (stream.error || stream.interrupted))
      return osintFail(
        stream.error
          ? `OSINT Industries: ${stream.error}`
          : 'OSINT Industries: request failed or timed out',
        startTime
      );

    const { entities, edges } = mapOsintIndustryResults(
      input.entity.id,
      stream.modules,
      query,
      {
        queryType,
        provider: sandbox ? `${PROVIDER} sandbox (test data)` : PROVIDER
      }
    );
    const summary = entities.length
      ? `Found ${entities.length} linked record(s).`
      : 'No accounts found.';
    return {
      success: true,
      entities,
      edges,
      message: [
        sandbox ? 'Sandbox test data.' : '',
        summary,
        stream.interrupted ? 'The stream stopped early, results may be partial.' : ''
      ]
        .filter(Boolean)
        .join(' '),
      executionTime: Date.now() - startTime
    };
  } finally {
    clearTimeout(timer);
  }
}

export const osintIndustriesPluginExecutor: PluginExecutor = {
  execute(transformId, input, onProgress) {
    const queryType = QUERY_TYPE[transformId];
    if (!queryType) {
      return Promise.resolve({
        success: false,
        entities: [],
        edges: [],
        error: `Unknown transform: ${transformId}`
      });
    }
    return search(input, queryType, onProgress);
  }
};

export default osintIndustriesPluginExecutor;
