/// <reference lib="webworker" />

import type {
  RelationalLayoutWorkerInMessage,
  RelationalLayoutWorkerOutMessage,
  RelationalLayoutWorkerProgressMessage,
  RelationalLayoutWorkerTickMessage,
  RelationalLayoutWorkerDoneMessage,
  RelationalLayoutWorkerErrorMessage
} from './types';
import { computeForceLayout } from './force-layout';
import { computeHierarchyLayout } from './dagre-layout';

const abortByRequestId = new Map<string, AbortController>();

function post(msg: RelationalLayoutWorkerOutMessage) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

function progress(requestId: string, pct: number, stage: string) {
  const m: RelationalLayoutWorkerProgressMessage = {
    type: 'progress',
    requestId,
    pct: Math.max(0, Math.min(1, pct)),
    stage
  };
  post(m);
}

function tick(requestId: string, pct: number, positions: any[]) {
  const m: RelationalLayoutWorkerTickMessage = {
    type: 'tick',
    requestId,
    pct: Math.max(0, Math.min(1, pct)),
    positions
  };
  post(m);
}

async function run(msg: Extract<RelationalLayoutWorkerInMessage, { type: 'start' }>) {
  const controller = new AbortController();
  abortByRequestId.set(msg.requestId, controller);

  try {
    progress(msg.requestId, 0.01, 'start');

    const positions =
      msg.engine === 'force'
        ? await computeForceLayout({
            nodes: msg.nodes,
            edges: msg.edges,
            options: msg.options as any,
            onProgress: (pct, stage) => progress(msg.requestId, pct, stage),
            onTick: (pct, pos) => {
              // Per evitare overhead su grafi grandi, streamiamo tick solo fino a una certa dimensione.
              if ((msg.nodes?.length ?? 0) > 420) return;
              tick(msg.requestId, pct, pos);
            },
            signal: controller.signal,
            yieldToMainThread: false
          })
        : await computeHierarchyLayout({
            nodes: msg.nodes,
            edges: msg.edges,
            options: msg.options as any,
            onProgress: (pct, stage) => progress(msg.requestId, pct, stage),
            signal: controller.signal
          });

    if (controller.signal.aborted) throw new Error('aborted');

    const out: RelationalLayoutWorkerDoneMessage = {
      type: 'done',
      requestId: msg.requestId,
      positions
    };
    post(out);
  } catch (err: any) {
    const message =
      typeof err?.message === 'string' ? err.message : 'layout_failed';
    const out: RelationalLayoutWorkerErrorMessage = {
      type: 'error',
      requestId: msg.requestId,
      message
    };
    post(out);
  } finally {
    abortByRequestId.delete(msg.requestId);
  }
}

(self as unknown as DedicatedWorkerGlobalScope).onmessage = (event) => {
  const msg = event.data as RelationalLayoutWorkerInMessage;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'cancel') {
    const c = abortByRequestId.get(msg.requestId);
    c?.abort();
    abortByRequestId.delete(msg.requestId);
    return;
  }

  if (msg.type === 'start') {
    void run(msg);
  }
};
