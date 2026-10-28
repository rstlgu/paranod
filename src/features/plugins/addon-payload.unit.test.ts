import { describe, expect, it } from 'vitest';
import {
  AddonExecutionRequestSchema,
  AddonTransformResponseSchema
} from './addon-payload';

describe('addon payload schemas', () => {
  it('accepts a bounded synchronous response', () => {
    expect(
      AddonTransformResponseSchema.safeParse({
        async: false,
        result: {
          success: true,
          entities: [{ id: '1', type: 'domain', value: 'example.com' }],
          edges: []
        }
      }).success
    ).toBe(true);
  });

  it('rejects oversized result arrays and unexpected response fields', () => {
    const entities = Array.from({ length: 1001 }, (_, index) => ({
      id: String(index),
      type: 'domain',
      value: 'example.com'
    }));
    expect(
      AddonTransformResponseSchema.safeParse({
        async: false,
        result: { success: true, entities, edges: [] }
      }).success
    ).toBe(false);
    expect(
      AddonTransformResponseSchema.safeParse({
        async: true,
        jobId: 'remote-job',
        secret: 'must-not-pass'
      }).success
    ).toBe(false);
  });

  it('rejects execution requests with unbounded entity values', () => {
    expect(
      AddonExecutionRequestSchema.safeParse({
        transformId: 'lookup',
        graphId: 'graph-1',
        input: {
          entity: {
            id: 'entity-1',
            type: 'domain',
            value: 'x'.repeat(10_001)
          }
        }
      }).success
    ).toBe(false);
  });
});
