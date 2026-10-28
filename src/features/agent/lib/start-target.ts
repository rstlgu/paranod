import { isTerminalRun, type AgentRunSummary } from './contracts';

export function agentStartTarget({
  activeGraphId,
  loaded,
  selectedRunId,
  run
}: {
  activeGraphId: string | null;
  loaded: boolean;
  selectedRunId: string | null;
  run: AgentRunSummary | null;
}): { graphId: string; parentRunId?: string } | null {
  if (!activeGraphId || !loaded) return null;
  if (!selectedRunId) return { graphId: activeGraphId };
  if (
    run?.id !== selectedRunId ||
    run.graphId !== activeGraphId ||
    !isTerminalRun(run.status)
  )
    return null;
  return { graphId: activeGraphId, parentRunId: selectedRunId };
}
