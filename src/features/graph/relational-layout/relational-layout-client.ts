'use client';

import type {
  RelationalLayoutEngine,
  RelationalLayoutEdgeInput,
  RelationalLayoutNodeInput,
  RelationalLayoutPosition,
  RelationalLayoutWorkerInMessage,
  RelationalLayoutWorkerOutMessage
} from './types';
import { computeForceLayout } from './force-layout';
import { computeHierarchyLayout } from './dagre-layout';

function makeRequestId() {
  return `rel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function shouldUseWorker(nodeCount: number, edgeCount: number) {
  return nodeCount >= 200 || edgeCount >= 300;
}

let workerSingleton: Worker | null = null;
function getWorker(): Worker {
  if (workerSingleton) return workerSingleton;
  workerSingleton = new Worker(
    new URL('./relational-layout.worker.ts', import.meta.url),
    { type: 'module' }
  );
  return workerSingleton;
}

export async function computeRelationalPositions(args: {
  engine: RelationalLayoutEngine;
  nodes: RelationalLayoutNodeInput[];
  edges: RelationalLayoutEdgeInput[];
  options: any;
  onProgress?: (pct: number, stage: string) => void;
  onTick?: (pct: number, positions: RelationalLayoutPosition[]) => void;
  signal?: AbortSignal;
}): Promise<RelationalLayoutPosition[]> {
  const onProgress = args.onProgress ?? (() => {});
  const onTick = args.onTick ?? null;
  const nodeCount = args.nodes.length;
  const edgeCount = args.edges.length;

  const canUseWorker =
    typeof Worker !== 'undefined' && shouldUseWorker(nodeCount, edgeCount);

  if (!canUseWorker) {
    onProgress(0.01, 'start');
    if (args.engine === 'force') {
      return await computeForceLayout({
        nodes: args.nodes,
        edges: args.edges,
        options: args.options,
        onProgress,
        onTick: onTick ?? undefined,
        signal: args.signal,
        yieldToMainThread: true
      });
    }
    return await computeHierarchyLayout({
      nodes: args.nodes,
      edges: args.edges,
      options: args.options,
      onProgress,
      signal: args.signal
    });
  }

  const requestId = makeRequestId();
  const w = getWorker();

  return await new Promise<RelationalLayoutPosition[]>((resolve, reject) => {
    const onAbort = () => {
      const cancel: RelationalLayoutWorkerInMessage = { type: 'cancel', requestId };
      try {
        w.postMessage(cancel);
      } catch {
        // ignore
      }
      cleanup();
      reject(new Error('aborted'));
    };

    const handleMessage = (event: MessageEvent) => {
      const msg = event.data as RelationalLayoutWorkerOutMessage;
      if (!msg || typeof msg !== 'object') return;
      if ((msg as any).requestId !== requestId) return;

      if (msg.type === 'progress') {
        onProgress(msg.pct, msg.stage);
        return;
      }
      if (msg.type === 'tick') {
        if (onTick) onTick(msg.pct, msg.positions);
        return;
      }
      if (msg.type === 'done') {
        cleanup();
        resolve(msg.positions);
        return;
      }
      if (msg.type === 'error') {
        cleanup();
        reject(new Error(msg.message));
      }
    };

    const handleError = () => {
      cleanup();
      reject(new Error('worker_error'));
    };

    function cleanup() {
      w.removeEventListener('message', handleMessage);
      w.removeEventListener('error', handleError as any);
      if (args.signal) args.signal.removeEventListener('abort', onAbort);
    }

    w.addEventListener('message', handleMessage);
    w.addEventListener('error', handleError as any);
    if (args.signal) {
      if (args.signal.aborted) return onAbort();
      args.signal.addEventListener('abort', onAbort, { once: true });
    }

    const start: RelationalLayoutWorkerInMessage = {
      type: 'start',
      requestId,
      engine: args.engine,
      nodes: args.nodes,
      edges: args.edges,
      options: args.options
    };
    w.postMessage(start);
  });
}
