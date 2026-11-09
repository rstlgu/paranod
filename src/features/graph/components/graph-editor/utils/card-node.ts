import type { OSINTNodeData } from '@/features/graph/types';

/**
 * A plugin shows its node as a contact card by returning
 * `metadata.nodeView = 'card'`. The card lists the node's own metadata, so a
 * plugin needs no schema: every public field it stores becomes a row.
 */
export const CARD_NODE_VIEW = 'card';

// Types with a body of their own (notes, media, files...) never become cards.
const OWN_BODY_TYPES = new Set([
  'note',
  'ai_insight',
  'media_url',
  'maps',
  'group',
  'text',
  'document',
  'pdf',
  'docx',
  'xlsx',
  'txt',
  'csv',
  'json'
]);

// Keys that drive rendering or record provenance rather than describe the
// entity. Keys starting with `_` are transient flags.
const CARD_SYSTEM_KEYS = new Set([
  'nodeView',
  'customTitle',
  'customColor',
  'headerTextColor',
  'autoColorFromLogo',
  'autoHeaderTextColorFromLogo',
  'image',
  'logoDomain',
  'value',
  'provider',
  'module',
  '__merge',
  'merge',
  'merged',
  'mergedChildCount',
  'verified',
  'source',
  'agentRunId',
  'provenance',
  'retrievedAt',
  'originalType'
]);

export const CARD_WIDTH = 300;
const CARD_MIN_HEIGHT = 160;
const CARD_MAX_HEIGHT = 420;
const CARD_BASE_HEIGHT = 150;
const CARD_ROW_HEIGHT = 22;

const ISO_DATETIME =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?(?:Z|[+-]00:?00)?$/;

export type CardFieldValue = string | number | boolean | string[];

export function isCardNode(data: {
  type: string;
  metadata?: Record<string, unknown>;
}) {
  return (
    data.metadata?.nodeView === CARD_NODE_VIEW &&
    !OWN_BODY_TYPES.has(String(data.type))
  );
}

/** The card rows, in metadata order. */
export function cardFields(
  metadata: Record<string, unknown> | undefined
): Array<[string, CardFieldValue]> {
  const fields: Array<[string, CardFieldValue]> = [];
  for (const [key, raw] of Object.entries(metadata ?? {})) {
    if (key.startsWith('_') || CARD_SYSTEM_KEYS.has(key)) continue;
    const value = cardFieldValue(raw);
    if (value !== undefined) fields.push([key, value]);
  }
  return fields;
}

function cardFieldValue(raw: unknown): CardFieldValue | undefined {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === 'string') return raw.trim() || undefined;
  if (!Array.isArray(raw)) return undefined;
  const items = raw
    .filter((item) => ['string', 'number', 'boolean'].includes(typeof item))
    .map((item) => String(item).trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

export function cardImage(metadata: Record<string, unknown> | undefined) {
  const raw = metadata?.image;
  if (typeof raw !== 'string') return undefined;
  try {
    const url = new URL(raw.trim());
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** The label without the platform prefix the header already shows. */
export function cardTitle(data: Pick<OSINTNodeData, 'label' | 'metadata'>) {
  const label = String(data.label ?? '').trim();
  const title =
    typeof data.metadata?.customTitle === 'string'
      ? data.metadata.customTitle.trim()
      : '';
  const prefix = `${title} · `;
  return title && label.startsWith(prefix) ? label.slice(prefix.length) : label;
}

export function cardFieldLabel(key: string) {
  const text = key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** ISO timestamps read as `2019-03-05 15:34:38`; other text is unchanged. */
export function formatCardText(value: string) {
  const match = ISO_DATETIME.exec(value.trim());
  return match ? `${match[1]} ${match[2]}` : value;
}

/** Initial size of a new card: tall enough for its first rows. */
export function cardSize(metadata: Record<string, unknown> | undefined) {
  const rows = Math.min(cardFields(metadata).length, 12);
  const height = CARD_BASE_HEIGHT + rows * CARD_ROW_HEIGHT;
  return {
    width: CARD_WIDTH,
    height: Math.max(CARD_MIN_HEIGHT, Math.min(CARD_MAX_HEIGHT, height))
  };
}
