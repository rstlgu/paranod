'use client';

/**
 * Run history di un flow (FlowRun). Usato dall'editor flow (topbar) e dalla
 * pagina Flows (menu card). Mostra le ultime esecuzioni con stato, input,
 * entità prodotte, durata e dettaglio step espandibile.
 */

import {
  CheckCircleIcon as IconCheck,
  CaretDownIcon as IconChevronDown,
  FlaskIcon as IconFlask,
  ClockCounterClockwiseIcon as IconHistory,
  CircleNotchIcon as IconLoader2,
  PlayIcon as IconPlay,
  ArrowsClockwiseIcon as IconRefresh,
  XCircleIcon as IconX
} from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { RecordedStep } from '@/features/flow/lib/flow-run-recorder';
import { cn } from '@/lib/utils';
import { useCallback, useEffect, useState } from 'react';

interface FlowRunRecord {
  id: string;
  kind: 'run' | 'test';
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  inputType: string;
  inputValue: string;
  graphId: string | null;
  steps: RecordedStep[];
  entityCount: number;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function durationSeconds(run: FlowRunRecord) {
  if (!run.completedAt) return null;
  const ms =
    new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
  return (ms / 1000).toFixed(1);
}

function RunStatusBadge({ status }: { status: FlowRunRecord['status'] }) {
  if (status === 'COMPLETED')
    return (
      <Badge
        variant='outline'
        className='gap-1 border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700 dark:border-emerald-900/30 dark:bg-emerald-900/10 dark:text-emerald-400'
      >
        <IconCheck className='h-3 w-3' />
        Completed
      </Badge>
    );
  if (status === 'FAILED')
    return (
      <Badge
        variant='outline'
        className='gap-1 border-red-200 bg-red-50 text-[10px] text-red-700 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-400'
      >
        <IconX className='h-3 w-3' />
        Failed
      </Badge>
    );
  return (
    <Badge variant='outline' className='gap-1 text-[10px]'>
      <IconLoader2 className='h-3 w-3 animate-spin' />
      Running
    </Badge>
  );
}

export function FlowRunsDialog({
  open,
  onOpenChange,
  flowId,
  flowName
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flowId: string;
  flowName?: string;
}) {
  const [runs, setRuns] = useState<FlowRunRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/flows/${flowId}/runs`);
      const data = await res.json().catch(() => null);
      setRuns(res.ok && Array.isArray(data?.runs) ? data.runs : []);
    } catch {
      setRuns([]);
    } finally {
      setIsLoading(false);
    }
  }, [flowId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[560px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <IconHistory className='h-5 w-5' />
            Run history{flowName ? ` — ${flowName}` : ''}
          </DialogTitle>
          <DialogDescription className='flex items-center justify-between'>
            <span>Last {runs.length} executions of this flow.</span>
            <Button
              variant='ghost'
              size='sm'
              className='h-7 gap-1 px-2 text-xs'
              onClick={() => void load()}
              disabled={isLoading}
            >
              <IconRefresh
                className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')}
              />
              Refresh
            </Button>
          </DialogDescription>
        </DialogHeader>

        {isLoading && runs.length === 0 ? (
          <div className='flex items-center justify-center gap-2 py-8'>
            <IconLoader2 className='h-5 w-5 animate-spin' />
            <span className='text-muted-foreground text-sm'>Loading…</span>
          </div>
        ) : runs.length === 0 ? (
          <p className='text-muted-foreground py-8 text-center text-sm'>
            No runs yet. Execute this flow from a graph node or test it in the
            editor.
          </p>
        ) : (
          <ScrollArea className='max-h-[380px]'>
            <div className='space-y-1.5 pr-3'>
              {runs.map((run) => {
                const isOpen = expanded === run.id;
                const dur = durationSeconds(run);
                return (
                  <div key={run.id} className='rounded-lg border'>
                    <button
                      className='hover:bg-muted/50 flex w-full items-center gap-2 rounded-lg p-2.5 text-left'
                      onClick={() => setExpanded(isOpen ? null : run.id)}
                    >
                      {run.kind === 'test' ? (
                        <IconFlask
                          className='text-muted-foreground h-4 w-4 shrink-0'
                          aria-label='Test run'
                        />
                      ) : (
                        <IconPlay
                          className='text-muted-foreground h-4 w-4 shrink-0'
                          aria-label='Graph run'
                        />
                      )}
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center gap-2'>
                          <span
                            className='max-w-[180px] truncate text-sm font-medium'
                            title={run.inputValue}
                          >
                            {run.inputValue}
                          </span>
                          <Badge variant='secondary' className='text-[10px]'>
                            {run.inputType}
                          </Badge>
                        </div>
                        <p className='text-muted-foreground text-xs'>
                          {formatWhen(run.startedAt)}
                          {dur ? ` · ${dur}s` : ''}
                          {run.status === 'COMPLETED'
                            ? ` · ${run.entityCount} entities`
                            : ''}
                        </p>
                      </div>
                      <RunStatusBadge status={run.status} />
                      <IconChevronDown
                        className={cn(
                          'text-muted-foreground h-4 w-4 shrink-0 transition-transform',
                          isOpen && 'rotate-180'
                        )}
                      />
                    </button>
                    {isOpen && (
                      <div className='space-y-1 border-t px-3 py-2'>
                        {run.error && (
                          <p className='text-xs text-red-600 dark:text-red-400'>
                            {run.error}
                          </p>
                        )}
                        {(run.steps ?? []).map((s) => (
                          <div
                            key={s.nodeId}
                            className='flex items-center gap-2 text-xs'
                          >
                            {s.status === 'completed' ? (
                              <IconCheck className='h-3.5 w-3.5 shrink-0 text-emerald-500' />
                            ) : s.status === 'failed' ? (
                              <IconX className='h-3.5 w-3.5 shrink-0 text-red-500' />
                            ) : (
                              <div className='bg-muted h-3 w-3 shrink-0 rounded-full' />
                            )}
                            <span className='min-w-0 flex-1 truncate'>
                              {s.name}
                            </span>
                            <span className='text-muted-foreground shrink-0'>
                              {s.entityCount} ent ·{' '}
                              {(s.durationMs / 1000).toFixed(1)}s
                            </span>
                          </div>
                        ))}
                        {(run.steps ?? []).length === 0 && !run.error && (
                          <p className='text-muted-foreground text-xs'>
                            No step details recorded.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
