/**
 * How a transform result entity becomes a graph node. The manual paths and
 * the agent share these rules, so a node looks the same whoever ran the
 * transform.
 */

import {
  cardSize,
  isCardNode
} from '../components/graph-editor/utils/card-node';

type Size = { width: number; height: number };

export const CLASSIC_NODE_SIZE: Readonly<Size> = { width: 200, height: 85 };

const FILE_TYPES = new Set(['document', 'pdf', 'docx', 'xlsx', 'txt', 'csv', 'json']);

// Types with a body of their own start at their node-registry size.
const OWN_BODY_SIZES: Record<string, Size> = {
  media_url: { width: 280, height: 200 },
  maps: { width: 320, height: 240 },
  ai_insight: { width: 350, height: 250 },
  note: { width: 350, height: 250 },
  group: { width: 400, height: 300 },
  text: { width: 200, height: 100 }
};

/** Classic entity nodes show only their label, so their value can differ. */
export function isClassicResultType(type: string) {
  return !FILE_TYPES.has(type) && !(type in OWN_BODY_SIZES);
}

/** Initial size of a result node; file previews size themselves. */
export function resultNodeSize(
  type: string,
  metadata?: Record<string, unknown>
): Size | undefined {
  if (isCardNode({ type, metadata })) return cardSize(metadata);
  if (FILE_TYPES.has(type)) return undefined;
  return { ...(OWN_BODY_SIZES[type] ?? CLASSIC_NODE_SIZE) };
}

/**
 * Plugins return `value` (the selector) and `label` (what the node shows), but
 * a node stores only the label. A different value goes to `metadata.value`,
 * which transforms and the agent read before the label.
 */
export function withEntityValue(
  metadata: Record<string, unknown> | undefined,
  value: unknown,
  label: string
): Record<string, unknown> {
  const meta = metadata ?? {};
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw === label.trim() || typeof meta.value === 'string')
    return meta;
  return { ...meta, value: raw };
}
