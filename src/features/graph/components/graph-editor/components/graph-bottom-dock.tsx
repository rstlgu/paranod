'use client';

import * as React from 'react';
import {
  TerminalIcon as IconTerminal,
  BroomIcon as IconBroom,
  MagnifyingGlassIcon as IconSearch,
  SquareSplitHorizontalIcon as IconSplitSquare
} from '@/components/icons';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTransformLogger } from '../../../contexts/transform-logger-context';
import { TransformActivityDock } from '../../transform-logger';
import { GraphConsoleDock } from '../../graph-console-dock';

interface GraphBottomDockProps {
  isReadOnly?: boolean;
  isActive: boolean;
  bottomDockTab: 'console' | 'activity';
  onBottomDockTabClick: (tab: 'console' | 'activity') => void;
  isBottomDockExpanded: boolean;
  setIsBottomDockExpanded: (next: boolean) => void;
  consoleClearSignal: number;
  requestConsoleClear: () => void;
}

const SESSION_KEY_BOTTOM_DOCK_SPLIT_LOGGERS = 'paranod:graph-bottom-dock:split-loggers';

export function GraphBottomDock(props: GraphBottomDockProps) {
  const { logs, clearLogs } = useTransformLogger();
  const latest = logs[0];
  const hasActivity = logs.length > 0;
  const [isSplitLoggers, setIsSplitLoggers] = React.useState(false);
  const [isConsoleFilterOpen, setIsConsoleFilterOpen] = React.useState(false);

  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY_BOTTOM_DOCK_SPLIT_LOGGERS);
      if (raw === null) return;
      setIsSplitLoggers(raw === '1');
    } catch {
      // ignore
    }
  }, []);

  // If there are no logs, force Console tab
  React.useEffect(() => {
    if (!hasActivity && props.bottomDockTab === 'activity')
      props.onBottomDockTabClick('console');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActivity]);

  const isSplitActive = props.isBottomDockExpanded && hasActivity && isSplitLoggers;
  const isSplitHeader = hasActivity && isSplitLoggers;
  const showConsoleHeaderTools = isSplitHeader && props.isBottomDockExpanded;
  const showConsoleToolsWhenNotSplit =
    !isSplitHeader && props.isBottomDockExpanded && props.bottomDockTab === 'console';

  React.useEffect(() => {
    if (props.isBottomDockExpanded) return;
    setIsConsoleFilterOpen(false);
  }, [props.isBottomDockExpanded]);

  const activityStatus =
    latest?.status === 'completed'
      ? 'success'
      : latest?.status === 'failed'
        ? 'error'
        : latest?.status === 'running'
          ? 'running'
          : null;

  const handleHeaderClick = () => {
    props.setIsBottomDockExpanded(!props.isBottomDockExpanded);
  };

  const handleClearActive = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (props.bottomDockTab === 'console') {
      props.requestConsoleClear();
      return;
    }
    clearLogs();
  };

  const handleClearConsole = (e: React.MouseEvent) => {
    e.stopPropagation();
    props.requestConsoleClear();
  };

  const handleClearActivity = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearLogs();
  };

  const toggleSplitLoggers = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsSplitLoggers((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(SESSION_KEY_BOTTOM_DOCK_SPLIT_LOGGERS, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  return (
    <div
      className={cn(
        'h-full overflow-hidden border-t border-border/25 bg-background dark:border-white/8'
      )}
    >
      {/* Header / Tabbar - clickable anywhere */}
      <div
        className={cn(
          isSplitHeader
            ? 'grid grid-cols-2 divide-x divide-border/25 dark:divide-white/8'
            : 'flex gap-1',
          'h-8 items-center px-2 select-none',
          props.isBottomDockExpanded && 'border-b border-border/25 dark:border-white/8',
          'cursor-pointer hover:bg-accent/10'
        )}
        onClick={handleHeaderClick}
        role='button'
        aria-expanded={props.isBottomDockExpanded}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleHeaderClick();
          }
        }}
      >
        <div className={cn('min-w-0 flex items-center gap-1', isSplitHeader && 'justify-start')}>
          <button
            type='button'
            onClick={(e) => {
              e.stopPropagation();
              props.onBottomDockTabClick('console');
            }}
            className={cn(
              'inline-flex h-7 items-center gap-2 rounded-md px-2 text-[11px] font-semibold',
              isSplitHeader || props.bottomDockTab === 'console'
                ? 'bg-accent/60 text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent/25 hover:text-foreground'
            )}
          >
            <IconTerminal className='h-4 w-4' />
            Console (Cmd+D)
          </button>

          {showConsoleHeaderTools && (
            <>
              <div className='flex-1' />
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className={cn(
                  "size-7 [&_svg:not([class*='size-'])]:!size-4",
                  isConsoleFilterOpen ? 'bg-accent/40 text-foreground' : ''
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsConsoleFilterOpen((v) => !v);
                }}
                title={isConsoleFilterOpen ? 'Hide filter' : 'Search logs'}
              >
                <IconSearch className='h-4 w-4' />
              </Button>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className="size-7 [&_svg:not([class*='size-'])]:!size-4"
                onClick={handleClearConsole}
                title='Clear console'
              >
                <IconBroom className='h-4 w-4' />
              </Button>
            </>
          )}
        </div>

        {hasActivity && (
          <div className={cn('min-w-0 flex items-center gap-1', isSplitHeader && 'justify-start pl-2')}>
            <button
              type='button'
              onClick={(e) => {
                e.stopPropagation();
                props.onBottomDockTabClick('activity');
              }}
              className={cn(
                'inline-flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-left text-[11px] font-semibold',
                isSplitHeader || props.bottomDockTab === 'activity'
                  ? 'bg-accent/60 text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-accent/25 hover:text-foreground'
              )}
            >
              {/* Status dot instead of icon */}
              <span className='relative inline-flex h-2 w-2 shrink-0'>
                <span
                  className={cn(
                    'absolute inline-flex h-full w-full rounded-full opacity-50',
                    activityStatus === 'success'
                      ? 'bg-emerald-500 animate-ping'
                      : activityStatus === 'error'
                        ? 'bg-red-500 animate-ping'
                        : 'bg-sky-400 animate-pulse'
                  )}
                />
                <span
                  className={cn(
                    'relative inline-flex h-2 w-2 rounded-full',
                    activityStatus === 'success'
                      ? 'bg-emerald-500'
                      : activityStatus === 'error'
                        ? 'bg-red-500'
                        : 'bg-sky-400'
                  )}
                />
              </span>

              <span className='min-w-0 flex-1 truncate'>
                {latest?.transformName || 'Activity'}
              </span>
            </button>

            {isSplitHeader ? (
              <>
                <div className='flex-1' />
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className={cn(
                    "size-7 [&_svg:not([class*='size-'])]:!size-4",
                    isSplitLoggers ? 'bg-accent/40 text-foreground' : ''
                  )}
                  onClick={toggleSplitLoggers}
                  title={isSplitLoggers ? 'Single logger view' : 'Split loggers'}
                >
                  <IconSplitSquare className='h-4 w-4' />
                </Button>
                {props.isBottomDockExpanded ? (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className="size-7 [&_svg:not([class*='size-'])]:!size-4"
                    onClick={handleClearActivity}
                    title='Clear activity'
                  >
                    <IconBroom className='h-4 w-4' />
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        )}

        {!isSplitHeader && (
          <>
            <div className='flex-1' />

            {showConsoleToolsWhenNotSplit ? (
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className={cn(
                  "size-7 [&_svg:not([class*='size-'])]:!size-4",
                  isConsoleFilterOpen ? 'bg-accent/40 text-foreground' : ''
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsConsoleFilterOpen((v) => !v);
                }}
                title={isConsoleFilterOpen ? 'Hide filter' : 'Search logs'}
              >
                <IconSearch className='h-4 w-4' />
              </Button>
            ) : null}

            <Button
              type='button'
              variant='ghost'
              size='icon'
              className={cn(
                "size-7 [&_svg:not([class*='size-'])]:!size-4",
                isSplitLoggers && hasActivity ? 'bg-accent/40 text-foreground' : ''
              )}
              onClick={toggleSplitLoggers}
              disabled={!hasActivity}
              title={isSplitLoggers ? 'Single logger view' : 'Split loggers'}
            >
              <IconSplitSquare className='h-4 w-4' />
            </Button>

            {/* Unified Clear (only when expanded) */}
            {props.isBottomDockExpanded && (
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className="size-7 [&_svg:not([class*='size-'])]:!size-4"
                onClick={handleClearActive}
                title='Clear'
              >
                <IconBroom className='h-4 w-4' />
              </Button>
            )}
          </>
        )}
      </div>

      {/* Keep mounted (no state loss) - fade when collapsed */}
      <div
        className={cn(
          'min-h-0 h-[calc(100%-2rem)] overflow-hidden transition-opacity duration-200 ease-in-out',
          props.isBottomDockExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        aria-hidden={!props.isBottomDockExpanded}
      >
        <div
          className={cn(
            'h-full',
            isSplitActive && 'grid grid-cols-2 divide-x divide-border/25 dark:divide-white/8'
          )}
        >
          <div
            className={cn(
              'min-h-0 h-full overflow-hidden',
              !isSplitActive && props.bottomDockTab !== 'console' && 'hidden'
            )}
          >
            <GraphConsoleDock
              captureConsole={props.isActive}
              showHeader={false}
              showClearButton={false}
              showFilterInput={isConsoleFilterOpen}
              clearSignal={props.consoleClearSignal}
              isExpanded
              className='border-t-0'
            />
          </div>
          <div
            className={cn(
              'min-h-0 h-full overflow-hidden',
              !isSplitActive && props.bottomDockTab !== 'activity' && 'hidden'
            )}
          >
            <TransformActivityDock className='h-full' showClearButton={false} />
          </div>
        </div>
      </div>
    </div>
  );
}
