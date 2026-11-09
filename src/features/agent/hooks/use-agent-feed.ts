'use client';

import { useEffect, useRef, useState } from 'react';
import { useAgentActivityStore } from '../store/agent-activity-store';
import {
  mergeAgentEvents,
  type AgentEvent,
  type AgentFeed,
  type AgentHistoryExchange,
  type AgentRunSummary
} from '../lib/contracts';

export function useAgentFeed(runId: string | null, retryMissing = false) {
  const [feed, setFeed] = useState<{
    id: string | null;
    run: AgentRunSummary | null;
    events: AgentEvent[];
    history: AgentHistoryExchange[];
    error: boolean;
    unavailable?: 'missing' | 'access';
  }>({ id: null, run: null, events: [], history: [], error: false });
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cursor = 0;
    let inFlight = false;
    let retryMs = 1500;
    const poll = async () => {
      if (inFlight || controller.signal.aborted) return;
      clearTimeout(timer);
      inFlight = true;
      let nextDelay: number | null = 1500;
      try {
        const response = await fetch(
          `/api/agent/runs/${encodeURIComponent(runId)}?after=${cursor}`,
          { cache: 'no-store', signal: controller.signal }
        );
        if (controller.signal.aborted) return;
        if (!response.ok) {
          // A local monitor may race the transaction that creates its run.
          if (response.status === 404 && retryMissing) {
            nextDelay = retryMs;
            retryMs = Math.min(retryMs * 2, 15000);
            return;
          }
          if ([401, 403, 404].includes(response.status)) {
            cursor = 0;
            setFeed({
              id: runId,
              run: null,
              events: [],
              history: [],
              error: true,
              unavailable: response.status === 404 ? 'missing' : 'access'
            });
            nextDelay = null;
            return;
          }
          throw new Error('agent_feed_failed');
        }
        const data = (await response.json()) as AgentFeed;
        if (controller.signal.aborted) return;
        if (data.run.id !== runId) throw new Error('agent_feed_mismatch');
        useAgentActivityStore
          .getState()
          .receive(data.run, data.events, !data.hasMore);
        for (const event of data.events)
          cursor = Math.max(cursor, event.sequence);
        setFeed((previous) => ({
          id: runId,
          run: data.run,
          events: mergeAgentEvents(
            previous.id === runId ? previous.events : [],
            data.events
          ),
          history:
            data.history ?? (previous.id === runId ? previous.history : []),
          error: false
        }));
        retryMs = 1500;
        nextDelay = data.hasMore
          ? 0
          : data.run.status === 'running'
            ? 1000
            : null;
      } catch {
        if (!controller.signal.aborted)
          setFeed((previous) =>
            previous.id === runId
              ? { ...previous, error: true }
              : { id: runId, run: null, events: [], history: [], error: true }
          );
        retryMs = Math.min(retryMs * 2, 15000);
        nextDelay = retryMs;
      } finally {
        inFlight = false;
        if (!controller.signal.aborted && nextDelay !== null)
          timer = setTimeout(() => void poll(), nextDelay);
      }
    };
    refreshRef.current = () => void poll();
    void poll();
    const onFocus = () => void poll();
    window.addEventListener('focus', onFocus);
    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      refreshRef.current = () => {};
    };
  }, [runId, retryMissing]);
  const current =
    feed.id === runId
      ? feed
      : {
          run: null,
          events: [],
          history: [],
          error: false,
          unavailable: undefined
        };
  return {
    ...current,
    loading: Boolean(runId && !current.run && !current.error),
    refresh: () => refreshRef.current()
  };
}
