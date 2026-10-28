'use client';

import { Archive, Check, History, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import type { AgentRunSummary } from '../lib/contracts';
import {
  agentConversationThreads,
  agentRunRootId
} from '../lib/conversation-threads';
import styles from './agent-panel.module.css';

interface AgentConversationMenuProps {
  runs: AgentRunSummary[];
  selectedRunId: string | null;
  disabled?: boolean;
  onSelect: (latestRunId: string | null) => void;
  onArchive: (rootId: string) => void;
}

export function AgentConversationMenu({
  runs,
  selectedRunId,
  disabled,
  onSelect,
  onArchive
}: AgentConversationMenuProps) {
  const threads = agentConversationThreads(runs);
  const activeRoot = selectedRunId ? agentRunRootId(runs, selectedRunId) : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type='button'
        className={styles.iconButton}
        aria-label='Conversations on this graph'
        disabled={disabled}
      >
        <History size={15} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-72 p-1'>
        <DropdownMenuLabel className='text-muted-foreground text-xs font-normal'>
          Conversations on this graph
        </DropdownMenuLabel>
        <DropdownMenuItem className='gap-2' onSelect={() => onSelect(null)}>
          <Plus size={14} />
          <span>New conversation</span>
          {!selectedRunId ? <Check size={14} className='ml-auto' /> : null}
        </DropdownMenuItem>
        {threads.length ? <DropdownMenuSeparator /> : null}
        {threads.map((thread) => {
          const selected = activeRoot === thread.rootId;
          return (
            <div
              key={thread.rootId}
              className={styles.conversationRow}
              data-selected={selected || undefined}
            >
              <button
                type='button'
                className={styles.conversationSelect}
                onClick={() => onSelect(thread.latest.id)}
              >
                <span className={styles.conversationTitle}>{thread.title}</span>
                {selected ? <Check size={14} className='shrink-0' /> : null}
              </button>
              <button
                type='button'
                className={styles.conversationArchive}
                aria-label={`Archive conversation: ${thread.title.slice(0, 40)}`}
                title='Archive conversation'
                onClick={() => onArchive(thread.rootId)}
              >
                <Archive size={14} />
              </button>
            </div>
          );
        })}
        {!threads.length ? (
          <p className='text-muted-foreground px-2 py-2 text-xs'>
            No conversations yet
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
