'use client';

import React, {
  createContext,
  useCallback,
  useEffect,
  useContext,
  useMemo,
  useRef,
  useState
} from 'react';
import { graphClientCoordinator } from '@/features/graph/lib/graph-client-coordinator';
import { useGraphCoordinator } from '../components/graph-editor/hooks/use-graph-participant';
import { useAgentActivityStore } from '@/features/agent/store/agent-activity-store';
import { projectAgentTransforms } from '../lib/agent-transform-logs';

export type TransformStatus = 'running' | 'completed' | 'failed';

/**
 * Riga della console del grafo. NON è il console del browser: contiene solo
 * eventi relativi alle transform eseguite (start, comunicazioni/progress dai
 * plugin/addon, risultati, errori).
 */
export interface TransformConsoleEntry {
  id: string;
  at: number;
  level: 'log' | 'info' | 'success' | 'warn' | 'error';
  message: string;
}

export interface TransformLog {
  origin?: 'agent';
  id: string;
  pluginName: string;
  transformName: string;
  entityValue: string;
  status: TransformStatus;
  progress?: number;
  message?: string;
  startTime: Date;
  endTime?: Date;
  resultCount?: number;
  error?: string;
  results?: {
    entities: any[];
    edges: any[];
  };
  sourceNodeId?: string;
  sourcePosition?: {
    x: number;
    y: number;
  };
  viewed?: boolean;
  snapshotScope?: number;
}

interface TransformLoggerContextType {
  logs: TransformLog[];
  canApplyLog: (id: string) => boolean;
  addLog: (log: Omit<TransformLog, 'id' | 'startTime'>) => string;
  updateLog: (id: string, updates: Partial<TransformLog>) => void;
  clearLogs: () => void;
  /** Righe della console del grafo (solo eventi transform, non console browser). */
  consoleEntries: TransformConsoleEntry[];
  /** Aggiunge manualmente una riga alla console (es. comunicazione plugin/addon). */
  pushConsole: (level: TransformConsoleEntry['level'], message: string) => void;
  /** Svuota solo la console (non i log/attività). */
  clearConsole: () => void;
  onAddResults?: (
    allEntities: any[],
    allEdges: any[],
    source: { position: { x: number; y: number }; nodeId?: string },
    selectedIds: string[]
  ) => {
    addedNodes: number;
    addedEdges: number;
    reason?: string | null;
  } | void;
  /**
   * Open the results sheet for a specific log.
   * If logId is null, close the sheet.
   */
  openResultsSheet: (logId: string | null) => void;
  /**
   * Currently open log ID for the results sheet.
   */
  activeResultsLogId: string | null;
  /**
   * Suppress auto-open for a period (e.g. after manual close).
   */
  suppressAutoOpen: (ms: number) => void;
  /**
   * Check if auto-open is currently suppressed.
   */
  isAutoOpenSuppressed: () => boolean;
}

const TransformLoggerContext = createContext<TransformLoggerContextType | null>(
  null
);
type TransformLoggerActionsContextType = Pick<
  TransformLoggerContextType,
  'addLog' | 'updateLog'
>;
const TransformLoggerActionsContext =
  createContext<TransformLoggerActionsContextType | null>(null);

function formatConsoleSource(log: TransformLog): string {
  return [log.pluginName, log.transformName].filter(Boolean).join(' · ');
}

