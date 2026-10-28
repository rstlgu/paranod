'use client';

import { useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronRight,
  ExternalLink,
  GitBranch,
  BookOpen,
  Wrench,
  ScanLine,
  Sparkles,
  ShieldCheck,
  ShieldX
} from 'lucide-react';
import type { AgentEvent, AgentEventData } from '../lib/contracts';
import type { AgentTimelineBlock } from '../lib/timeline';
import { describeCompactActivity } from '../lib/timeline';
import { AgentMarkdown } from './agent-markdown';
import styles from './agent-panel.module.css';

type StepsBlock = Extract<AgentTimelineBlock, { kind: 'steps' }>;

interface AgentStepsProps {
  block: StepsBlock;
  decisions: ReadonlyMap<string, boolean>;
  // The run is still producing events and this is its latest block.
  live: boolean;
  latestActivity?: AgentEvent;
  latestNote?: AgentEvent;
  // Tool calls may still be running (the run is active and the feed is fresh).
  running: boolean;
  stale: boolean;
}

export function AgentSteps({
  block,
  decisions,
  live,
  latestActivity,
  latestNote,
  running,
  stale
}: AgentStepsProps) {
  const [open, setOpen] = useState(false);
  const note =
    latestNote?.data.type === 'message' ? latestNote.data.text : null;
  const activity =
    latestActivity && latestActivity.data.type !== 'message'
      ? describeCompactActivity(latestActivity.data)
      : null;
  const count =
    block.steps.length === 1 ? '1 step' : `${block.steps.length} steps`;
  return (
    <div className={styles.steps} data-open={open || undefined}>
      {live && !open ? (
        <div className={styles.compactWork}>
          {note ? (
            <div className={styles.workNote}>
              <AgentMarkdown text={note} />
            </div>
          ) : null}
          <div className={styles.compactRow}>
            <ActivityIcon data={latestActivity?.data} animated />
            <div
              className={styles.compactActivity}
              role='status'
              aria-live='polite'
              aria-atomic='true'
            >
              <div
                key={note ?? activity ?? 'preparing'}
                className={styles.compactNote}
              >
                <AgentMarkdown
                  text={
                    activity ?? (note ? 'Continuing…' : 'Thinking…')
                  }
                />
              </div>
            </div>
            <button
              type='button'
              className={styles.stepsToggle}
              aria-expanded={false}
              aria-label='Show activity details'
              onClick={() => setOpen(true)}
            >
              <ChevronRight size={13} className={styles.chevron} />
            </button>
          </div>
        </div>
      ) : (
        <button
          type='button'
          className={styles.stepsToggle}
          aria-expanded={open}
          aria-label={live && !open ? 'Show activity details' : undefined}
          onClick={() => setOpen((value) => !value)}
        >
          <ActivityIcon data={latestActivity?.data} animated={live} />
          <span className={styles.stepsSummary}>
            <strong>
              {live
                ? 'Working'
                : `Activity · ${formatSeconds(block.startedAt, block.endedAt)}`}
            </strong>
            <small>{count}</small>
          </span>
          <ChevronRight size={13} className={styles.chevron} />
        </button>
      )}
      {open ? (
        <ol className={styles.stepList}>
          {block.steps.map((step) => (
            <AgentStep
              key={step.sequence}
              step={step}
              decisions={decisions}
              running={running}
              stale={stale}
            />
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function AgentStep({
  step,
  decisions,
  running,
  stale
}: {
  step: AgentEvent;
  decisions: ReadonlyMap<string, boolean>;
  running: boolean;
  stale: boolean;
}) {
  const data = step.data;
  const { title, detail } = describeStep(data, decisions);
  if (data.type === 'tool') {
    const isRunning = running && data.status === 'running';
    const label =
      data.status === 'completed'
        ? 'Done'
        : data.status === 'failed'
          ? 'Error'
          : isRunning
            ? 'Running'
            : stale
              ? 'Status out of date'
              : 'Stopped';
    return (
      <li className={styles.step} data-state={data.status}>
        {isRunning ? (
          <ActivityIcon data={data} animated />
        ) : data.status === 'completed' ? (
          <Check size={13} className={styles.success} />
        ) : data.status === 'failed' ? (
          <AlertCircle size={13} className={styles.failure} />
        ) : (
          <span className={styles.stepDot} />
        )}
        <div>
          <span className={styles.stepTitle}>
            {title}
            <span className={styles.toolStatus}>
              {label}
              {data.durationMs !== undefined
                ? ` · ${(data.durationMs / 1000).toFixed(1)} s`
                : null}
            </span>
          </span>
          {detail ? <small>{detail}</small> : null}
          {data.status === 'failed' && data.summary ? (
            <p>{data.summary}</p>
          ) : null}
          <Sources sources={data.sources} />
        </div>
      </li>
    );
  }
  return (
    <li className={styles.step}>
      {data.type === 'graph_changes' ? (
        <GitBranch size={13} className={styles.success} />
      ) : data.type === 'approval' ? (
        decisions.get(data.approvalId) ? (
          <ShieldCheck size={13} className={styles.success} />
        ) : (
          <ShieldX size={13} className={styles.failure} />
        )
      ) : (
        <span className={styles.stepDot} />
      )}
      <div>
        <span className={styles.stepTitle}>{title}</span>
        {detail ? (
          data.type === 'message' ? (
            <AgentMarkdown text={detail} />
          ) : (
            <p>{detail}</p>
          )
        ) : null}
      </div>
    </li>
  );
}

function ActivityIcon({
  data,
  animated = false
}: {
  data?: AgentEventData;
  animated?: boolean;
}) {
  const name = data?.type === 'tool' ? data.name : '';
  const Icon =
    data?.type === 'graph_changes' ||
    ['add_seed', 'delete_nodes', 'propose_relationship'].includes(name)
      ? GitBranch
      : name === 'read_graph'
        ? BookOpen
        : name === 'compact_context'
          ? ScanLine
          : data?.type === 'tool'
            ? Wrench
            : Sparkles;
  return (
    <Icon
      size={15}
      className={animated ? styles.activityPulse : styles.activityIcon}
      aria-hidden
    />
  );
}

export function Sources({
  sources
}: {
  sources: Array<{ title: string; url: string }>;
}) {
  if (!sources.length) return null;
  return (
    <ul className={styles.sources}>
      {sources.map((source, index) => (
        <li key={`${source.url}-${index}`}>
          <a href={source.url} target='_blank' rel='noopener noreferrer'>
            {source.title}
            <ExternalLink size={11} />
          </a>
        </li>
      ))}
    </ul>
  );
}

function describeStep(
  data: AgentEventData,
  decisions: ReadonlyMap<string, boolean>
) {
  if (data.type === 'phase')
    return { title: PHASE_LABELS[data.phase], detail: data.summary };
  if (data.type === 'tool')
    return { title: TOOL_LABELS[data.name] ?? data.name, detail: data.target };
  if (data.type === 'graph_changes')
    return {
      title: 'Graph updated',
      detail:
        data.nodesRemoved || data.edgesRemoved
          ? `−${data.nodesRemoved ?? 0} nodes · −${data.edgesRemoved ?? 0} links`
          : `+${data.nodesAdded} nodes · +${data.edgesAdded} links`
    };
  if (data.type === 'approval')
    return {
      title: decisions.get(data.approvalId)
        ? 'Approval granted'
        : 'Approval denied',
      detail: `${data.summary}\n${data.destination}`
    };
  if (data.type === 'message') return { title: 'Note', detail: data.text };
  return { title: '', detail: '' };
}

function formatSeconds(startedAt: string, endedAt: string) {
  const seconds = Math.max(
    1,
    Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)
  );
  return seconds < 60
    ? `${seconds} s`
    : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export const PHASE_LABELS = {
  planning: 'Planning',
  thinking: 'Thinking',
  researching: 'Researching',
  updating_graph: 'Updating graph'
};

const TOOL_LABELS: Record<string, string> = {
  read_graph: 'Reading the graph',
  list_modules: 'Looking up modules',
  describe_module: 'Loading tool details',
  compact_context: 'Compacting context',
  add_seed: 'Adding entity',
  delete_nodes: 'Removing nodes',
  merge_nodes: 'Merging nodes',
  propose_relationship: 'Proposing a link',
  run_transform: 'Running transform'
};
