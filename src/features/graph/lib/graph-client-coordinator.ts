import type { AgentApprovalMode } from '@/features/agent/lib/contracts';
import { v4 as uuidv4 } from 'uuid';
import type { GraphWriteState } from './graph-write-state';

export interface CanonicalGraphSnapshot {
  graphId: string;
  revision: string;
  writeState: GraphWriteState;
  nodes: unknown[];
  edges: unknown[];
  notes: string;
}

export interface EditorDraft {
  ready: boolean;
  version?: number;
  value: { nodes: unknown[]; edges: unknown[] } | string;
  dirty: boolean;
}

export interface GraphParticipant {
  kind: 'graph' | 'note';
  capture: () => EditorDraft | null;
  idle: () => Promise<void>;
  flush: (draft?: EditorDraft) => Promise<boolean>;
  adopt: (snapshot: CanonicalGraphSnapshot) => void;
  // Shows agent writes during a run without taking ownership of the snapshot.
  preview?: (snapshot: CanonicalGraphSnapshot) => void;
  invalidate?: () => void;
}

interface StartRequest {
  runId: string;
  parentRunId?: string;
  graphId: string;
  goal: string;
  model: string;
  reasoning: string;
  approvalMode?: AgentApprovalMode;
  expectedWriteVersion: number;
  expectedRevision: string;
}

export interface LocalAgentStart {
  graphId: string;
  runId: string;
  phase: 'preparing' | 'uncertain' | 'rejected' | 'running' | 'reloading';
  request?: StartRequest;
  error?: string;
}

// Ignore only ReactFlow's transient presentation fields. All domain metadata,
// exact positions, edge labels and styles participate in the start comparison.
const transient = new Set([
  'selected',
  'dragging',
  'resizing',
  'positionAbsolute',
  'width',
  'height',
  'measured',
  '__rf'
]);
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, ordered(item)])
    );
  return value;
}
export function graphDraftFingerprint(value: EditorDraft['value']): string {
  if (typeof value === 'string') return value;
  // Compare the JSON representation actually sent to the API (Date/toJSON,
  // undefined fields), not browser-only object representations.
  const persisted = JSON.parse(JSON.stringify(value)) as Exclude<
    EditorDraft['value'],
    string
  >;
  const clean = (items: unknown[]) =>
    items
      .map((item) => {
        const record = item as Record<string, unknown>;
        return Object.fromEntries(
          Object.entries(record).filter(([key]) => !transient.has(key))
        );
      })
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify(
    ordered({ nodes: clean(persisted.nodes), edges: clean(persisted.edges) })
  );
}

function graphMatchesSavedSnapshot(
  draft: Exclude<EditorDraft['value'], string>,
  snapshot: CanonicalGraphSnapshot
) {
  const localFingerprint = graphDraftFingerprint(draft);
  const savedFingerprint = graphDraftFingerprint(snapshot);
  if (localFingerprint === savedFingerprint) return true;
  const local = JSON.parse(localFingerprint);
  const saved = JSON.parse(savedFingerprint);
  if (local.nodes.length !== saved.nodes.length) return false;
  // Prisma's JSON number serialization can shift a coordinate by a few ULPs.
  // Tolerate only that round-trip noise, never meaningful moves or domain data.
  for (let index = 0; index < local.nodes.length; index++) {
    const before = local.nodes[index];
    const after = saved.nodes[index];
    if (before.id !== after.id || !before.position || !after.position) continue;
    for (const axis of ['x', 'y']) {
      const a = before.position[axis];
      const b = after.position[axis];
      if (
        Number.isFinite(a) &&
        Number.isFinite(b) &&
        Math.abs(a - b) <=
          8 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b))
      )
        after.position[axis] = a;
    }
  }
  return localFingerprint === JSON.stringify(saved);
}

