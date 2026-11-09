'use client';

import { Check, ChevronDown, Hand, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  AGENT_APPROVAL_MODES,
  type AgentApprovalMode
} from '../lib/contracts';
import styles from './agent-panel.module.css';

interface AgentApprovalPickerProps {
  value: AgentApprovalMode;
  disabled?: boolean;
  onChange: (mode: AgentApprovalMode) => void;
}

export function AgentApprovalPicker({
  value,
  disabled,
  onChange
}: AgentApprovalPickerProps) {
  const Icon = MODE_ICONS[value];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={styles.modelTrigger}
        aria-label='Agent permissions'
        data-mode={value}
        disabled={disabled}
      >
        <Icon size={10} />
        <span>{AGENT_APPROVAL_MODES[value].label}</span>
        <ChevronDown size={10} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side='top'
        align='start'
        className={`w-64 ${styles.modelDropdown}`}
      >
        <DropdownMenuLabel className='text-muted-foreground text-xs'>
          Permissions
        </DropdownMenuLabel>
        {MODE_ORDER.map((mode) => {
          const ItemIcon = MODE_ICONS[mode];
          return (
            <DropdownMenuItem key={mode} onSelect={() => onChange(mode)}>
              <ItemIcon />
              <span className='flex flex-col'>
                <span>{AGENT_APPROVAL_MODES[mode].label}</span>
                <span className='text-muted-foreground text-xs'>
                  {AGENT_APPROVAL_MODES[mode].description}
                </span>
              </span>
              {mode === value ? <Check className='ml-auto' /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const MODE_ORDER: AgentApprovalMode[] = ['ask', 'guarded', 'auto'];

const MODE_ICONS = {
  ask: Hand,
  guarded: ShieldCheck,
  auto: ShieldAlert
} satisfies Record<AgentApprovalMode, typeof Hand>;
