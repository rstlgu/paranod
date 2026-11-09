'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useFloatingPanel,
  FLOATING_RESIZE_HANDLES
} from '@/hooks/use-floating-panel';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import useSWR, { mutate } from 'swr';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
  effectiveAgentRunId,
  useAgentPanelStore
} from '../store/agent-panel-store';
import { useAgentFeed } from '../hooks/use-agent-feed';
import {
  readActiveAgentGraphId,
  useActiveAgentGraph,
  type ActiveAgentGraph
} from '../hooks/use-active-agent-graph';
import type { AgentCatalog } from '../lib/contracts';
import { agentStartTarget } from '../lib/start-target';
import { agentRunRootId } from '../lib/conversation-threads';
import { useGraphCoordinator } from '@/features/graph/components/graph-editor/hooks/use-graph-participant';
import {
  graphClientCoordinator,
  type LocalAgentStart
} from '@/features/graph/lib/graph-client-coordinator';
import styles from './agent-panel.module.css';
import { useAgentGraphReferences } from '../store/agent-graph-references';
import { useAgentActivityStore } from '../store/agent-activity-store';

const AgentPanelView = dynamic(
  () => import('./agent-panel-view').then((module) => module.AgentPanelView),
  { ssr: false }
);

const PANEL_TRANSITION = { duration: 0.24, ease: [0.32, 0.72, 0, 1] };

async function fetchCatalog(url: string): Promise<AgentCatalog> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('agent_catalog_failed');
  return response.json();
}

