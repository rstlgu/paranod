'use client';

import { Fragment } from 'react';
import { Check, ChevronDown, Sparkles } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import type { AgentModelOption, AgentProviderId } from '../lib/contracts';
import { ProviderMark } from './agent-provider-mark';
import styles from './agent-panel.module.css';

export interface AgentModelSelection {
  model: string;
  reasoning: string;
}

interface AgentModelPickerProps {
  models: AgentModelOption[];
  value: AgentModelSelection | null;
  disabled?: boolean;
  onChange: (selection: AgentModelSelection) => void;
}

const PRIMARY_LIMIT = 2;

export interface AgentModelGroup {
  provider: AgentProviderId;
  label: string;
  configured: boolean;
  primary: AgentModelOption[];
  other: AgentModelOption[];
}

export function AgentModelPicker({
  models,
  value,
  disabled,
  onChange
}: AgentModelPickerProps) {
  const auto = models.find((option) => option.provider === 'auto');
  const selected = models.find((option) => option.id === value?.model);
  const groups = groupAgentModels(models, value?.model);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={styles.modelTrigger}
        aria-label='AI model'
        disabled={disabled || !models.length}
      >
        {selected?.provider === 'auto' ? (
          <Sparkles size={10} />
        ) : selected ? (
          <ProviderMark provider={selected.provider} />
        ) : null}
        <span>{selectionLabel(selected, value?.reasoning)}</span>
        <ChevronDown size={10} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side='top'
        align='start'
        className={`w-64 ${styles.modelDropdown}`}
      >
        {auto ? (
          <DropdownMenuItem
            onSelect={() =>
              onChange({ model: auto.id, reasoning: auto.defaultReasoning })
            }
          >
            <Sparkles />
            <span className='flex flex-col'>
              <span>Auto</span>
              <span className='text-muted-foreground text-xs'>
                Picks the model and reasoning
              </span>
            </span>
            {selected?.id === auto.id ? <Check className='ml-auto' /> : null}
          </DropdownMenuItem>
        ) : null}
        {groups.map((group, index) => (
          <Fragment key={group.provider}>
            {index > 0 || auto ? <DropdownMenuSeparator /> : null}
            {group.configured ? (
              <>
                <DropdownMenuLabel className='text-muted-foreground text-xs'>
                  {group.label}
                </DropdownMenuLabel>
                {group.primary.map((option) => (
                  <ModelChoice
                    key={option.id}
                    option={option}
                    selected={selected?.id === option.id}
                    reasoning={value?.reasoning}
                    onChange={onChange}
                  />
                ))}
                {group.other.length ? (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className='pl-7'>
                      <span className='flex-1'>Other models</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent
                      className={`w-64 ${styles.modelDropdown}`}
                    >
                      {group.other.map((option) => (
                        <ModelChoice
                          key={option.id}
                          option={option}
                          selected={selected?.id === option.id}
                          reasoning={value?.reasoning}
                          onChange={onChange}
                        />
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ) : null}
              </>
            ) : (
              <DropdownMenuItem disabled>
                <ProviderMark provider={group.provider} />
                <span className='flex-1 truncate'>{group.label}</span>
                <span className='text-muted-foreground text-xs'>
                  Not configured
                </span>
              </DropdownMenuItem>
            )}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelChoice({
  option,
  selected,
  reasoning,
  onChange
}: {
  option: AgentModelOption;
  selected: boolean;
  reasoning?: string;
  onChange: (selection: AgentModelSelection) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className='gap-2'>
        <ProviderMark provider={option.provider} />
        <span className='flex-1 truncate'>{option.name}</span>
        {selected && reasoning ? (
          <span className='text-muted-foreground text-xs'>
            {reasoningLabel(reasoning)}
          </span>
        ) : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className={`w-44 ${styles.modelDropdown}`}>
        <DropdownMenuRadioGroup
          value={selected ? (reasoning ?? '') : ''}
          onValueChange={(level) =>
            onChange({ model: option.id, reasoning: level })
          }
        >
          {option.reasoningLevels.map((level) => (
            <DropdownMenuRadioItem key={level} value={level}>
              <span className='flex-1'>{reasoningLabel(level)}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function groupAgentModels(
  models: AgentModelOption[],
  selectedId?: string
) {
  const groups: AgentModelGroup[] = [];
  for (const group of PROVIDER_GROUPS) {
    const options = models.filter(
      (option) => option.provider === group.provider
    );
    if (!options.length) continue;
    const available = options.filter((option) => option.available);
    if (!available.length) {
      groups.push({ ...group, configured: false, primary: [], other: [] });
      continue;
    }
    groups.push({
      ...group,
      configured: true,
      ...splitModels(available, FEATURED[group.provider], selectedId)
    });
  }
  return groups;
}

function splitModels(
  available: AgentModelOption[],
  featuredIds: readonly string[],
  selectedId?: string
) {
  const featured = featuredIds.flatMap((id) => {
    const match = available.find((option) => option.id === id);
    return match ? [match] : [];
  });
  const primary = (featured.length ? featured : available).slice(
    0,
    PRIMARY_LIMIT
  );
  const selected = available.find((option) => option.id === selectedId);
  if (selected && !primary.some((option) => option.id === selected.id))
    primary.push(selected);
  const shown = new Set(primary.map((option) => option.id));
  return {
    primary,
    other: available.filter((option) => !shown.has(option.id))
  };
}

function selectionLabel(option?: AgentModelOption, reasoning?: string) {
  if (!option) return 'No model configured';
  if (option.provider === 'auto') return option.name;
  return `${option.name} · ${reasoningLabel(reasoning ?? option.defaultReasoning)}`;
}

export function reasoningLabel(level: string) {
  return REASONING_LABELS[level] ?? level;
}

const PROVIDER_GROUPS: {
  provider: AgentProviderId;
  label: string;
}[] = [
  { provider: 'openai', label: 'GPT' },
  { provider: 'anthropic', label: 'Claude' },
  { provider: 'google', label: 'Gemini' },
  { provider: 'xai', label: 'Grok' },
  { provider: 'deepseek', label: 'DeepSeek' },
  { provider: 'moonshot', label: 'Kimi' },
  { provider: 'openrouter', label: 'OpenRouter' }
];

const FEATURED: Record<AgentProviderId, readonly string[]> = {
  openai: ['gpt-6-astra', 'gpt-6.1-sol'],
  anthropic: ['claude-sonnet-5-5', 'claude-opus-5-5'],
  google: ['gemini-3.8-flash', 'gemini-3.1-pro-preview'],
  xai: ['grok-4.7', 'grok-4.3'],
  deepseek: ['deepseek-flash'],
  moonshot: ['kimi-k2.6', 'kimi-k3'],
  openrouter: []
};

const REASONING_LABELS: Record<string, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max'
};
