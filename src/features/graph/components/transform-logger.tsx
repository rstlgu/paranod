'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  IconChevronUp,
  IconChevronDown,
  IconLoader2
} from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useTransformLogger } from '../contexts/transform-logger-context';
import { CircularProgress } from './circular-progress';

interface TransformLoggerProps {
  /** Default: 'fixed' (comportamento attuale). */
  placement?: 'fixed' | 'absolute';
  /** Offset in px dal bottom, utile per coesistere con dock inferiori. */
  bottomOffsetPx?: number;
  className?: string;
}

interface TransformActivityDockProps {
  className?: string;
  /** Default: true. Se false, non renderizza il pulsante Clear interno. */
  showClearButton?: boolean;
}

export function TransformActivityDock({
  className,
  showClearButton = true
}: TransformActivityDockProps) {
  const { logs, clearLogs, openResultsSheet } = useTransformLogger();

  const handleLogClick = (log: any) => {
    if (
      log.results &&
      log.results.entities &&
      log.results.entities.length > 0
    ) {
      // Open the centralized results sheet for this log
      openResultsSheet(log.id);
    }
  };

  return (
    <div className={cn('relative h-full w-full', className)}>
      {showClearButton && (
        <div className='absolute right-2 top-2 z-10'>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-7 px-2 text-xs'
            onClick={clearLogs}
            disabled={logs.length === 0}
          >
            Clear
          </Button>
        </div>
      )}

      <ScrollArea className='h-full'>
        <div className='relative px-3 py-3'>
          <div className='absolute top-[16px] bottom-0 left-[16px] w-[2px] bg-border/30 dark:bg-white/10' />

          <div className='space-y-0'>
            {logs.length === 0 && (
              <p className='px-3 py-8 text-center text-xs text-muted-foreground'>
                No transforms executed
              </p>
            )}

            {logs.map((log, index) => (
              <TimelineItem
                key={log.id}
                log={log}
                isLast={index === logs.length - 1}
                onResultClick={handleLogClick}
              />
            ))}
          </div>
        </div>
      </ScrollArea>

      {/* Results sheet is now managed centrally by TransformResultsAutoSheet */}
    </div>
  );
}

export function TransformLogger({
  placement = 'fixed',
  bottomOffsetPx = 0,
  className
}: TransformLoggerProps) {
  const { logs, clearLogs, openResultsSheet } = useTransformLogger();
  const [isExpanded, setIsExpanded] = useState(false);

  const latestLog = logs[0];
  const runningLogs = logs.filter((log) => log.status === 'running');

  const handleLogClick = (log: any) => {
    if (
      log.results &&
      log.results.entities &&
      log.results.entities.length > 0
    ) {
      // Open the centralized results sheet for this log
      openResultsSheet(log.id);
    }
  };

  const shouldScroll = logs.length >= 4;
  const dynamicHeight = shouldScroll
    ? '340px'
    : `${Math.min(logs.length * 85, 340)}px`;

  if (!latestLog) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      // Sempre "attaccato" al bottom e leggermente fuori dal viewport (effetto linguetta)
      animate={{ opacity: 1, y: isExpanded ? 4 : 6 }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      className={cn(
        placement === 'fixed' ? 'fixed' : 'absolute',
        'left-1/2 z-50 -translate-x-1/2',
        className
      )}
      style={{ bottom: bottomOffsetPx }}
    >
      <motion.div
        layout
        animate={{
          width: isExpanded ? '560px' : '360px'
        }}
        transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
        className={cn(
          'select-none overflow-hidden bg-background shadow-xl backdrop-blur-xl',
          'border-border/30 dark:border-white/10',
          // "card che spunta": radius solo sopra (più piccolo), nessun radius sotto, border aperto sotto
          'rounded-t-lg rounded-b-none border border-b-0'
        )}
      >
        {/* Tab-like header (always visible) */}
        <div
          className={cn(
            // header più alto + contenuto spinto verso l'alto
            'relative flex h-14 cursor-pointer items-center gap-3 px-4 py-2 transition-colors',
            'hover:bg-muted/20'
          )}
          onClick={() => setIsExpanded((v) => !v)}
        >
          {/* top indicator (like active tab) */}
          {runningLogs.length > 0 && (
            <span className='absolute inset-x-0 top-0 h-[2px] bg-primary' />
          )}

          {!isExpanded && (
            <div className='flex h-5 w-5 shrink-0 items-center justify-center'>
              {latestLog.status === 'running' && latestLog.progress !== undefined ? (
                <CircularProgress
                  progress={latestLog.progress}
                  size={18}
                  strokeWidth={2}
                  showPercentage={false}
                />
              ) : latestLog.status === 'running' ? (
                <IconLoader2 className='h-4 w-4 animate-spin text-primary' />
              ) : latestLog.status === 'completed' ? (
                <div className='h-2 w-2 rounded-full bg-emerald-500' />
              ) : (
                <div className='h-2 w-2 rounded-full bg-red-500' />
              )}
            </div>
          )}

          <div
            className={cn(
              'min-w-0 flex-1',
              // In modalità compressa alziamo leggermente il gruppo testo
              !isExpanded && '-translate-y-0.5'
            )}
          >
            <p className='truncate text-sm font-medium text-foreground'>
              {isExpanded ? 'Transform Activity' : latestLog.transformName}
            </p>
            <p className='truncate text-xs text-muted-foreground'>
              {latestLog.status === 'running' && latestLog.message
                ? latestLog.message
                : latestLog.status === 'completed'
                  ? `${latestLog.resultCount || 0} ${latestLog.resultCount === 1 ? 'result' : 'results'}`
                  : latestLog.error || 'Failed'}
            </p>
          </div>

          {isExpanded && logs.length > 0 && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='h-7 px-2 text-xs'
              onClick={(e) => {
                e.stopPropagation();
                clearLogs();
              }}
            >
              Clear
            </Button>
          )}

          {isExpanded ? (
            <IconChevronDown className='h-4 w-4 shrink-0 text-muted-foreground' />
          ) : (
            <IconChevronUp className='h-4 w-4 shrink-0 text-muted-foreground' />
          )}
        </div>

        {/* Expanded content */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key='transform-logger-expanded'
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className='overflow-hidden'
            >
              <div className='border-t border-border/30 dark:border-white/10' />

              <ScrollArea
                className={shouldScroll ? 'h-[340px]' : undefined}
                style={!shouldScroll ? { height: dynamicHeight } : undefined}
              >
                <div className='relative px-3 py-3'>
                  <div className='absolute top-[16px] bottom-0 left-[16px] w-[2px] bg-border/30 dark:bg-white/10' />

                  <div className='space-y-0'>
                    {logs.map((log, index) => (
                      <TimelineItem
                        key={log.id}
                        log={log}
                        isLast={index === logs.length - 1}
                        onResultClick={handleLogClick}
                      />
                    ))}
                  </div>
                </div>
              </ScrollArea>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Results sheet is now managed centrally by TransformResultsAutoSheet */}
    </motion.div>
  );
}

