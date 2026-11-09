'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  DEFAULT_AGENT_APPROVAL_MODE,
  type AgentApprovalMode
} from '../lib/contracts';

type RunSelection = Record<string, string | null>;

interface AgentPanelState {
  open: boolean;
  detached: boolean;
  setDetached: (detached: boolean) => void;
  // null is an explicit new conversation; a missing graph resumes its latest run.
  selectedRuns: RunSelection;
  // Selections from earlier page loads, trusted only once the catalog lists them.
  restoredRuns: RunSelection;
  drafts: Record<string, string>;
  submissions: Record<string, { scope: string; text: string }>;
  width: number;
  approvalMode: AgentApprovalMode;
  modelSelection: { model: string; reasoning: string } | null;
  setOpen: (open: boolean) => void;
  selectRun: (graphId: string, id: string | null) => void;
  setDraft: (scope: string, text: string) => void;
  rememberSubmission: (runId: string, scope: string, text: string) => void;
  confirmSubmission: (runId: string) => void;
  forgetSubmission: (runId: string) => void;
  rejectSubmission: (graphId: string, runId: string) => void;
  setWidth: (width: number) => void;
  setApprovalMode: (mode: AgentApprovalMode) => void;
  setModelSelection: (selection: { model: string; reasoning: string }) => void;
}

export const AGENT_PANEL_MIN_WIDTH = 320;
export const AGENT_PANEL_MAX_WIDTH = 680;

function clampWidth(width: number) {
  return Math.max(
    AGENT_PANEL_MIN_WIDTH,
    Math.min(AGENT_PANEL_MAX_WIDTH, width)
  );
}

const APPROVAL_MODES = new Set<AgentApprovalMode>(['ask', 'guarded', 'auto']);

function readApprovalMode(value: unknown): AgentApprovalMode | null {
  return typeof value === 'string' &&
    APPROVAL_MODES.has(value as AgentApprovalMode)
    ? (value as AgentApprovalMode)
    : null;
}

function readModelSelection(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const model = Reflect.get(value, 'model');
  const reasoning = Reflect.get(value, 'reasoning');
  if (typeof model !== 'string' || typeof reasoning !== 'string') return null;
  if (!model || model.length > 120 || !reasoning || reasoning.length > 20)
    return null;
  return { model, reasoning };
}

function readSelection(value: unknown): RunSelection {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, id]) => id === null || typeof id === 'string'
    )
  );
}

// Only run ids and the panel width are persisted; investigation text stays in memory.
export const useAgentPanelStore = create<AgentPanelState>()(
  persist(
    (set) => ({
      open: false,
      detached: false,
      setDetached: (detached) => set({ detached }),
      selectedRuns: {},
      restoredRuns: {},
      drafts: {},
      submissions: {},
      width: 420,
      approvalMode: DEFAULT_AGENT_APPROVAL_MODE,
      modelSelection: null,
      setOpen: (open) => set({ open }),
      selectRun: (graphId, id) =>
        set((state) => ({
          selectedRuns: { ...state.selectedRuns, [graphId]: id },
          restoredRuns: { ...state.restoredRuns, [graphId]: id }
        })),
      setDraft: (scope, text) =>
        set((state) => ({ drafts: { ...state.drafts, [scope]: text } })),
      rememberSubmission: (runId, scope, text) =>
        set((state) => ({
          submissions: { ...state.submissions, [runId]: { scope, text } }
        })),
      confirmSubmission: (runId) =>
        set((state) => {
          const submitted = state.submissions[runId];
          if (!submitted) return state;
          const submissions = { ...state.submissions };
          delete submissions[runId];
          const drafts = { ...state.drafts };
          if (drafts[submitted.scope] === submitted.text)
            delete drafts[submitted.scope];
          return { submissions, drafts };
        }),
      forgetSubmission: (runId) =>
        set((state) => {
          const submissions = { ...state.submissions };
          delete submissions[runId];
          return { submissions };
        }),
      rejectSubmission: (graphId, runId) =>
        set((state) => {
          const submitted = state.submissions[runId];
          if (!submitted) return state;
          const submissions = { ...state.submissions };
          delete submissions[runId];
          const fallback = submitted.scope === graphId ? null : submitted.scope;
          return {
            submissions,
            // Never undo a newer conversation selection after an async failure.
            selectedRuns:
              state.selectedRuns[graphId] === runId
                ? { ...state.selectedRuns, [graphId]: fallback }
                : state.selectedRuns,
            restoredRuns:
              state.restoredRuns[graphId] === runId
                ? { ...state.restoredRuns, [graphId]: fallback }
                : state.restoredRuns
          };
        }),
      setWidth: (width) => set({ width: clampWidth(width) }),
      setApprovalMode: (approvalMode) => set({ approvalMode }),
      setModelSelection: (modelSelection) => set({ modelSelection })
    }),
    {
      name: 'paranod-agent-panel',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        restoredRuns: state.restoredRuns,
        width: state.width,
        approvalMode: state.approvalMode,
        modelSelection: state.modelSelection
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<AgentPanelState>;
        return {
          ...current,
          restoredRuns: readSelection(saved.restoredRuns),
          width:
            typeof saved.width === 'number' && Number.isFinite(saved.width)
              ? clampWidth(saved.width)
              : current.width,
          approvalMode:
            readApprovalMode(saved.approvalMode) ?? current.approvalMode,
          modelSelection: readModelSelection(saved.modelSelection)
        };
      }
    }
  )
);

// The conversation shown for a graph tab: explicit choice, else its latest run.
export function effectiveAgentRunId(
  selectedRuns: RunSelection,
  graphId: string,
  runs: Array<{ id: string; graphId: string }> | undefined,
  restoredRuns: RunSelection = {}
) {
  if (graphId in selectedRuns) return selectedRuns[graphId];
  const graphRuns = runs?.filter((run) => run.graphId === graphId) ?? [];
  if (graphId in restoredRuns) {
    const restored = restoredRuns[graphId];
    if (restored === null) return null;
    if (graphRuns.some((run) => run.id === restored)) return restored;
  }
  return graphRuns[0]?.id ?? null;
}