function parseSnapshot(data: CanonicalGraphSnapshot, graphId: string) {
  if (
    data?.graphId !== graphId ||
    !/^[a-f0-9]{64}$/.test(data.revision) ||
    !Number.isSafeInteger(data.writeState?.version) ||
    data.writeState.version < 0 ||
    typeof data.writeState.locked !== 'boolean' ||
    !Array.isArray(data.nodes) ||
    !Array.isArray(data.edges) ||
    typeof data.notes !== 'string'
  )
    throw new Error('Invalid graph snapshot.');
  return data;
}

const startDenials: Record<string, string> = {
  invalid_agent_start: 'Invalid start request.',
  agent_snapshot_changed: 'The saved graph has changed.',
  graph_changed: 'The saved graph has changed.',
  graph_reload_required: 'The graph must be reloaded.',
  graph_agent_running: 'An agent is already working on this graph.',
  invalid_graph_write_version: 'Invalid graph version.',
  graph_not_found: 'Graph not available.',
  workspace_access_revoked: 'Workspace access revoked.',
  agent_manual_jobs_active: 'Manual jobs are still running on this graph.',
  agent_worker_disabled: 'Agent service disabled.',
  agent_worker_unavailable: 'Agent service unavailable.',
  agent_worker_busy: 'Agent service busy.',
  agent_queue_rejected: 'The queue rejected the start.',
  agent_provider_key_not_configured:
    'No provider key configured for the selected model (Settings → Graph agent).',
  agent_configuration_unavailable: 'AI configuration unavailable.'
};

