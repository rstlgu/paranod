'use client';

import { Button } from '@/components/ui/button';
import { useGraphPanelTogglesStore } from '@/features/graph/store/graph-panel-toggles-store';
import { WorkspaceTabs } from '@/features/workspace/components/workspace-tabs';
import { cn } from '@/lib/utils';
import { usePathname } from 'next/navigation';
import { Breadcrumbs } from '../breadcrumbs';
import { Separator } from '../ui/separator';
import { ModeToggle } from './ThemeToggle/theme-toggle';

import {
  SidebarSimpleIcon as IconSidebar,
  TerminalWindowIcon as IconTerminal
} from '@/components/icons';

export default function Header() {
  const pathname = usePathname();
  const isWorkspace = pathname === '/';
  const panelControls = useGraphPanelTogglesStore((s) => s.controls);

  return (
    <header
      className={cn(
        'bg-background relative flex h-9 shrink-0 items-center justify-between gap-2 transition-[width,height] ease-linear',
        'group-has-data-[collapsible=icon]/sidebar-wrapper:h-9',
        'after:bg-border/30 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px dark:after:bg-white/10'
      )}
    >
      <div
        className={cn(
          'flex min-w-0 flex-1 gap-2',
          isWorkspace ? 'h-full items-stretch' : 'items-center'
        )}
      >
        {isWorkspace ? (
          <div className='flex h-full min-w-0 flex-1 items-stretch'>
            <WorkspaceTabs />
          </div>
        ) : (
          <div className='flex min-w-0 flex-1 items-center gap-2 px-3'>
            <Separator orientation='vertical' className='mr-1 h-4' />
            <Breadcrumbs />
          </div>
        )}
      </div>

      <div className='flex items-center gap-2 px-3'>
        {panelControls ? (
          <div className='flex items-center gap-0.5'>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className={cn(
                "size-7 [&_svg:not([class*='size-'])]:!size-4",
                panelControls.isSidebarOpen &&
                  'bg-accent/60 text-foreground shadow-sm'
              )}
              onClick={panelControls.toggleSidebar}
              title='Nodes Panel (Cmd+B)'
            >
              <IconSidebar className='h-4 w-4' />
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className={cn(
                "size-7 [&_svg:not([class*='size-'])]:!size-4",
                panelControls.isBottomDockExpanded &&
                  'bg-accent/60 text-foreground shadow-sm'
              )}
              onClick={panelControls.toggleConsole}
              title='Console (Cmd+D)'
            >
              <IconTerminal className='h-4 w-4' />
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className={cn(
                "size-7 [&_svg:not([class*='size-'])]:!size-4",
                panelControls.isRightPanelOpen &&
                  'bg-accent/60 text-foreground shadow-sm'
              )}
              onClick={panelControls.toggleRightPanel}
              title='Right panel (Cmd+L)'
              aria-label='Toggle last used right panel'
              aria-pressed={panelControls.isRightPanelOpen}
            >
              <IconSidebar className='h-4 w-4 -scale-x-100' />
            </Button>
          </div>
        ) : null}

        <ModeToggle />
      </div>
    </header>
  );
}