function TimelineItem({
  log,
  isLast,
  onResultClick
}: {
  log: any;
  isLast: boolean;
  onResultClick: (log: any) => void;
}) {
  const isRunning = log.status === 'running';
  const isCompleted = log.status === 'completed';
  const isFailed = log.status === 'failed';

  let duration: number | null = null;
  if (log.endTime && log.startTime) {
    try {
      const start =
        log.startTime instanceof Date ? log.startTime : new Date(log.startTime);
      const end =
        log.endTime instanceof Date ? log.endTime : new Date(log.endTime);
      const diffMs = end.getTime() - start.getTime();
      duration = Math.max(0, Math.round(diffMs / 1000));
    } catch (e) {
      console.error('Error calculating duration:', e);
    }
  }

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  };

  return (
    <div className='relative flex gap-3 pb-5'>
      {/* Timeline dot */}
      <div className='relative z-10 flex h-4 w-4 shrink-0 items-center justify-center pt-0.5'>
        {isRunning && log.progress !== undefined ? (
          <div className='rounded-full bg-background'>
            <CircularProgress
              progress={log.progress}
              size={16}
              strokeWidth={2}
              showPercentage={false}
            />
          </div>
        ) : isRunning ? (
          <div className='h-2.5 w-2.5 animate-pulse rounded-full bg-blue-500' />
        ) : isCompleted ? (
          <div className='h-2.5 w-2.5 rounded-full bg-emerald-500' />
        ) : (
          <div className='h-2.5 w-2.5 rounded-full bg-red-500' />
        )}
      </div>

      {/* Content */}
      <div className='min-w-0 flex-1'>
        <div className='flex items-center justify-between gap-3'>
          <p className='text-sm font-semibold text-foreground'>
            {log.transformName}
          </p>
          {duration !== null && duration > 0 && (
            <span className='shrink-0 text-[11px] font-medium text-muted-foreground'>
              {formatDuration(duration)}
            </span>
          )}
        </div>

        <p className='mt-0.5 text-[11px] text-muted-foreground'>
          {log.pluginName} • {log.entityValue}
        </p>

        {isRunning && log.message && (
          <p className='mt-1.5 text-xs font-medium text-primary'>
            {log.message}
          </p>
        )}

        {isCompleted && log.resultCount !== undefined && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onResultClick(log);
            }}
            disabled={!log.results || log.resultCount === 0}
            className={`mt-1.5 text-left text-xs font-medium transition-colors ${
              log.resultCount === 0
                ? 'text-muted-foreground'
                : log.viewed
                  ? 'cursor-pointer text-muted-foreground hover:text-foreground'
                  : 'cursor-pointer text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300'
            }`}
          >
            {log.resultCount === 0
              ? 'No results'
              : `${log.resultCount} ${log.resultCount === 1 ? 'result' : 'results'}`}
          </button>
        )}

        {isFailed && log.error && (
          <p className='mt-1.5 text-xs font-medium text-destructive'>
            {log.error}
          </p>
        )}
      </div>
    </div>
  );
}