export function createGraphClientCoordinator(
  request: typeof fetch = (...args) => fetch(...args)
) {
  const participants = new Map<string, Set<GraphParticipant>>();
  const retired = new WeakSet<GraphParticipant>();
  const epochs = new Map<string, number>();
  const attempts = new Map<string, LocalAgentStart>();
  const captured = new Map<string, Map<GraphParticipant, EditorDraft>>();
  const jobs = new Map<symbol, string | undefined>();
  const listeners = new Set<() => void>();
  const posting = new Map<string, Promise<string>>();
  const finishing = new Set<string>();
  // Fingerprint of the last live preview each editor displayed during a run.
  const previews = new Map<string, Map<GraphParticipant, string>>();
  const previewing = new Map<string, { again: boolean }>();
  const cancelledStarts = new Set<string>();
  const postingControllers = new Map<string, AbortController>();
  let revision = 0;
  const emit = () => {
    revision++;
    listeners.forEach((listener) => listener());
  };
  const epoch = (id?: string | null) => (id ? (epochs.get(id) ?? 0) : 0);
  const invalidate = (id: string) => {
    epochs.set(id, epoch(id) + 1);
    emit();
  };
  const frozen = (id?: string | null) => Boolean(id && attempts.has(id));
  const editors = (id: string) => Array.from(participants.get(id) ?? []);
  const pruneRetired = (id: string, canonicalAdopted = false) => {
    for (const editor of editors(id)) {
      if (retired.has(editor) && (canonicalAdopted || !editor.capture()?.dirty))
        participants.get(id)?.delete(editor);
    }
  };
  const releaseStart = (id: string) => {
    captured.delete(id);
    previews.delete(id);
    attempts.delete(id);
    pruneRetired(id);
    postingControllers.get(id)?.abort();
    postingControllers.delete(id);
    invalidate(id);
  };
  const snapshot = async (id: string) => {
    const response = await request(
      `/api/agent/graphs/${encodeURIComponent(id)}/snapshot`,
      { cache: 'no-store' }
    );
    if (!response.ok) throw new Error('Unable to verify the saved graph.');
    return parseSnapshot(await response.json(), id);
  };
  const noteConflict = (id: string) =>
    new Set(
      editors(id)
        .filter((editor) => editor.kind === 'note')
        .map((editor) => editor.capture())
        .filter((draft): draft is EditorDraft => Boolean(draft?.dirty))
        .map((draft) => graphDraftFingerprint(draft.value))
    ).size > 1;

  // The frozen visible graph is authoritative for this start. A competing save
  // must never replace intentional local edits (including deletions/Undo).
  const alignCanonical = async (
    id: string,
    canonical: CanonicalGraphSnapshot,
    drafts: Map<GraphParticipant, EditorDraft>
  ) => {
    const owner = attempts.get(id);
    if (cancelledStarts.has(id) || !owner)
      throw new Error('agent_start_cancelled');
    if (canonical.writeState.locked)
      throw new Error('An agent already owns this graph. No run started.');
    const list = editors(id);
    if (list.some((editor) => editor.capture() && !drafts.has(editor)))
      throw new Error('Open editors changed during preparation.');
    const current = new Map<GraphParticipant, EditorDraft>();
    for (const [editor, before] of Array.from(drafts)) {
      const now = editor.capture();
      const fingerprint = now && graphDraftFingerprint(now.value);
      if (!now || fingerprint !== graphDraftFingerprint(before.value))
        throw new Error('The draft changed during preparation.');
      if (
        editor.kind === 'note' &&
        before.dirty &&
        canonical.notes !== now.value
      )
        throw new Error(
          'Saved notes differ from your draft. Your draft is kept; no run started.'
        );
      current.set(editor, structuredClone(now));
    }
    const local = Array.from(drafts).find(
      ([editor]) => editor.kind === 'graph'
    )?.[1];
    if (!local || typeof local.value === 'string')
      throw new Error('The visible graph is no longer available.');
    if (!graphMatchesSavedSnapshot(local.value, canonical)) {
      // Use the ordinary authenticated, lease-checked save endpoint. Updating
      // the version never grants permission to overwrite a running agent.
      const response = await request(`/api/graphs/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...local.value,
          expectedWriteVersion: canonical.writeState.version
        })
      });
      if (!response.ok)
        throw new Error('Save not confirmed. Your draft is kept.');
      canonical = await snapshot(id);
      if (cancelledStarts.has(id) || attempts.get(id) !== owner)
        throw new Error('agent_start_cancelled');
      if (canonical.writeState.locked)
        throw new Error('An agent already owns this graph. No run started.');
      if (!graphMatchesSavedSnapshot(local.value, canonical))
        throw new Error(
          'The graph is being changed elsewhere. Your draft is kept.'
        );
      for (const [editor, before] of Array.from(current)) {
        const now = editor.capture();
        if (
          !now ||
          graphDraftFingerprint(now.value) !==
            graphDraftFingerprint(before.value)
        )
          throw new Error('The draft changed during preparation.');
        if (
          editor.kind === 'note' &&
          before.dirty &&
          canonical.notes !== before.value
        )
          throw new Error(
            'Saved notes differ from your draft. Your draft is kept; no run started.'
          );
      }
    }
    captured.set(id, current);
    return canonical;
  };

  const post = (id: string): Promise<string> => {
    const existing = posting.get(id);
    if (existing) return existing;
    const attempt = attempts.get(id);
    if (!attempt?.request)
      return Promise.reject(new Error('No start to retry.'));
    // A previous explicit denial is not evidence about a new retry whose
    // response is lost. Every dispatch becomes uncertain until acknowledged.
    attempt.phase = 'uncertain';
    attempt.error = undefined;
    emit();
    const controller = new AbortController();
    postingControllers.set(id, controller);
    const pending = (async () => {
      try {
        for (let rebases = 0; ; rebases++) {
          const response = await request('/api/agent/runs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(attempt.request),
            signal: controller.signal
          });
          const data = await response.json();
          if (cancelledStarts.has(id) || attempts.get(id) !== attempt)
            throw new Error('agent_start_cancelled');
          if (
            !response.ok &&
            [409, 428].includes(response.status) &&
            [
              'agent_snapshot_changed',
              'graph_changed',
              'graph_reload_required'
            ].includes(data.error) &&
            rebases < 2
          ) {
            // These explicit denials guarantee no run was created. A lost response
            // never enters this path and retains its exact idempotent request.
            attempt.phase = 'rejected';
            attempt.error =
              'Graph synchronization could not be confirmed. Retry to continue.';
            await Promise.all(editors(id).map((editor) => editor.idle()));
            let canonical = await snapshot(id);
            if (cancelledStarts.has(id) || attempts.get(id) !== attempt)
              throw new Error('agent_start_cancelled');
            canonical = await alignCanonical(
              id,
              canonical,
              captured.get(id) ?? new Map()
            );
            attempt.request = {
              ...attempt.request!,
              expectedWriteVersion: canonical.writeState.version,
              expectedRevision: canonical.revision
            };
            attempt.phase = 'uncertain';
            attempt.error = undefined;
            emit();
            continue;
          }
          if (
            !response.ok &&
            [400, 403, 404, 409, 413, 423, 428, 429, 503].includes(
              response.status
            ) &&
            Object.prototype.hasOwnProperty.call(startDenials, data.error)
          ) {
            attempt.phase = 'rejected';
            attempt.error = `Start rejected. ${startDenials[data.error]} Retry to synchronize; your current graph will be kept.`;
            throw new Error(attempt.error);
          }
          if (!response.ok || data.runId !== attempt.runId)
            throw new Error('start_unconfirmed');
          attempt.phase = 'running';
          attempt.error = undefined;
          emit();
          return attempt.runId;
        }
      } catch {
        if (cancelledStarts.has(id) || attempts.get(id) !== attempt)
          throw new Error('agent_start_cancelled');
        if (attempt.phase === 'rejected') {
          emit();
          throw new Error(attempt.error);
        }
        attempt.phase = 'uncertain';
        attempt.error =
          'Start not confirmed. The graph stays locked; Retry sends the same request.';
        emit();
        throw new Error(attempt.error);
      } finally {
        postingControllers.delete(id);
        posting.delete(id);
      }
    })();
    posting.set(id, pending);
    return pending;
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getRevision: () => revision,
    epoch,
    frozen,
    invalidate,
    attempts: () => Array.from(attempts.values()),
    attempt: (id?: string | null) => (id ? attempts.get(id) : undefined),
    canSave: (id?: string | null, barrier = false) =>
      !frozen(id) ||
      Boolean(barrier && id && attempts.get(id)?.phase === 'preparing'),
    noteConflict,
    register(id: string, participant: GraphParticipant) {
      const set = participants.get(id) ?? new Set();
      set.add(participant);
      participants.set(id, set);
      emit();
      return () => {
        // Closing an editor does not cancel its page-hide/manual save queue.
        // Keep it in the barrier until drained; failed drafts remain available
        // to the next preparation instead of being silently overwritten.
        retired.add(participant);
        void participant.idle().then(() => {
          if (!attempts.has(id)) pruneRetired(id);
          emit();
        });
      };
    },
    isLoaded(id?: string | null) {
      return Boolean(
        id &&
          editors(id).some(
            (editor) =>
              !retired.has(editor) &&
              editor.kind === 'graph' &&
              editor.capture()?.ready
          )
      );
    },
    beginManual(id?: string) {
      if (id ? frozen(id) : attempts.size > 0)
        throw new Error('The graph is locked by the agent.');
      if (
        id &&
        editors(id).some(
          (editor) => editor.kind === 'graph' && !editor.capture()?.ready
        )
      )
        throw new Error('The graph is not editable.');
      const token = Symbol();
      const scope = epoch(id);
      jobs.set(token, id);
      return {
        current: () => !frozen(id) && epoch(id) === scope,
        finish: () => {
          jobs.delete(token);
        }
      };
    },
    async start(input: {
      graphId: string;
      parentRunId?: string;
      goal: string;
      model: string;
      reasoning: string;
      approvalMode?: AgentApprovalMode;
    }) {
      const id = input.graphId;
      if (attempts.has(id))
        throw new Error('A start is already in progress for this graph.');
      cancelledStarts.delete(id);
      const list = editors(id);
      if (
        !list.some(
          (editor) =>
            !retired.has(editor) &&
            editor.kind === 'graph' &&
            editor.capture()?.ready
        )
      )
        throw new Error('Open and load the graph before starting.');
      if (Array.from(jobs.values()).some((job) => !job || job === id))
        throw new Error('Wait for manual transforms and addon jobs to finish.');
      const attempt: LocalAgentStart = {
        graphId: id,
        runId: uuidv4(),
        phase: 'preparing'
      };
      // No await before this freeze: every editor and callback sees it immediately.
      attempts.set(id, attempt);
      invalidate(id);
      try {
        const drafts = new Map<GraphParticipant, EditorDraft>();
        for (const editor of list) {
          const draft = editor.capture();
          if (!draft) continue;
          if (!draft.ready || draft.version === undefined)
            throw new Error('An editor is not ready to save.');
          drafts.set(editor, structuredClone(draft));
        }
        if (noteConflict(id))
          throw new Error(
            'Conflicting drafts of the same note: resolve the conflict before starting.'
          );
        const graphs = Array.from(drafts).filter(
          ([editor]) => editor.kind === 'graph'
        );
        const notes = Array.from(drafts).filter(
          ([editor]) => editor.kind === 'note'
        );
        if (
          new Set(graphs.map(([, draft]) => graphDraftFingerprint(draft.value)))
            .size !== 1
        )
          throw new Error('Conflicting drafts of the same graph.');
        const chosen = notes.find(([, draft]) => draft.dirty) ?? notes[0];
        if (
          !chosen?.[1].dirty &&
          new Set(notes.map(([, draft]) => draft.value)).size > 1
        )
          throw new Error('Note editors are out of sync. Reload the notes.');
        let recoveredWrite = false;
        const assertUnchanged = () => {
          const current = editors(id);
          if (
            current.length !== list.length ||
            current.some((editor) => !list.includes(editor))
          )
            throw new Error('Open editors changed during preparation.');
          for (const [editor, draft] of Array.from(drafts)) {
            const now = editor.capture();
            if (
              !now ||
              (!now.ready && !recoveredWrite) ||
              now.version !== draft.version ||
              graphDraftFingerprint(now.value) !==
                graphDraftFingerprint(draft.value)
            )
              throw new Error('The draft changed during preparation.');
          }
        };
        await Promise.all(list.map((editor) => editor.idle()));
        assertUnchanged();
        for (const [editor, draft] of [
          ...graphs,
          ...(chosen ? [chosen] : [])
        ]) {
          if (!(await editor.flush(draft))) {
            // An expired write epoch can reject the save even though the user
            // intentionally edited this visible graph. Retry against the latest
            // unlocked epoch, without loading server nodes into the editor.
            const latest = await snapshot(id);
            if (
              editor.kind !== 'graph' ||
              latest.writeState.version === draft.version
            )
              throw new Error('Save not confirmed. Your draft is kept.');
            await alignCanonical(id, latest, drafts);
            recoveredWrite = true;
          }
        }
        await Promise.all(list.map((editor) => editor.idle()));
        assertUnchanged();
        let canonical = await snapshot(id);
        assertUnchanged();
        if (cancelledStarts.has(id) || attempts.get(id) !== attempt)
          throw new Error('agent_start_cancelled');
        if (canonical.writeState.locked)
          throw new Error('An agent already owns this graph. No run started.');
        if (chosen && canonical.notes !== chosen[1].value)
          throw new Error(
            'Saved notes differ from your draft. Your draft is kept; no run started.'
          );
        canonical = await alignCanonical(id, canonical, drafts);
        attempt.request = {
          ...input,
          runId: attempt.runId,
          expectedWriteVersion: canonical.writeState.version,
          expectedRevision: canonical.revision
        };
      } catch (error) {
        const cancelled =
          cancelledStarts.has(id) ||
          (error instanceof Error && error.message === 'agent_start_cancelled');
        if (attempts.get(id) === attempt) {
          captured.delete(id);
          previews.delete(id);
          attempts.delete(id);
          pruneRetired(id);
          invalidate(id);
        }
        cancelledStarts.delete(id);
        if (cancelled) throw new Error('agent_start_cancelled');
        throw error;
      }
      if (cancelledStarts.has(id)) {
        releaseStart(id);
        cancelledStarts.delete(id);
        throw new Error('agent_start_cancelled');
      }
      return post(id);
    },
    retry: post,
    cancelStart(id: string) {
      const attempt = attempts.get(id);
      cancelledStarts.add(id);
      postingControllers.get(id)?.abort();
      if (!attempt) return { runId: null as string | null };
      const runId = attempt.request ? attempt.runId : null;
      releaseStart(id);
      return { runId };
    },
    async preview(id: string) {
      const pending = previewing.get(id);
      if (pending) {
        pending.again = true;
        return;
      }
      const state = { again: true };
      previewing.set(id, state);
      try {
        while (state.again) {
          state.again = false;
          const attempt = attempts.get(id);
          if (attempt?.phase !== 'running' || !captured.has(id)) return;
          const canonical = await snapshot(id);
          // A finishing run owns the final reload; never race it with a preview.
          if (attempts.get(id) !== attempt || attempt.phase !== 'running')
            return;
          const fingerprint = graphDraftFingerprint(canonical);
          const shown = previews.get(id) ?? new Map();
          previews.set(id, shown);
          for (const editor of editors(id)) {
            if (
              editor.kind !== 'graph' ||
              !editor.preview ||
              retired.has(editor)
            )
              continue;
            editor.preview(canonical);
            shown.set(editor, fingerprint);
          }
        }
      } catch {
        // The next graph change or the final reload catches up.
      } finally {
        previewing.delete(id);
      }
    },
    async recoverRejected(id: string) {
      const attempt = attempts.get(id);
      if (attempt?.phase !== 'rejected')
        throw new Error('Start still to be confirmed.');
      await Promise.all(editors(id).map((editor) => editor.idle()));
      const canonical = await alignCanonical(
        id,
        await snapshot(id),
        captured.get(id) ?? new Map()
      );
      if (canonical.writeState.locked)
        throw new Error('The graph is still locked.');
      for (const editor of editors(id)) {
        const before = captured.get(id)?.get(editor);
        const now = editor.capture();
        if (
          before &&
          now &&
          graphDraftFingerprint(before.value) ===
            graphDraftFingerprint(now.value)
        )
          editor.adopt(canonical);
        else editor.invalidate?.();
      }
      captured.delete(id);
      previews.delete(id);
      attempts.delete(id);
      pruneRetired(id, true);
      invalidate(id);
    },
    async observe(run: { id: string; graphId: string; status: string }) {
      const attempt = attempts.get(run.graphId);
      if (!attempt || attempt.runId !== run.id || !attempt.request) return;
      if (run.status === 'running') {
        if (attempt.phase !== 'running') {
          attempt.phase = 'running';
          attempt.error = undefined;
          emit();
        }
        return;
      }
      if (finishing.has(run.id)) return;
      finishing.add(run.id);
      attempt.phase = 'reloading';
      emit();
      try {
        const canonical = await snapshot(run.graphId);
        if (canonical.writeState.locked)
          throw new Error('The graph is still locked.');
        const original = captured.get(run.graphId);
        const shown = previews.get(run.graphId);
        for (const editor of editors(run.graphId)) {
          const before = original?.get(editor);
          const now = editor.capture();
          const current = now && graphDraftFingerprint(now.value);
          // Only locally frozen editors still showing the captured draft or the
          // last live preview are auto-reloaded. New editors and second-tab
          // drafts retain their old ownership epoch and contents.
          if (
            before &&
            now &&
            (current === graphDraftFingerprint(before.value) ||
              current === shown?.get(editor))
          )
            editor.adopt(canonical);
          else editor.invalidate?.();
        }
        captured.delete(run.graphId);
        previews.delete(run.graphId);
        attempts.delete(run.graphId);
        pruneRetired(run.graphId, true);
        invalidate(run.graphId);
      } catch {
        attempt.error =
          'Run finished, but the reload was not confirmed. The graph stays locked.';
        emit();
      } finally {
        finishing.delete(run.id);
      }
    }
  };
}

export const graphClientCoordinator = createGraphClientCoordinator();
