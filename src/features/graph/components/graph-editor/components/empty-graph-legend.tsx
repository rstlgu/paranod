'use client';

import { CommandIcon as IconCommand } from '@/components/icons';
import { cn } from '@/lib/utils';

interface EmptyGraphLegendProps {
  className?: string;
  onToggleSidebar: () => void;
  onToggleDetailsPanel: () => void;
  onToggleConsole: () => void;
  onOpenCommandPalette: () => void;
}

function Keycap(props: { children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center rounded-md border border-border/60 bg-background px-2 py-1',
        'text-[11px] font-semibold tracking-wide text-foreground/70'
      )}
    >
      {props.children}
    </kbd>
  );
}

function ShortcutRow(props: {
  label: string;
  keys: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      onClick={props.onClick}
      className={cn(
        'pointer-events-auto w-full',
        'flex items-center justify-between gap-6 rounded-lg px-1 py-2 text-left',
        'transition-colors hover:bg-accent/40 active:bg-accent/55'
      )}
    >
      <div className='text-sm text-muted-foreground'>{props.label}</div>
      <div className='flex items-center gap-1.5'>{props.keys}</div>
    </button>
  );
}

export function EmptyGraphLegend(props: EmptyGraphLegendProps) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6',
        props.className
      )}
    >
      <div
        className={cn(
          'pointer-events-auto w-full max-w-[520px] rounded-xl bg-transparent p-3'
        )}
      >
        <div className='flex items-center justify-center pb-6'>
          <IconCommand className='h-24 w-24 text-muted-foreground/35' />
        </div>

        <div className='space-y-1'>
          <ShortcutRow
            label='Toggle Nodes List'
            keys={
              <>
                <Keycap>Ctrl</Keycap>+<Keycap>B</Keycap>
              </>
            }
            onClick={props.onToggleSidebar}
          />
          <ShortcutRow
            label='Toggle Analysis Panel'
            keys={
              <>
                <Keycap>Ctrl</Keycap>+<Keycap>L</Keycap>
              </>
            }
            onClick={props.onToggleDetailsPanel}
          />
          <ShortcutRow
            label='Toggle Console'
            keys={
              <>
                <Keycap>Ctrl</Keycap>+<Keycap>D</Keycap>
              </>
            }
            onClick={props.onToggleConsole}
          />
          <ShortcutRow
            label='Open Command Palette'
            keys={
              <>
                <Keycap>Ctrl</Keycap>+<Keycap>J</Keycap>
              </>
            }
            onClick={props.onOpenCommandPalette}
          />
        </div>

        <div className='pt-3 text-center text-xs text-muted-foreground/70'>
          Add a node to start investigating
        </div>
      </div>
    </div>
  );
}
