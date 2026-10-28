import type { TransformInput } from '../types';

export const MAX_EVIDENCE_BYTES = 128 * 1024;

/** Prefer explicit plain-text content, falling back to the entity value. No normalization. */
export function evidenceText(input: TransformInput): string {
  const text = input.entity.metadata?.content ?? input.entity.value;
  if (typeof text !== 'string' || !text.length) {
    throw new Error('Non-empty plain text is required');
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_EVIDENCE_BYTES) {
    throw new Error('Text exceeds the 128 KiB limit');
  }
  return text;
}
