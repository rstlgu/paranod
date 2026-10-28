'use client';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { MagicWandIcon as IconMagicWand } from '@/components/icons';
import { cn } from '@/lib/utils';
import { useAgentPanelStore } from '../store/agent-panel-store';
import { useActiveAgentGraph } from '../hooks/use-active-agent-graph';

// Rendered by every graph editor; only the active graph tab shows it.
export function AgentToggleButton({ graphId }: { graphId?: string }) {
  const open = useAgentPanelStore((state) => state.open);
  const detached = useAgentPanelStore((state) => state.detached);
  const setOpen = useAgentPanelStore((state) => state.setOpen);
  const graph = useActiveAgentGraph();
  if (!graphId || graph?.id !== graphId) return null;
  // The docked panel replaces this control. A floating window keeps it.
  if (open && !detached) return null;
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            id='agent-panel-toggle'
            type='button'
            variant='ghost'
            size='icon'
            className={cn(
              'size-8 [&_svg]:!size-4',
              open && 'bg-accent/60 text-foreground shadow-sm'
            )}
            aria-label='AI agent'
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <IconMagicWand />
          </Button>
        </TooltipTrigger>
        <TooltipContent side='bottom' sideOffset={8}>
          AI agent
        </TooltipContent>
      </Tooltip>
      <div className='bg-border/30 mx-1 h-6 w-px dark:bg-white/10' />
    </>
  );
}