function ConnectedPanel({
  graph,
  detached,
  onToggleDetached,
  onHeaderPointerDown
}: {
  graph: ActiveAgentGraph;
  detached?: boolean;
  onToggleDetached?: () => void;
  onHeaderPointerDown?: React.PointerEventHandler<HTMLElement>;
}) {
  const graphReferences = useAgentGraphReferences(
    (state) => state.graphs[graph.id]
  );
  const coordinator = useGraphCoordinator();
  const pathname = usePathname();
  const selectRun = useAgentPanelStore((state) => state.selectRun);
  const setOpen = useAgentPanelStore((state) => state.setOpen);
  const setDraft = useAgentPanelStore((state) => state.setDraft);
  const approvalMode = useAgentPanelStore((state) => state.approvalMode);
  const setApprovalMode = useAgentPanelStore((state) => state.setApprovalMode);
  const modelSelection = useAgentPanelStore((state) => state.modelSelection);
  const setModelSelection = useAgentPanelStore(
    (state) => state.setModelSelection
  );
  const {
    data: catalog,
    error: catalogError,
    mutate: refreshCatalog
  } = useSWR('/api/agent/runs', fetchCatalog, {
    refreshInterval: 15000,
    shouldRetryOnError: false
  });
  const selectedRunId = useAgentPanelStore((state) =>
    effectiveAgentRunId(
      state.selectedRuns,
      graph.id,
      catalog?.runs,
      state.restoredRuns
    )
  );
  const graphCatalog = useMemo(
    () =>
      catalog && {
        ...catalog,
        runs: catalog.runs.filter((item) => item.graphId === graph.id)
      },
    [catalog, graph.id]
  );
  const pending = coordinator.attempt(graph.id);
  const feed = useAgentFeed(
    selectedRunId,
    Boolean(pending && pending.phase !== 'rejected')
  );
  const run = feed.run?.graphId === graph.id ? feed.run : null;
  const scope = selectedRunId ?? graph.id;
  const draft = useAgentPanelStore((state) => state.drafts[scope] ?? '');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const retryStartRef = useRef<{
    graphId: string;
    model: string;
    reasoning: string;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const pendingGoal = useAgentPanelStore((state) =>
    selectedRunId ? (state.submissions[selectedRunId]?.text ?? null) : null
  );
  const startTarget = agentStartTarget({
    activeGraphId: graph.id,
    loaded: coordinator.isLoaded(graph.id),
    selectedRunId,
    run
  });

  const start = async (model: string, reasoning: string, retry = false) => {
    if (busyRef.current) return;
    // History is not an editor. Starting requires the selected, loaded graph.
    const graphId = readActiveAgentGraphId(pathname);
    const panel = useAgentPanelStore.getState();
    const target = agentStartTarget({
      activeGraphId: graphId,
      loaded: Boolean(graphId && coordinator.isLoaded(graphId)),
      selectedRunId: graphId
        ? effectiveAgentRunId(
            panel.selectedRuns,
            graphId,
            catalog?.runs,
            panel.restoredRuns
          )
        : null,
      run
    });
    if ((!retry && !target) || (retry && !pending)) {
      setActionError('Open and load the conversation graph before sending.');
      return;
    }
    if (!retry) {
      const submittedScope = target!.parentRunId ?? target!.graphId;
      const submittedText =
        useAgentPanelStore.getState().drafts[submittedScope] ?? '';
      if (!submittedText.trim()) return;
    }
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    retryStartRef.current = null;
    let submittedRunId: string | undefined;
    try {
      let confirmation: Promise<string>;
      if (retry && pending) {
        submittedRunId = pending.runId;
        confirmation = coordinator.retry(pending.graphId);
      } else {
        const submittedScope = target!.parentRunId ?? target!.graphId;
        const submittedText = panel.drafts[submittedScope] ?? '';
        confirmation = coordinator.start({
          ...target!,
          goal: submittedText.trim(),
          model,
          reasoning,
          approvalMode: panel.approvalMode
        });
        // start freezes synchronously, so the attempt exists before any save resolves.
        submittedRunId = coordinator.attempt(target!.graphId)?.runId;
        if (submittedRunId) {
          panel.rememberSubmission(
            submittedRunId,
            submittedScope,
            submittedText
          );
          selectRun(target!.graphId, submittedRunId);
        }
      }
      const runId = await confirmation;
      if (
        coordinator.attempt(retry ? pending!.graphId : target!.graphId)
          ?.runId !== runId
      )
        return;
      useAgentPanelStore.getState().confirmSubmission(runId);
      selectRun(retry ? pending!.graphId : target!.graphId, runId);
      void refreshCatalog();
    } catch (error) {
      if (error instanceof Error && error.message === 'agent_start_cancelled') {
        if (submittedRunId)
          useAgentPanelStore
            .getState()
            .rejectSubmission(graph.id, submittedRunId);
        return;
      }
      // Uncertain/rejected starts own their recovery message in the coordinator.
      // Do not leave a second error behind after the monitor confirms the run.
      if (!coordinator.attempt(retry ? pending?.graphId : target?.graphId)) {
        if (submittedRunId)
          useAgentPanelStore
            .getState()
            .rejectSubmission(graph.id, submittedRunId);
        if (!retry && target)
          retryStartRef.current = { graphId: target.graphId, model, reasoning };
        setActionError(
          error instanceof Error ? error.message : 'Start not confirmed.'
        );
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const action = async (url: string, method: string, body?: object) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      if (!response.ok) throw new Error('agent_action_failed');
      feed.refresh();
      void refreshCatalog();
      if (run)
        void mutate(
          `/api/graphs/${encodeURIComponent(run.graphId)}/write-state`
        );
    } catch {
      setActionError('Action not confirmed. Try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <AgentPanelView
      detached={detached}
      onToggleDetached={onToggleDetached}
      onHeaderPointerDown={onHeaderPointerDown}
      catalog={catalogError ? undefined : graphCatalog}
      run={run}
      events={run ? feed.events : []}
      history={run ? feed.history : []}
      selectedRunId={selectedRunId}
      context={graph}
      graphReferences={graphReferences}
      loading={feed.loading && !pendingGoal && !pending}
      error={
        actionError ??
        pending?.error ??
        (pending && pending.phase !== 'rejected'
          ? null
          : feed.error
            ? feed.unavailable === 'missing'
              ? 'This conversation is unavailable. Retry returns to a new conversation.'
              : feed.unavailable === 'access'
                ? 'Conversation access unavailable. Check your session and permissions.'
                : 'Updates unavailable. The run may still be active.'
            : catalogError
              ? 'Unable to load the agent status.'
              : null)
      }
      busy={busy}
      onContextAction={async (contextAction) => {
        if (!run || run.status === 'running' || pending) return;
        await action(
          `/api/agent/runs/${encodeURIComponent(run.id)}/context`,
          'POST',
          { action: contextAction }
        );
      }}
      canStart={Boolean(startTarget && !pending)}
      startPhase={pending?.phase}
      retryLabel={pending?.phase === 'rejected' ? 'Sync graph' : undefined}
      draft={draft}
      pendingGoal={pendingGoal ?? pending?.request?.goal ?? null}
      approvalMode={approvalMode}
      onApprovalMode={setApprovalMode}
      modelSelection={modelSelection}
      onModelSelection={setModelSelection}
      onDraft={(text) => setDraft(scope, text)}
      onClose={() => setOpen(false)}
      onSelectRun={(id) => {
        retryStartRef.current = null;
        setActionError(null);
        selectRun(graph.id, id);
      }}
      onArchiveThread={(rootId) => {
        setActionError(null);
        void fetch(
          `/api/agent/graphs/${encodeURIComponent(graph.id)}/threads/${encodeURIComponent(rootId)}/archive`,
          { method: 'POST' }
        ).then(async (response) => {
          if (!response.ok) {
            setActionError('Could not archive the conversation.');
            return;
          }
          const activeRoot = selectedRunId
            ? agentRunRootId(graphCatalog?.runs ?? [], selectedRunId)
            : null;
          if (activeRoot === rootId) selectRun(graph.id, null);
          void refreshCatalog();
        });
      }}
      onStop={() => {
        const attempt = coordinator.attempt(graph.id);
        if (attempt?.phase === 'rejected') {
          void coordinator
            .recoverRejected(graph.id)
            .then(() =>
              useAgentPanelStore
                .getState()
                .rejectSubmission(graph.id, attempt.runId)
            )
            .catch((error) => setActionError(error.message));
          return;
        }
        if (
          attempt &&
          attempt.phase !== 'running' &&
          attempt.phase !== 'reloading'
        ) {
          const cancelled = coordinator.cancelStart(graph.id);
          if (!cancelled.runId)
            useAgentPanelStore
              .getState()
              .rejectSubmission(graph.id, attempt.runId);
          else useAgentPanelStore.getState().forgetSubmission(attempt.runId);
          if (cancelled.runId)
            void fetch(
              `/api/agent/runs/${encodeURIComponent(cancelled.runId)}`,
              { method: 'DELETE' }
            );
          return;
        }
        const runId = selectedRunId ?? attempt?.runId;
        if (!runId) return;
        void fetch(`/api/agent/runs/${encodeURIComponent(runId)}`, {
          method: 'DELETE'
        }).then((response) => {
          if (!response.ok) {
            setActionError('Action not confirmed. Try again.');
            return;
          }
          feed.refresh();
          void refreshCatalog();
          if (run)
            void mutate(
              `/api/graphs/${encodeURIComponent(run.graphId)}/write-state`
            );
        });
      }}
      onDecision={(approvalId, approved) => {
        if (selectedRunId)
          void action(
            `/api/agent/runs/${encodeURIComponent(selectedRunId)}/approvals`,
            'POST',
            { approvalId, approved }
          );
      }}
      onSubmit={(model, reasoning) => void start(model, reasoning)}
      onRetry={() => {
        if (pending?.phase === 'rejected') {
          setActionError(null);
          void coordinator
            .recoverRejected(pending.graphId)
            .then(() =>
              useAgentPanelStore
                .getState()
                .rejectSubmission(graph.id, pending.runId)
            )
            .catch((error) => setActionError(error.message));
          return;
        }
        if (pending?.phase === 'uncertain') {
          void start('', '', true);
          return;
        }
        const retryStart = retryStartRef.current;
        if (retryStart?.graphId === graph.id) {
          void start(retryStart.model, retryStart.reasoning);
          return;
        }
        setActionError(null);
        if (feed.unavailable === 'missing' && !pending)
          selectRun(graph.id, null);
        feed.refresh();
        void refreshCatalog();
      }}
    />
  );
}

function LocalRunMonitor({ attempt }: { attempt: LocalAgentStart }) {
  const feed = useAgentFeed(attempt.request ? attempt.runId : null, true);
  useEffect(() => {
    if (!feed.run) return;
    const wasUncertain = attempt.phase === 'uncertain';
    useAgentPanelStore.getState().confirmSubmission(feed.run.id);
    void graphClientCoordinator.observe(feed.run);
    if (wasUncertain)
      useAgentPanelStore.getState().selectRun(feed.run.graphId, feed.run.id);
    if (feed.run.status === 'running') return;
    // A terminal feed stops polling, but snapshot recovery may still need retry.
    const timer = setInterval(
      () => void graphClientCoordinator.observe(feed.run!),
      5000
    );
    return () => clearInterval(timer);
  }, [attempt.phase, feed.run]);
  const graphChanges = feed.events.filter(
    (event) => event.data.type === 'graph_changes'
  ).length;
  useEffect(() => {
    if (graphChanges && feed.run?.status === 'running')
      void graphClientCoordinator.preview(attempt.graphId);
  }, [attempt.graphId, feed.run?.status, graphChanges]);
  return null;
}

function LocalRunMonitors() {
  const coordinator = useGraphCoordinator();
  return (
    <>
      {coordinator.attempts().map((attempt) => (
        <LocalRunMonitor key={attempt.runId} attempt={attempt} />
      ))}
    </>
  );
}

function ResizeHandle({
  onResizing
}: {
  onResizing: (value: boolean) => void;
}) {
  const width = useAgentPanelStore((state) => state.width);
  const setWidth = useAgentPanelStore((state) => state.setWidth);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const stop = () => {
    drag.current = null;
    onResizing(false);
  };
  return (
    <div
      role='separator'
      tabIndex={0}
      aria-label='Agent panel width'
      aria-orientation='vertical'
      aria-valuemin={AGENT_PANEL_MIN_WIDTH}
      aria-valuemax={AGENT_PANEL_MAX_WIDTH}
      aria-valuenow={width}
      className={styles.resize}
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
        onResizing(true);
      }}
      onPointerMove={(event) => {
        if (drag.current)
          setWidth(drag.current.width + event.clientX - drag.current.x);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={(event) => {
        if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
          event.preventDefault();
          setWidth(width + (event.key === 'ArrowRight' ? 20 : -20));
        }
      }}
    />
  );
}

export function AgentDock({ children }: { children: React.ReactNode }) {
  const open = useAgentPanelStore((state) => state.open);
  const setOpen = useAgentPanelStore((state) => state.setOpen);
  const width = useAgentPanelStore((state) => state.width);
  const detached = useAgentPanelStore((state) => state.detached);
  const setDetached = useAgentPanelStore((state) => state.setDetached);
  const graph = useActiveAgentGraph();
  const visible = open && Boolean(graph);
  const mobile = useIsMobile();
  const floating = visible && detached && !mobile;
  const { floatingBoundsRef, floatingRect, beginFloatingInteraction } =
    useFloatingPanel({
      isDetached: floating,
      align: 'left',
      width,
      height: 672
    });
  const reduceMotion = useReducedMotion();
  const [resizing, setResizing] = useState(false);
  const wasOpen = useRef(open);
  useEffect(
    () => () => {
      // Do not carry investigation drafts into a later authenticated session.
      useAgentActivityStore.setState({ runs: {} });
      useAgentPanelStore.setState({
        open: false,
        detached: false,
        selectedRuns: {},
        drafts: {},
        submissions: {}
      });
    },
    []
  );
  useEffect(() => {
    if (wasOpen.current && !open)
      document.getElementById('agent-panel-toggle')?.focus();
    wasOpen.current = open;
  }, [open]);
  return (
    <div className={styles.dock}>
      <LocalRunMonitors />
      {mobile ? (
        <Sheet open={visible} onOpenChange={setOpen}>
          <SheetContent
            side='left'
            aria-describedby={undefined}
            className='!w-full !max-w-none !gap-0 !p-0 [&>button]:hidden'
          >
            <SheetTitle className='sr-only'>PARANOD agent</SheetTitle>
            {graph ? <ConnectedPanel key={graph.id} graph={graph} /> : null}
          </SheetContent>
        </Sheet>
      ) : (
        <AnimatePresence initial={false}>
          {visible && graph && !detached ? (
            <motion.aside
              key='agent-panel'
              className={styles.shell}
              aria-label='Agent panel'
              initial={{ width: 0, opacity: 0 }}
              animate={{ width, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={
                resizing || reduceMotion ? { duration: 0 } : PANEL_TRANSITION
              }
            >
              <div className={styles.shellInner} style={{ width }}>
                <ConnectedPanel
                  key={graph.id}
                  graph={graph}
                  onToggleDetached={() => setDetached(true)}
                />
              </div>
              <ResizeHandle onResizing={setResizing} />
            </motion.aside>
          ) : null}
        </AnimatePresence>
      )}
      {floating && graph && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={floatingBoundsRef}
              className='pointer-events-none fixed inset-x-2 top-12 bottom-9 z-50'
            >
              <motion.div
                aria-label='Floating agent window'
                initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.985 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                  duration: reduceMotion ? 0 : 0.18,
                  ease: 'easeOut'
                }}
                style={{
                  left: floatingRect.x,
                  top: floatingRect.y,
                  width: floatingRect.width,
                  height: floatingRect.height
                }}
                className='border-border/70 bg-background pointer-events-auto absolute overflow-hidden rounded-xl border shadow-[0_4px_16px_rgba(0,0,0,0.16)] dark:border-white/12 dark:shadow-[0_5px_18px_rgba(0,0,0,0.24)]'
              >
                <ConnectedPanel
                  key={graph.id}
                  graph={graph}
                  detached
                  onToggleDetached={() => setDetached(false)}
                  onHeaderPointerDown={(event) =>
                    beginFloatingInteraction(event)
                  }
                />
                {FLOATING_RESIZE_HANDLES.map((handle) => (
                  <div
                    key={handle.key}
                    aria-hidden='true'
                    className={`absolute z-30 touch-none bg-transparent ${handle.className}`}
                    onPointerDown={(event) =>
                      beginFloatingInteraction(
                        event,
                        handle.edges,
                        handle.cursor
                      )
                    }
                  />
                ))}
              </motion.div>
            </div>,
            document.body
          )
        : null}
      <div className={styles.content}>{children}</div>
    </div>
  );
}
