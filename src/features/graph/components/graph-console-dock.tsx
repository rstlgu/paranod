'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { IconCircleX, IconFilter, IconTerminal2 } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  useTransformLogger,
  type TransformConsoleEntry
} from '../contexts/transform-logger-context';

function getEntryColor(level: TransformConsoleEntry['level'], isDark: boolean) {
  if (isDark) {
    if (level === 'error') return 'text-red-300';
    if (level === 'warn') return 'text-amber-300';
    if (level === 'success') return 'text-emerald-300';
    if (level === 'info') return 'text-sky-300';
    return 'text-zinc-200';
  }
  if (level === 'error') return 'text-red-700';
  if (level === 'warn') return 'text-amber-700';
  if (level === 'success') return 'text-emerald-700';
  if (level === 'info') return 'text-sky-700';
  return 'text-zinc-800';
}

interface GraphConsoleDockProps {
  /** @deprecated non più usato: la console mostra solo eventi transform. */
  captureConsole?: boolean;
  /** Se definito, controlla lo stato espanso (header-only vs lista). */
  isExpanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
  /** Default: true. Se false, non renderizza l'header (utile se l'header è gestito da una tabbar esterna). */
  showHeader?: boolean;
  /** Default: true. Se false, non renderizza il pulsante Clear interno. */
  showClearButton?: boolean;
  /** Incrementa questo contatore per forzare il clear dall'esterno. */
  clearSignal?: number;
  /** Default: true. Se false, nasconde l'input di filtro (e resetta il filtro). */
  showFilterInput?: boolean;
  className?: string;
}

/**
 * Console del grafo. Mostra SOLO gli eventi relativi alle transform eseguite
 * (start, comunicazioni/progress dai plugin/addon, risultati, errori) letti dal
 * TransformLoggerContext. Non riflette la console del browser/devtools.
 */
export function GraphConsoleDock({
  isExpanded: isExpandedProp,
  onExpandedChange,
  showHeader = true,
  showClearButton = true,
  clearSignal,
  showFilterInput = true,
  className
}: GraphConsoleDockProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const { consoleEntries, clearConsole } = useTransformLogger();

  const [isExpandedState, setIsExpandedState] = useState(true);
  const isExpanded = isExpandedProp ?? isExpandedState;
  function setIsExpanded(next: boolean) {
    if (onExpandedChange) onExpandedChange(next);
    else setIsExpandedState(next);
  }
  const [filter, setFilter] = useState('');
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const scrollAreaRootRef = useRef<HTMLDivElement | null>(null);
  const hasAutoScrollRef = useRef(true);

  function getScrollViewportEl() {
    const root = scrollAreaRootRef.current;
    if (!root) return null;
    return root.querySelector(
      '[data-slot="scroll-area-viewport"]'
    ) as HTMLDivElement | null;
  }

  const filteredEntries = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return consoleEntries;
    return consoleEntries.filter((e) => e.message.toLowerCase().includes(q));
  }, [consoleEntries, filter]);

  const lastClearSignalRef = useRef<number | undefined>(clearSignal);
  useEffect(() => {
    if (clearSignal === undefined) return;
    if (lastClearSignalRef.current === clearSignal) return;
    lastClearSignalRef.current = clearSignal;
    clearConsole();
  }, [clearSignal, clearConsole]);

  useEffect(() => {
    if (showFilterInput) return;
    if (filter) setFilter('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFilterInput]);

  useEffect(() => {
    if (!showFilterInput) return;
    if (!isExpanded) return;
    filterInputRef.current?.focus();
  }, [isExpanded, showFilterInput]);

  useEffect(() => {
    if (!isExpanded) return;
    if (!hasAutoScrollRef.current) return;
    const el = getScrollViewportEl();
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [filteredEntries.length, isExpanded]);

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col overflow-hidden',
        'border-t border-border/40',
        'bg-background text-foreground',
        className
      )}
    >
      {showHeader && (
        <button
          type='button'
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            'flex h-10 w-full items-center gap-2 px-3 text-left',
            'cursor-pointer select-none hover:bg-accent/20'
          )}
          title={isExpanded ? 'Collapse console' : 'Expand console'}
        >
          <div className='flex min-w-0 flex-1 items-center gap-2'>
            <IconTerminal2
              className={cn(
                'h-4 w-4',
                isDark ? 'text-zinc-300' : 'text-zinc-600'
              )}
            />
            <span className='text-xs font-semibold tracking-wide'>Console</span>
            <span
              className={cn(
                'text-[11px]',
                isDark ? 'text-zinc-400' : 'text-muted-foreground'
              )}
            >
              {consoleEntries.length} events
            </span>
          </div>
        </button>
      )}

      {isExpanded && (
        <>
          <div className='flex items-center gap-2 px-3 pb-2'>
            {showFilterInput ? (
              <div className={cn('relative', showHeader ? 'flex-1' : 'w-[220px]')}>
                <IconFilter
                  className={cn(
                    'pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2',
                    isDark ? 'text-zinc-500' : 'text-muted-foreground'
                  )}
                />
                <Input
                  ref={filterInputRef}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder='Filter events…'
                  className={cn(
                    'h-8 pl-8 text-xs',
                    isDark
                      ? 'border-white/10 bg-zinc-900/60 text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-white/20'
                      : 'bg-background placeholder:text-muted-foreground focus-visible:ring-ring/30',
                    'focus-visible:ring-1'
                  )}
                />
              </div>
            ) : (
              <div className='flex-1' />
            )}
          </div>

          <div className='relative min-h-0 flex-1'>
            {showClearButton && (
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className={cn(
                  'absolute right-3 top-1 z-10 h-8 w-8',
                  isDark
                    ? 'text-zinc-200 hover:bg-white/5 hover:text-white'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  clearConsole();
                }}
                title='Clear console'
              >
                <IconCircleX className='h-4 w-4' />
              </Button>
            )}

            <ScrollArea
              ref={(el) => {
                scrollAreaRootRef.current = el;
              }}
              className='h-full px-3 pb-3 pt-2'
            >
              <div>
                {filteredEntries.length === 0 ? (
                  <div
                    className={cn(
                      'py-6 text-center text-xs',
                      isDark ? 'text-zinc-500' : 'text-muted-foreground'
                    )}
                  >
                    No transform activity yet.
                  </div>
                ) : (
                  filteredEntries.map((e) => (
                    <div
                      key={e.id}
                      className={cn(
                        'whitespace-pre-wrap break-words px-1 py-px',
                        'font-mono text-[11px] leading-5',
                        getEntryColor(e.level, isDark)
                      )}
                    >
                      {e.message}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </>
      )}
    </div>
  );
}
