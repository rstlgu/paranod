import type { AgentRunSummary } from './contracts';

export interface AgentConversationThread {
  rootId: string;
  title: string;
  latest: AgentRunSummary;
}

// Follow-up runs share a parent chain. The picker lists those conversations, not every turn.
interface RunLink {
  id: string;
  parentRunId?: string | null;
}

export function agentRunRootId(runs: RunLink[], runId: string) {
  const byId = new Map(runs.map((run) => [run.id, run]));
  let current = byId.get(runId);
  const seen = new Set<string>();
  while (
    current?.parentRunId &&
    byId.has(current.parentRunId) &&
    !seen.has(current.id)
  ) {
    seen.add(current.id);
    current = byId.get(current.parentRunId);
  }
  return current?.id ?? runId;
}

export function agentThreadRunIds(runs: RunLink[], rootId: string) {
  return runs
    .filter((run) => agentRunRootId(runs, run.id) === rootId)
    .map((run) => run.id);
}

export function agentConversationThreads(
  runs: AgentRunSummary[]
): AgentConversationThread[] {
  const byId = new Map(runs.map((run) => [run.id, run]));
  const rootId = (run: AgentRunSummary) => agentRunRootId(runs, run.id);
  const latest = new Map<string, AgentRunSummary>();
  for (const run of runs) {
    const root = rootId(run);
    const previous = latest.get(root);
    if (!previous || previous.createdAt < run.createdAt) latest.set(root, run);
  }
  return Array.from(latest.entries())
    .map(([id, latestRun]) => ({
      rootId: id,
      title: byId.get(id)?.goal ?? latestRun.goal,
      latest: latestRun
    }))
    .sort((a, b) => b.latest.createdAt.localeCompare(a.latest.createdAt));
}

export function agentConversationPickerValue(
  runs: AgentRunSummary[],
  selectedRunId: string | null
) {
  if (!selectedRunId) return '';
  const rootId = agentRunRootId(runs, selectedRunId);
  return (
    agentConversationThreads(runs).find((thread) => thread.rootId === rootId)
      ?.latest.id ?? selectedRunId
  );
}
