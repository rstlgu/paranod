import { describe, expect, it } from 'vitest';
import { agentFailure, toolArgumentFailure } from './failure';

describe('agent failure classification', () => {
  it('recognizes an OpenAI credit exhaustion error without an HTTP status', () => {
    const error = Object.assign(new Error('You have no credits remaining.'), {
      status: undefined,
      code: 'credit_balance_exhausted',
      type: 'insufficient_quota',
      error: {
        type: 'insufficient_quota',
        code: 'credit_balance_exhausted',
        message: 'You have no credits remaining.'
      }
    });
    expect(agentFailure(error)).toMatchObject({
      code: 'quota',
      summary: expect.stringContaining('no remaining credits')
    });
  });

  it('explains a rejected tool call without including the raw arguments', () => {
    expect(
      toolArgumentFailure({
        name: 'InvalidToolInputError',
        message: 'Invalid JSON input for tool',
        toolInvocation: { input: '{"secret":"do-not-echo"}' },
        originalError: {
          issues: [
            { path: ['nextOffset'], message: 'Unrecognized key: "nextOffset"' }
          ]
        }
      })
    ).toBe(
      'The arguments were rejected (nextOffset: Unrecognized key: "nextOffset"). Use only the declared parameters and retry once.'
    );
    expect(toolArgumentFailure(new Error('agent_node_unavailable'))).toBeNull();
  });

  it('keeps a plain rate limit distinct from exhausted credits', () => {
    expect(agentFailure({ status: 429, message: 'Slow down.' }).code).toBe(
      'rate_limit'
    );
  });
});
