'use client';

import {
  AlertCircle,
  AppWindow,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  LoaderCircle,
  MessageSquarePlus,
  PanelLeft,
  PanelRightClose,
  ShieldCheck,
  Square,
  X
} from 'lucide-react';
import Link from 'next/link';
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  DEFAULT_AGENT_APPROVAL_MODE,
  type AgentApprovalMode,
  type AgentCatalog,
  type AgentEvent,
  type AgentHistoryExchange,
  type AgentRunSummary
} from '../lib/contracts';
import { agentRunRootId } from '../lib/conversation-threads';
import {
  agentTimeline,
  groupAgentTimeline,
  latestAgentActivity,
  latestAgentNote
} from '../lib/timeline';
import type { AgentGraphReferences } from '../store/agent-graph-references';
import { AgentApprovalPicker } from './agent-approval-picker';
import { AgentComposer } from './agent-composer';
import { AgentContextMeter } from './agent-context-meter';
import { AgentConversationMenu } from './agent-conversation-menu';
import {
  AgentMentionProvider,
  AgentMarkdown as PublicMarkdown
} from './agent-markdown';
import {
  AgentModelPicker,
  type AgentModelSelection
} from './agent-model-picker';
import styles from './agent-panel.module.css';
import { AgentSteps, Sources } from './agent-steps';

interface Props {
  onContextAction?: (action: 'clear' | 'compact') => Promise<void>;
  detached?: boolean;
  onToggleDetached?: () => void;
  onHeaderPointerDown?: React.PointerEventHandler<HTMLElement>;
  graphReferences?: AgentGraphReferences;
  catalog: AgentCatalog | undefined;
  run: AgentRunSummary | null;
  events: AgentEvent[];
  history?: AgentHistoryExchange[];
  selectedRunId: string | null;
  context: { id: string; name: string } | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  canStart?: boolean;
  startPhase?: string;
  retryLabel?: string;
  draft: string;
  pendingGoal?: string | null;
  approvalMode?: AgentApprovalMode;
  onApprovalMode?: (mode: AgentApprovalMode) => void;
  modelSelection?: AgentModelSelection | null;
  onModelSelection?: (selection: AgentModelSelection) => void;
  onDraft: (text: string) => void;
  onClose: () => void;
  onSelectRun: (id: string | null) => void;
  onArchiveThread: (rootId: string) => void;
  onStop: () => void;
  onDecision: (id: string, approved: boolean) => void;
  onSubmit: (model: string, reasoning: string) => void;
  onRetry: () => void;
}

const STATUS_LABELS = {
  running: 'Running',
  completed: 'Completed',
  cancelled: 'Stopped',
  failed: 'Failed',
  interrupted: 'Worker connection lost'
};

function IconButton({
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type='button'
      className={styles.iconButton}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}

function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <IconButton
      label={failed ? 'Copy failed' : copied ? 'Copied' : 'Copy response'}
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setFailed(false);
          })
          .catch(() => setFailed(true));
      }}
    >
      {copied ? (
        <Check size={13} />
      ) : failed ? (
        <AlertCircle size={13} />
      ) : (
        <Copy size={13} />
      )}
    </IconButton>
  );
}

function Elapsed({ run }: { run: AgentRunSummary }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (run.status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [run.status]);
  const seconds = Math.max(
    0,
    Math.floor(
      ((run.endedAt ? Date.parse(run.endedAt) : now) -
        Date.parse(run.createdAt)) /
        1000
    )
  );
  return (
    <span className={styles.elapsed}>
      {seconds >= 60 ? `${Math.floor(seconds / 60)}min ` : ''}
      {seconds % 60}s
    </span>
  );
}

/** Prior turns to paint. While a follow-up feed is still loading, keep the last transcript. */
export function exchangesToShow(
  history: AgentHistoryExchange[],
  runId: string | undefined,
  pinned: AgentHistoryExchange[],
  keepPinned: boolean
) {
  const prior = history.filter((exchange) => exchange.runId !== runId);
  if (keepPinned && prior.length === 0) return pinned.slice(-7);
  return prior.slice(-6);
}

export function pinTranscript(
  history: AgentHistoryExchange[],
  run: { id: string; goal: string },
  messages: string[]
) {
  const prior = history.filter((exchange) => exchange.runId !== run.id);
  return [...prior, { runId: run.id, goal: run.goal, messages }];
}

