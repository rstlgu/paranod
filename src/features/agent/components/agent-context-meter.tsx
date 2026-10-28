'use client';

import { useState } from 'react';
import { Eraser, Minimize2, LoaderCircle } from 'lucide-react';
import type { AgentRunSummary, AgentEvent } from '../lib/contracts';
import { emptyContextUsage } from '../lib/context';
import styles from './agent-panel.module.css';

const number = (value: number) => value.toLocaleString();
export function AgentContextMeter({
  run,
  events,
  selectedModel,
  disabled,
  onAction
}: {
  run: AgentRunSummary | null;
  events: AgentEvent[];
  selectedModel?: string;
  disabled: boolean;
  onAction?: (action: 'clear' | 'compact') => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pending, setPending] = useState<'clear' | 'compact' | null>(null);
  const latest = events.findLast((event) => event.data.type === 'usage')?.data;
  // Manual context changes update the run snapshot without rewriting its log.
  const usage =
    run?.contextUsage ??
    (latest?.type === 'usage'
      ? latest.context
      : emptyContextUsage(run?.model ?? selectedModel));
  const input =
    run?.inputTokens ?? (latest?.type === 'usage' ? latest.inputTokens : 0);
  const output =
    run?.outputTokens ?? (latest?.type === 'usage' ? latest.outputTokens : 0);
  const percent = Math.min(100, Math.round((usage.tokens / usage.limit) * 100));
  const compacting =
    pending === 'compact' ||
    (run?.status === 'running' && usage.state === 'compacting');
  const blocked = disabled || Boolean(pending) || !run || !onAction;
  async function act(action: 'clear' | 'compact') {
    if (blocked) return;
    setPending(action);
    try {
      await onAction?.(action);
      setConfirmClear(false);
    } finally {
      setPending(null);
    }
  }
  return (
    <div className={styles.contextControl}>
      <button
        type='button'
        className={styles.contextTrigger}
        aria-label={`Context usage: ${percent}%`}
        aria-expanded={open}
        title={`Context ${percent}% · ${number(input + output)} tokens used`}
        onClick={() => {
          setOpen(!open);
          setConfirmClear(false);
        }}
      >
        {compacting ? (
          <LoaderCircle size={18} className={styles.spin} />
        ) : (
          <svg width='19' height='19' viewBox='0 0 24 24' aria-hidden='true'>
            <circle
              cx='12'
              cy='12'
              r='9'
              fill='none'
              stroke='currentColor'
              strokeWidth='2.5'
              opacity='.2'
            />
            <circle
              cx='12'
              cy='12'
              r='9'
              fill='none'
              stroke='currentColor'
              strokeWidth='2.5'
              strokeLinecap='round'
              pathLength='100'
              strokeDasharray={`${percent} 100`}
              transform='rotate(-90 12 12)'
            />
          </svg>
        )}
      </button>
      {open ? (
        <>
          <button
            type='button'
            className={styles.contextBackdrop}
            aria-label='Close context details'
            onClick={() => setOpen(false)}
          />
          <div
            className={styles.contextPopover}
            role='dialog'
            aria-label='Agent context'
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false);
            }}
          >
            <div className={styles.contextHeading}>
              <strong>Working context</strong>
              <span>{percent}%</span>
            </div>
            <p>
              {usage.estimated ? '≈ ' : ''}
              {number(usage.tokens)} / {number(usage.limit)} tokens
            </p>
            <small>
              Application budget, not the model’s maximum.{' '}
              {usage.estimated
                ? 'Context size is estimated.'
                : 'Last request reported by the provider.'}{' '}
              Compacts automatically to keep space for tools.
            </small>
            <div className={styles.contextStats}>
              <span>Tokens used · this run</span>
              <strong>{number(input + output)}</strong>
              <span>Input</span>
              <span>{number(input)}</span>
              <span>Output</span>
              <span>{number(output)}</span>
            </div>
            {compacting ? (
              <p role='status'>Compacting context…</p>
            ) : usage.state === 'cleared' ? (
              <p role='status'>Memory cleared. Graph and messages preserved.</p>
            ) : usage.compactions ? (
              <p>Compacted {usage.compactions}×</p>
            ) : null}
            {confirmClear ? (
              <div className={styles.contextConfirmation}>
                <p>
                  Forget previous conversation context? The graph and visible
                  messages will stay.
                </p>
                <button
                  type='button'
                  disabled={blocked}
                  onClick={() => void act('clear')}
                >
                  Confirm clear context
                </button>
                <button type='button' onClick={() => setConfirmClear(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className={styles.contextButtons}>
                <button
                  type='button'
                  disabled={blocked || usage.state === 'cleared'}
                  onClick={() => void act('compact')}
                >
                  <Minimize2 size={13} /> Compact now
                </button>
                <button
                  type='button'
                  disabled={blocked || usage.state === 'cleared'}
                  onClick={() => setConfirmClear(true)}
                >
                  <Eraser size={13} /> Clear context
                </button>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
