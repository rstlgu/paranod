import { z } from 'zod';
const id = z.string().min(1).max(200);
const metadata = z.record(z.string(), z.unknown()).optional();
const resultSchema = z.object({
  success: z.boolean().optional(),
  error: z.string().max(2000).optional(),
  message: z.string().max(4000).optional(),
  entities: z
    .array(
      z.object({
        id,
        type: z.string().min(1).max(100),
        value: z.string().min(1).max(128000),
        label: z.string().max(128000).optional(),
        metadata
      })
    )
    .max(1000),
  edges: z
    .array(
      z.object({
        id,
        sourceId: id,
        targetId: id,
        label: z.string().min(1).max(200),
        relationship: z.string().max(100).optional(),
        metadata
      })
    )
    .max(4000)
});
export function parseAddonResult(value: unknown, inputId: string) {
  const result = resultSchema.parse(value);
  if (result.success === false)
    throw new Error(result.error || 'Addon reported failure');
  const ids = new Set([inputId]);
  for (const entity of result.entities) {
    if (ids.has(entity.id))
      throw new Error('Duplicate entity ID in addon result');
    ids.add(entity.id);
  }
  const edges = new Set<string>();
  for (const edge of result.edges) {
    if (
      edges.has(edge.id) ||
      !ids.has(edge.sourceId) ||
      !ids.has(edge.targetId)
    )
      throw new Error('Invalid addon edge reference');
    edges.add(edge.id);
  }
  return result;
}
