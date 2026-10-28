import { z } from 'zod';

const MetadataSchema = z
  .record(z.string().max(100), z.unknown())
  .refine((value) => Object.keys(value).length <= 100, {
    message: 'Too many metadata fields'
  });

export const ExternalEntitySchema = z
  .object({
    id: z.string().min(1).max(256),
    type: z.string().min(1).max(100),
    value: z.string().min(1).max(10_000),
    label: z.string().max(10_000).optional(),
    metadata: MetadataSchema.optional()
  })
  .passthrough();

export const ExternalEdgeSchema = z
  .object({
    id: z.string().min(1).max(256),
    sourceId: z.string().min(1).max(256),
    targetId: z.string().min(1).max(256),
    label: z.string().min(1).max(1000),
    relationship: z.string().max(1000).optional(),
    metadata: MetadataSchema.optional()
  })
  .passthrough();

export const ExternalTransformResultSchema = z
  .object({
    success: z.boolean(),
    entities: z.array(ExternalEntitySchema).max(1000),
    edges: z.array(ExternalEdgeSchema).max(2000),
    metadata: MetadataSchema.optional(),
    message: z.string().max(2000).optional()
  })
  .strict();

export const AddonTransformResponseSchema = z.discriminatedUnion('async', [
  z
    .object({
      async: z.literal(true),
      jobId: z.string().min(1).max(256),
      estimatedTime: z.number().int().min(0).max(86_400).optional(),
      message: z.string().max(2000).optional()
    })
    .strict(),
  z
    .object({
      async: z.literal(false),
      result: ExternalTransformResultSchema
    })
    .strict()
]);

export const AddonExecutionRequestSchema = z
  .object({
    transformId: z.string().min(1).max(128),
    graphId: z.string().min(1).max(256),
    input: z
      .object({
        entity: z
          .object({
            id: z.string().min(1).max(256),
            type: z.string().min(1).max(100),
            value: z.string().min(1).max(10_000),
            metadata: MetadataSchema.optional()
          })
          .strict(),
        config: z.record(z.string().max(100), z.unknown()).optional()
      })
      .strict()
  })
  .strict();