function UserMessage({ text }: { text: string }) {
  return (
    <div className={styles.userMessage}>
      <PublicMarkdown text={text} />
    </div>
  );
}

export function AgentPanelView(props: Props) {
  const { run, events } = props;
  // Only reveal answers from a run observed live, not a reopened transcript.
  const [motionSession, setMotionSession] = useState({
    runId: run?.id,
    wasLive: run?.status === 'running'
  });
  if (
    motionSession.runId !== run?.id ||
    (!motionSession.wasLive && run?.status === 'running')
  ) {
    setMotionSession({ runId: run?.id, wasLive: run?.status === 'running' });
  }
  const [atBottom, setAtBottom] = useState(true);
  const followingRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedHistory = useRef<AgentHistoryExchange[]>([]);
  const textareaRef = useRef<{ focus: () => void } | null>(null);
  const decisions = useMemo(
    () =>
      new Map(
        events.flatMap((event) =>
          event.data.type === 'decision'
            ? [[event.data.approvalId, event.data.approved] as const]
            : []
        )
      ),
    [events]
  );
  const starting = ['preparing', 'uncertain', 'running'].includes(
    props.startPhase ?? ''
  );
  const active = run?.status === 'running' || starting;
  const blocks = useMemo(
    () =>
      groupAgentTimeline(
        agentTimeline(events),
        new Set(decisions.keys()),
        active
      ),
    [events, decisions, active]
  );
  const latestActivity = useMemo(() => latestAgentActivity(events), [events]);
  const latestNote = useMemo(() => latestAgentNote(events), [events]);
  const pendingApproval = events.some(
    (event) =>
      event.data.type === 'approval' && !decisions.has(event.data.approvalId)
  );
  const answerParts = blocks.flatMap((block) =>
    block.kind === 'event' && block.event.data.type === 'message'
      ? [block.event.data.text]
      : []
  );
  const answer = answerParts.join('\n\n');
  const catalogModels = props.catalog?.models ?? [];
  const runnableModels = catalogModels.filter((option) => option.available);
  const requested =
    active && run
      ? { model: run.model, reasoning: run.reasoning }
      : props.modelSelection;
  const requestedModel = runnableModels.find(
    (option) => option.id === requested?.model
  );
  const selectedModel = requestedModel ?? runnableModels[0];
  const selectedReasoning =
    requestedModel &&
    requested &&
    requestedModel.reasoningLevels.includes(requested.reasoning)
      ? requested.reasoning
      : (selectedModel?.defaultReasoning ?? '');
  const approvalMode =
    active && run
      ? run.approvalMode
      : (props.approvalMode ?? DEFAULT_AGENT_APPROVAL_MODE);
  const canSubmit = Boolean(
    props.catalog?.available &&
      props.canStart !== false &&
      props.context &&
      selectedModel &&
      props.draft.trim() &&
      !active &&
      !props.error
  );
  const displayedGoal = run?.goal ?? props.pendingGoal ?? null;
  const showLoading = props.loading && !run && !props.pendingGoal;
  const showEmpty = !run && !props.loading && !props.pendingGoal;
  const followUpPending = !run && Boolean(displayedGoal);
  if (run && displayedGoal) {
    pinnedHistory.current = pinTranscript(
      props.history ?? [],
      { id: run.id, goal: displayedGoal },
      answerParts
    );
  }
  const priorExchanges = exchangesToShow(
    props.history ?? [],
    run?.id,
    pinnedHistory.current,
    followUpPending
  );
  const scrollToEnd = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    followingRef.current = true;
    setAtBottom(true);
  };
  const followReveal = () => {
    const el = scrollRef.current;
    if (el && followingRef.current) el.scrollTop = el.scrollHeight;
  };
  useLayoutEffect(() => {
    if (atBottom) scrollToEnd();
  }, [events, props.history, props.pendingGoal, atBottom]);
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);
  const isLive = active && !props.error;
  const composerHint =
    props.startPhase === 'preparing'
      ? 'Saving and checking the graph…'
      : props.startPhase === 'uncertain'
        ? 'Start still to be confirmed'
        : props.startPhase === 'reloading'
          ? 'Reloading graph…'
          : props.catalog && !props.catalog.available
            ? 'Engine not connected'
            : null;

  return (
    <AgentMentionProvider value={props.graphReferences}>
      <section
        className={styles.panel}
        aria-label='PARANOD agent'
        data-allow-text-selection='true'
      >
        <header
          className={styles.header}
          data-floating={props.detached || undefined}
          onPointerDown={props.onHeaderPointerDown}
        >
          <strong className={styles.title}>Paranod Agent</strong>
          <div className={styles.headerActions}>
            <AgentConversationMenu
              runs={props.catalog?.runs ?? []}
              selectedRunId={props.selectedRunId}
              disabled={!props.catalog}
              onSelect={props.onSelectRun}
              onArchive={(rootId) => {
                if (
                  props.selectedRunId &&
                  agentRunRootId(
                    props.catalog?.runs ?? [],
                    props.selectedRunId
                  ) === rootId
                )
                  props.onSelectRun(null);
                props.onArchiveThread(rootId);
              }}
            />
            <IconButton
              label='New conversation'
              onClick={() => props.onSelectRun(null)}
            >
              <MessageSquarePlus size={15} />
            </IconButton>
            {props.onToggleDetached ? (
              <IconButton
                label={
                  props.detached
                    ? 'Attach agent to the left sidebar'
                    : 'Detach agent into a floating window'
                }
                onClick={props.onToggleDetached}
              >
                {props.detached ? (
                  <PanelLeft size={15} />
                ) : (
                  <AppWindow size={15} />
                )}
              </IconButton>
            ) : null}
            <IconButton
              label={
                props.detached ? 'Close floating agent' : 'Close agent panel'
              }
              onClick={props.onClose}
            >
              {props.detached ? <X size={15} /> : <PanelRightClose size={15} />}
            </IconButton>
          </div>
        </header>
        <div
          className={styles.transcript}
          ref={scrollRef}
          onScroll={() => {
            const el = scrollRef.current;
            if (el) {
              const follows =
                el.scrollHeight - el.scrollTop - el.clientHeight < 70;
              followingRef.current = follows;
              setAtBottom(follows);
            }
          }}
        >
          {showLoading ? (
            <p className={styles.status} role='status'>
              <LoaderCircle className={styles.spin} size={14} />
              Loading conversation
            </p>
          ) : null}
          {showEmpty ? (
            <div className={styles.empty}>
              <h2>New investigation</h2>
              <span>
                {props.catalog?.available
                  ? 'Ask the agent to explore or expand this graph.'
                  : agentAvailabilityMessage(props.catalog?.reason)}
              </span>
              {[
                'agent_provider_key_not_configured',
                'agent_configuration_unavailable'
              ].includes(props.catalog?.reason ?? '') ? (
                <Link href='/settings/agent'>Configure agent</Link>
              ) : null}
            </div>
          ) : null}
          {run || displayedGoal ? (
            <>
              {priorExchanges.map((exchange) => {
                const report = exchange.messages.at(-1);
                return (
                  <Fragment key={exchange.runId}>
                    <UserMessage text={exchange.goal} />
                    {report ? (
                      <div className={styles.turn}>
                        <article className={styles.message}>
                          <PublicMarkdown text={report} />
                        </article>
                        <div className={styles.turnFooter}>
                          <CopyText text={report} />
                        </div>
                      </div>
                    ) : null}
                  </Fragment>
                );
              })}
              <UserMessage text={displayedGoal!} />
              {run ? (
                <div className={styles.turn} data-current>
                  <div className={styles.workHeader} role='status'>
                    <span>
                      {active
                        ? 'Working for '
                        : run.status === 'completed'
                          ? 'Completed in '
                          : `${STATUS_LABELS[run.status]} · `}
                      <Elapsed run={run} />
                    </span>
                    {props.error ? (
                      <span>Updates paused</span>
                    ) : pendingApproval && active ? (
                      <span>Waiting for approval</span>
                    ) : null}
                  </div>
                  {blocks.map((block, index) => {
                    if (block.kind === 'steps')
                      return (
                        <AgentSteps
                          key={block.key}
                          block={block}
                          decisions={decisions}
                          live={isLive && index === blocks.length - 1}
                          latestActivity={latestActivity}
                          latestNote={latestNote}
                          running={isLive}
                          stale={Boolean(props.error)}
                        />
                      );
                    const { event } = block;
                    const data = event.data;
                    if (data.type === 'message')
                      return (
                        <article
                          key={`${run.id}-${event.sequence}`}
                          className={styles.message}
                        >
                          <PublicMarkdown
                            text={data.text}
                            animate={
                              motionSession.runId === run.id &&
                              motionSession.wasLive
                            }
                            onRevealProgress={followReveal}
                          />
                          <Sources sources={data.sources} />
                        </article>
                      );
                    if (data.type === 'approval')
                      return (
                        <div key={event.sequence} className={styles.approval}>
                          <div className={styles.approvalHead}>
                            <ShieldCheck size={14} />
                            <strong>Approval needed</strong>
                          </div>
                          <p>{data.summary}</p>
                          <small>{data.destination}</small>
                          {active ? (
                            <div className={styles.decisionActions}>
                              <button
                                type='button'
                                disabled={props.busy || Boolean(props.error)}
                                onClick={() =>
                                  props.onDecision(data.approvalId, false)
                                }
                              >
                                Deny
                              </button>
                              <button
                                type='button'
                                disabled={props.busy || Boolean(props.error)}
                                onClick={() =>
                                  props.onDecision(data.approvalId, true)
                                }
                              >
                                Approve
                              </button>
                            </div>
                          ) : (
                            <small>Request expired</small>
                          )}
                        </div>
                      );
                    return null;
                  })}
                  <div className={styles.turnFooter}>
                    {answer && !active ? <CopyText text={answer} /> : null}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        {!atBottom ? (
          <div className={styles.scrollBottom}>
            <IconButton label='Jump to latest' onClick={scrollToEnd}>
              <ArrowDown size={15} />
            </IconButton>
          </div>
        ) : null}
        {props.error ? (
          <div className={styles.error} role='alert'>
            <AlertCircle size={14} />
            <span>{props.error}</span>
            <button type='button' onClick={props.onRetry}>
              {props.retryLabel ?? 'Retry'}
            </button>
          </div>
        ) : null}
        <form
          className={styles.composer}
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit && selectedModel)
              props.onSubmit(selectedModel.id, selectedReasoning);
          }}
        >
          <div
            className={styles.composerBox}
            onClick={(event) => {
              if (event.target === event.currentTarget)
                textareaRef.current?.focus();
            }}
          >
            <AgentComposer
              focusRef={textareaRef}
              references={props.graphReferences}
              placeholder={
                active
                  ? 'The agent is working…'
                  : 'Ask the agent… (@ to mention a node)'
              }
              value={props.draft}
              readOnly={Boolean(props.startPhase)}
              onChange={props.onDraft}
              onSubmit={() => {
                if (canSubmit && selectedModel)
                  props.onSubmit(selectedModel.id, selectedReasoning);
              }}
            />
            <div className={styles.composerActions}>
              <div className={styles.modelControls}>
                <AgentModelPicker
                  models={catalogModels}
                  value={
                    selectedModel
                      ? {
                          model: selectedModel.id,
                          reasoning: selectedReasoning
                        }
                      : null
                  }
                  disabled={active || Boolean(props.startPhase)}
                  onChange={(selection) => props.onModelSelection?.(selection)}
                />
                <AgentApprovalPicker
                  value={approvalMode}
                  disabled={
                    active || Boolean(props.startPhase) || !props.onApprovalMode
                  }
                  onChange={(mode) => props.onApprovalMode?.(mode)}
                />
                <AgentContextMeter
                  key={run?.id ?? 'new'}
                  run={run}
                  events={props.events}
                  selectedModel={selectedModel?.id}
                  disabled={active || props.busy || Boolean(props.startPhase)}
                  onAction={props.onContextAction}
                />
              </div>
              {active ? (
                <button
                  className={styles.send}
                  type='button'
                  aria-label='Stop agent'
                  title='Stop agent'
                  onClick={props.onStop}
                >
                  <Square size={12} fill='currentColor' />
                </button>
              ) : (
                <button
                  className={styles.send}
                  type='submit'
                  aria-label='Send message'
                  title={
                    !props.catalog?.available
                      ? 'AI engine not configured'
                      : 'Send message'
                  }
                  disabled={!canSubmit}
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          </div>
          {composerHint ? (
            <p className={styles.composerHint}>{composerHint}</p>
          ) : null}
        </form>
      </section>
    </AgentMentionProvider>
  );
}

function agentAvailabilityMessage(reason?: string | null) {
  const messages: Record<string, string> = {
    agent_worker_disabled: 'Agent service disabled',
    agent_worker_unavailable: 'Agent service unavailable',
    agent_worker_busy: 'Agent service busy',
    agent_provider_key_not_configured:
      'No provider key configured for the agent',
    agent_configuration_unavailable: 'AI configuration unavailable'
  };
  return messages[reason ?? ''] ?? 'AI engine not configured';
}
