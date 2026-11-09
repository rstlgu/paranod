'use client';

import * as React from 'react';
import { useTransformLogger } from '@/features/graph/contexts/transform-logger-context';
import { toast } from 'sonner';
import { TransformResultsSheet } from '@/features/graph/components/transform-results-sheet';

interface TransformResultsAutoSheetProps {
  /**
   * Returns how/if this entity can be applied:
   * - `add_node`: the node is not in graph and can be added
   * - `add_edge`: the node exists in graph but we can add the edge from source
   * - `blocked`: nothing to do (already connected or invalid)
   */
  getEntityAddability: (
    entityId: string,
    signature: string,
    sourceNodeId?: string | null
  ) => 'add_node' | 'add_edge' | 'blocked';
}

/**
 * Centralized transform results sheet.
 * This is the ONLY sheet that should be rendered for transform results.
 * It handles:
 * - Auto-opening when a transform completes with many results
 * - Manual opening via openResultsSheet from context (e.g. from timeline click)
 * - Proper duplicate detection using checkNodeExists callback
 */
export function TransformResultsAutoSheet({
  getEntityAddability
}: TransformResultsAutoSheetProps) {
  const {
    logs,
    canApplyLog,
    onAddResults,
    openResultsSheet,
    activeResultsLogId,
    suppressAutoOpen,
    isAutoOpenSuppressed
  } = useTransformLogger();

  // Get the active log (if any)
  const activeLog = React.useMemo(() => {
    if (!activeResultsLogId) return null;
    return logs.find((l) => l.id === activeResultsLogId) ?? null;
  }, [logs, activeResultsLogId]);

  // Keep the last valid log for rendering during close animation
  const lastValidLogRef = React.useRef<typeof activeLog>(null);
  React.useEffect(() => {
    if (activeLog) {
      lastValidLogRef.current = activeLog;
    }
  }, [activeLog]);

  // Use the current log if open, or the last valid log during close animation
  const displayLog = activeLog ?? lastValidLogRef.current;

  // Auto-open when a transform completes with many results (and not suppressed)
  React.useEffect(() => {
    // Skip if already showing a sheet
    if (activeResultsLogId) return;
    // Skip if auto-open is suppressed
    if (isAutoOpenSuppressed()) return;

    // Find first unviewed completed log with many results
    const next = logs.find((log) => {
      const entitiesLen = log.results?.entities?.length ?? 0;
      return (
        log.status === 'completed' &&
        canApplyLog(log.id) &&
        entitiesLen > 3 &&
        log.viewed !== true
      );
    });

    if (!next) return;

    // Open the sheet for this log
    openResultsSheet(next.id);
  }, [
    logs,
    activeResultsLogId,
    canApplyLog,
    isAutoOpenSuppressed,
    openResultsSheet
  ]);

  const handleConfirm = React.useCallback(
    (selectedIds: string[]) => {
      if (!activeLog || !onAddResults || !canApplyLog(activeLog.id)) {
        return;
      }

      const logSnapshot = activeLog;
      const entities = logSnapshot.results?.entities ?? [];
      const edges = logSnapshot.results?.edges ?? [];
      const position = logSnapshot.sourcePosition ?? { x: 0, y: 0 };

      // Close sheet and suppress auto-open
      suppressAutoOpen(1500);
      openResultsSheet(null);

      // Add results (addResultsToGraph will do final duplicate check)
      try {
        const out = onAddResults(
          entities,
          edges,
          { position, nodeId: logSnapshot.sourceNodeId },
          selectedIds
        );

        const addedNodes = Number((out as any)?.addedNodes ?? 0);
        const addedEdges = Number((out as any)?.addedEdges ?? 0);
        const reason = String((out as any)?.reason ?? '').trim();

        if (addedNodes > 0 || addedEdges > 0) {
          toast.success(
            `Added ${addedNodes} node${addedNodes === 1 ? '' : 's'} and ${addedEdges} link${
              addedEdges === 1 ? '' : 's'
            }.`
          );
        } else {
          toast.info(`Nothing was added${reason ? `: ${reason}` : '.'}`);
        }
      } catch (err) {
        console.error('Error adding transform results:', err);
        toast.error('Failed to add results to the graph.');
      }
    },
    [activeLog, canApplyLog, onAddResults, openResultsSheet, suppressAutoOpen]
  );

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) {
        suppressAutoOpen(1500);
        openResultsSheet(null);
      }
    },
    [openResultsSheet, suppressAutoOpen]
  );

  // Don't render if we have no log to display at all
  if (!displayLog) return null;
  const entities = displayLog.results?.entities ?? [];
  if (entities.length === 0) return null;

  // Browsing an existing result does not require permission to apply it.
  const isOpen = Boolean(activeLog);

  return (
    <TransformResultsSheet
      open={isOpen}
      readOnly={!activeLog || !onAddResults || !canApplyLog(activeLog.id)}
      onOpenChange={handleOpenChange}
      entities={entities}
      transformName={displayLog.transformName}
      sourceNodeId={displayLog.sourceNodeId ?? null}
      onConfirm={handleConfirm}
      getEntityAddability={getEntityAddability}
    />
  );
}
