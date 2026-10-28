import { z } from 'zod';
import {
  agentApprovalModeSchema,
  DEFAULT_AGENT_APPROVAL_MODE
} from '../lib/contracts';
import { argumentsHash } from './policy';

export const agentStartSchema = z
  .object({
    runId: z.uuid(),
    parentRunId: z.uuid().optional(),
    graphId: z.string().min(1).max(160),
    goal: z.string().trim().min(1).max(8000),
    model: z.string().min(1).max(120),
    reasoning: z.string().min(1).max(40),
    approvalMode: agentApprovalModeSchema.default(DEFAULT_AGENT_APPROVAL_MODE),
    expectedWriteVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict();

export type AgentStartInput = z.input<typeof agentStartSchema> & {
  workspaceId: string;
  userId: string;
};

export function agentStartRequestHash(input: AgentStartInput) {
  return argumentsHash({
    ...agentStartSchema.parse(inputWithoutScope(input)),
    workspaceId: input.workspaceId,
    userId: input.userId
  });
}

function inputWithoutScope({
  workspaceId: _workspace,
  userId: _user,
  ...input
}: AgentStartInput) {
  void _workspace;
  void _user;
  return input;
}