export function TransformLoggerProvider({
  children,
  onAddResults,
  graphId
}: {
  children: React.ReactNode;
  graphId?: string;
  onAddResults?: (
    allEntities: any[],
    allEdges: any[],
    source: { position: { x: number; y: number }; nodeId?: string },
    selectedIds: string[]
  ) => {
    addedNodes: number;
    addedEdges: number;
    reason?: string | null;
  } | void;
}) {
  const coordinator = useGraphCoordinator();
  const scope = coordinator.epoch(graphId);
  const jobsRef = useRef(
    new Map<string, ReturnType<typeof graphClientCoordinator.beginManual>>()
  );
  const [logs, setLogs] = useState<TransformLog[]>([]);
  const [consoleEntries, setConsoleEntries] = useState<TransformConsoleEntry[]>(
    []
  );
  const [activeResultsLogId, setActiveResultsLogId] = useState<string | null>(
    null
  );
  const suppressAutoOpenUntilRef = useRef<number>(0);
  // Snapshot per-log per calcolare le transizioni (start → progress → done)
  const logSnapshotRef = useRef<Map<string, TransformLog>>(new Map());
  const logGraphIdRef = useRef(new Map<string, string | undefined>());
  const agentRuns = useAgentActivityStore((state) => state.runs);
  const seenAgentEntries = useRef(new Set<string>());
  const agentSignatures = useRef(new Map<string, string>());
  useEffect(() => {
    if (!graphId) return;
    const added: TransformConsoleEntry[] = [];
    const changed: TransformLog[] = [];
    for (const activity of Object.values(agentRuns)) {
      if (activity.run.graphId !== graphId) continue;
      const projected = projectAgentTransforms(activity);
      for (const entry of projected.entries) {
        if (seenAgentEntries.current.has(entry.id)) continue;
        seenAgentEntries.current.add(entry.id);
        added.push(entry);
      }
      for (const log of projected.logs) {
        const signature = JSON.stringify(log);
        if (agentSignatures.current.get(log.id) === signature) continue;
        agentSignatures.current.set(log.id, signature);
        logSnapshotRef.current.set(log.id, log);
        logGraphIdRef.current.set(log.id, graphId);
        changed.push(log);
      }
    }
    if (added.length)
      setConsoleEntries((previous) =>
        [...previous, ...added].sort((a, b) => a.at - b.at).slice(-500)
      );
    if (changed.length)
      setLogs((previous) => {
        const merged = new Map(previous.map((log) => [log.id, log]));
        changed.forEach((log) => merged.set(log.id, log));
        return Array.from(merged.values()).sort(
          (a, b) => b.startTime.getTime() - a.startTime.getTime()
        );
      });
  }, [agentRuns, graphId]);

  const pushConsole = useCallback(
    (level: TransformConsoleEntry['level'], message: string) => {
      const entry: TransformConsoleEntry = {
        id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        at: Date.now(),
        level,
        message
      };
      setConsoleEntries((prev) => {
        const next = [...prev, entry];
        return next.length > 500 ? next.slice(-500) : next;
      });
    },
    []
  );

  const addLog = useCallback(
    (log: Omit<TransformLog, 'id' | 'startTime'>) => {
      if (coordinator.epoch(graphId) !== scope)
        throw new Error('Risultato appartenente a uno snapshot precedente.');
      const job = coordinator.beginManual(graphId);
      const id = `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      if (log.status === 'running') jobsRef.current.set(id, job);
      else job.finish();
      const newLog: TransformLog = {
        ...log,
        id,
        snapshotScope: scope,
        startTime: new Date()
      };

      logSnapshotRef.current.set(id, newLog);
      logGraphIdRef.current.set(id, graphId);
      setLogs((prev) => [newLog, ...prev]);

      const source = formatConsoleSource(newLog);
      pushConsole(
        'info',
        newLog.entityValue
          ? `▶ ${source} → ${newLog.entityValue}`
          : `▶ ${source}`
      );
      return id;
    },
    [coordinator, graphId, pushConsole, scope]
  );

  const updateLog = useCallback(
    (id: string, updates: Partial<TransformLog>) => {
      if (updates.status && updates.status !== 'running') {
        jobsRef.current.get(id)?.finish();
        jobsRef.current.delete(id);
      }
      const prev = logSnapshotRef.current.get(id);
      if (
        !prev ||
        prev.snapshotScope !== coordinator.epoch(graphId) ||
        coordinator.frozen(graphId)
      )
        return;
      const merged: TransformLog | undefined = prev
        ? { ...prev, ...updates }
        : undefined;
      if (merged) logSnapshotRef.current.set(id, merged);

      // Deriva le righe console solo su eventi significativi
      if (prev && merged) {
        const source = formatConsoleSource(merged);
        const statusChanged =
          updates.status !== undefined && updates.status !== prev.status;

        if (statusChanged && merged.status === 'completed') {
          const n = merged.resultCount ?? 0;
          // Messaggio del plugin/addon (es. result.message) se passato al completamento
          const note =
            updates.message && !/^(starting|queued)/i.test(updates.message)
              ? ` — ${updates.message}`
              : '';
          pushConsole(
            'success',
            `✔ ${source} — ${n} ${n === 1 ? 'result' : 'results'}${note}`
          );
        } else if (statusChanged && merged.status === 'failed') {
          pushConsole('error', `✖ ${source} — ${merged.error ?? 'failed'}`);
        } else if (
          merged.status === 'running' &&
          updates.message &&
          updates.message !== prev.message
        ) {
          // Comunicazione/progress dal plugin o addon in esecuzione
          const pct =
            typeof merged.progress === 'number' && merged.progress > 0
              ? ` (${Math.round(merged.progress)}%)`
              : '';
          pushConsole('log', `· ${source} — ${updates.message}${pct}`);
        }
      }

      setLogs((prev2) =>
        prev2.map((log) => (log.id === id ? { ...log, ...updates } : log))
      );
    },
    [coordinator, graphId, pushConsole]
  );

  const clearLogs = useCallback(() => {
    setLogs([]);
    setConsoleEntries([]);
    logSnapshotRef.current.clear();
    logGraphIdRef.current.clear();
    setActiveResultsLogId(null);
  }, []);

  const clearConsole = useCallback(() => {
    setConsoleEntries([]);
  }, []);

  const canApplyLog = useCallback(
    (id: string) => {
      const log = logSnapshotRef.current.get(id);
      return Boolean(
        log &&
          logGraphIdRef.current.get(id) === graphId &&
          log.origin !== 'agent' &&
          log.snapshotScope === coordinator.epoch(graphId) &&
          !coordinator.frozen(graphId)
      );
    },
    [coordinator, graphId]
  );
  const guardedAddResults = useCallback<
    NonNullable<TransformLoggerContextType['onAddResults']>
  >(
    (...args) => {
      if (coordinator.epoch(graphId) !== scope || coordinator.frozen(graphId))
        return {
          addedNodes: 0,
          addedEdges: 0,
          reason: 'Snapshot non piu valido'
        };
      return onAddResults?.(...args);
    },
    [coordinator, graphId, onAddResults, scope]
  );
  const openResultsSheet = useCallback(
    (logId: string | null) => {
      if (
        logId &&
        (!logSnapshotRef.current.has(logId) ||
          logGraphIdRef.current.get(logId) !== graphId)
      )
        return;
      setActiveResultsLogId(logId);
      if (logId) {
        // Mark as viewed when opening
        setLogs((prev) =>
          prev.map((log) => (log.id === logId ? { ...log, viewed: true } : log))
        );
      }
    },
    [graphId]
  );

  const suppressAutoOpen = useCallback((ms: number) => {
    suppressAutoOpenUntilRef.current = Date.now() + ms;
  }, []);

  const isAutoOpenSuppressed = useCallback(() => {
    return Date.now() < suppressAutoOpenUntilRef.current;
  }, []);
  const actionsValue = useMemo<TransformLoggerActionsContextType>(
    () => ({ addLog, updateLog }),
    [addLog, updateLog]
  );
  const currentGraphLogs = useMemo(
    () => logs.filter((log) => logGraphIdRef.current.get(log.id) === graphId),
    [logs, graphId]
  );
  const value = useMemo<TransformLoggerContextType>(
    () => ({
      logs: currentGraphLogs,
      canApplyLog,
      addLog,
      updateLog,
      clearLogs,
      consoleEntries,
      pushConsole,
      clearConsole,
      onAddResults: guardedAddResults,
      openResultsSheet,
      activeResultsLogId: currentGraphLogs.some(
        (log) => log.id === activeResultsLogId
      )
        ? activeResultsLogId
        : null,
      suppressAutoOpen,
      isAutoOpenSuppressed
    }),
    [
      activeResultsLogId,
      addLog,
      clearConsole,
      clearLogs,
      consoleEntries,
      isAutoOpenSuppressed,
      currentGraphLogs,
      canApplyLog,
      guardedAddResults,
      openResultsSheet,
      pushConsole,
      suppressAutoOpen,
      updateLog
    ]
  );

  return (
    <TransformLoggerActionsContext.Provider value={actionsValue}>
      <TransformLoggerContext.Provider value={value}>
        {children}
      </TransformLoggerContext.Provider>
    </TransformLoggerActionsContext.Provider>
  );
}

export function useTransformLogger() {
  const context = useContext(TransformLoggerContext);
  if (!context) {
    throw new Error(
      'useTransformLogger must be used within TransformLoggerProvider'
    );
  }
  return context;
}

export function useTransformLoggerActions() {
  const context = useContext(TransformLoggerActionsContext);
  if (!context) {
    throw new Error(
      'useTransformLoggerActions must be used within TransformLoggerProvider'
    );
  }
  return context;
}
