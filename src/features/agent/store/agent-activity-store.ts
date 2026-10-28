import { create } from 'zustand';
import {
  mergeAgentEvents,
  type AgentEvent,
  type AgentRunSummary
} from '../lib/contracts';

export interface AgentActivity {
  run: AgentRunSummary;
  events: AgentEvent[];
  complete?: boolean;
}
// Public events only, in memory and scoped by graph. Replaying a feed after a
// panel detach or reconnect must not duplicate console entries.
export const useAgentActivityStore = create<{
  runs: Record<string, AgentActivity>;
  receive: (
    run: AgentRunSummary,
    events: AgentEvent[],
    complete?: boolean
  ) => void;
}>((set) => ({
  runs: {},
  receive: (run, events, complete = true) =>
    set((state) => {
      const previous = state.runs[run.id];
      const merged = mergeAgentEvents(previous?.events ?? [], events);
      const runs = {
        ...state.runs,
        [run.id]: { run, events: merged, complete }
      };
      const removable = Object.values(runs)
        .filter((item) => item.run.status !== 'running')
        .sort((a, b) => a.run.createdAt.localeCompare(b.run.createdAt));
      while (Object.keys(runs).length > 50 && removable.length)
        delete runs[removable.shift()!.run.id];
      return { runs };
    })
}));
