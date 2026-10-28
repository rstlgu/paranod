import { describe, expect, it } from 'vitest';
import type { AgentInputItem } from '@openai/agents';
import { trimDiscoveryContext } from './discovery-context';

function pair(
  id: string,
  name = 'list_modules',
  args = { inputType: 'domain' }
): AgentInputItem[] {
  return [
    {
      type: 'function_call',
      callId: id,
      name,
      arguments: JSON.stringify(args)
    },
    {
      type: 'function_call_result',
      callId: id,
      name,
      status: 'completed',
      output: `Catalog ${id}: ${'description '.repeat(100)}`
    }
  ];
}
describe('bounded rediscoverable tool context', () => {
  it('preserves discovery failures and incomplete calls', () => {
    const input = [...pair('failed'), ...pair('pending'), ...pair('new')];
    input[1] = {
      type: 'function_call_result',
      name: 'list_modules',
      callId: 'failed',
      status: 'completed',
      output: { type: 'text', text: 'The tool failed (unavailable): no access' }
    };
    input[3] = {
      type: 'function_call_result',
      name: 'list_modules',
      callId: 'pending',
      status: 'in_progress',
      output: ''
    };
    const result = trimDiscoveryContext(input);
    expect(result[1]).toBe(input[1]);
    expect(result[3]).toBe(input[3]);
  });
  it('replaces duplicate catalogs without losing calls, evidence, or mutating SDK state', () => {
    const input = [
      ...pair('a'),
      ...pair('evidence', 'run_transform'),
      ...pair('b')
    ];
    const before = structuredClone(input);
    const result = trimDiscoveryContext(input);
    expect(result).toHaveLength(input.length);
    expect(result[1]).toMatchObject({
      callId: 'a',
      output: expect.stringContaining('omitted')
    });
    expect(result[3]).toBe(input[3]);
    expect(result[5]).toBe(input[5]);
    expect(input).toEqual(before);
    expect(trimDiscoveryContext(result)).toEqual(result);
    expect(JSON.stringify(result).length).toBeLessThan(
      JSON.stringify(input).length
    );
  });
  it('keeps two recent pages and six detailed tool descriptions with retrievable arguments', () => {
    const input = Array.from({ length: 4 }, (_, i) =>
      pair(`page${i}`, 'list_modules', { inputType: `type${i}` })
    ).flat();
    input.push(
      ...Array.from({ length: 8 }, (_, i) =>
        pair(`tool${i}`, 'describe_module', { inputType: `type${i}` })
      ).flat()
    );
    const result = trimDiscoveryContext(input);
    const retained = result.filter(
      (item) =>
        item.type === 'function_call_result' &&
        String(item.output).startsWith('Catalog')
    );
    expect(retained).toHaveLength(8);
    expect(result.filter((item) => item.type === 'function_call')).toEqual(
      input.filter((item) => item.type === 'function_call')
    );
  });
});
