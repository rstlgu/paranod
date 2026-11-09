'use client';

import { AGENT_PROVIDERS } from '@/features/agent/lib/contracts';
import type { AgentProviderCredential } from '@/features/agent/server/credential';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { AgentCredentialForm } from './agent-credential-form';

export interface AgentProviderModel {
  id: string;
  name: string;
}

export interface AgentProviderRow {
  credential: AgentProviderCredential;
  models: AgentProviderModel[];
}

interface AgentProviderSettingsProps {
  rows: AgentProviderRow[];
  canEdit: boolean;
}

export function AgentProviderSettings({
  rows,
  canEdit
}: AgentProviderSettingsProps) {
  const [selectedId, setSelectedId] = useState(
    () =>
      rows.find((row) => row.credential.configured)?.credential.provider ??
      rows[0]?.credential.provider
  );
  const selected =
    rows.find((row) => row.credential.provider === selectedId) ?? rows[0];
  if (!selected) return null;
  const meta = AGENT_PROVIDERS[selected.credential.provider];
  const ready = rows.filter((row) => row.credential.configured).length;

  return (
    <div className='flex flex-col gap-4'>
      <p className='text-muted-foreground text-sm'>
        {ready} of {rows.length} configured. One key is enough.
      </p>
      <div className='border-border bg-card grid overflow-hidden rounded-xl border lg:grid-cols-[17rem_minmax(0,1fr)]'>
        <div
          role='radiogroup'
          aria-label='Providers'
          className='border-border flex gap-1 overflow-x-auto border-b p-2 lg:flex-col lg:overflow-visible lg:border-r lg:border-b-0'
        >
          {rows.map((row) => {
            const provider = AGENT_PROVIDERS[row.credential.provider];
            const active =
              row.credential.provider === selected.credential.provider;
            return (
              <button
                key={row.credential.provider}
                type='button'
                role='radio'
                aria-checked={active}
                onClick={() => setSelectedId(row.credential.provider)}
                className={cn(
                  'flex min-w-40 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left lg:w-full lg:min-w-0',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-muted/70'
                )}
              >
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    row.credential.configured
                      ? 'bg-primary'
                      : 'bg-muted-foreground/35'
                  )}
                />
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-sm font-medium'>
                    {provider.label}
                  </span>
                  <span className='text-muted-foreground block truncate text-xs'>
                    {row.credential.configured ? 'Ready' : 'Not configured'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className='flex flex-col gap-6 p-5 sm:p-6'>
          <div className='flex flex-col gap-2'>
            <div className='flex flex-wrap items-baseline justify-between gap-2'>
              <h2 className='text-lg font-semibold tracking-tight'>
                {meta.label}
              </h2>
              <span className='text-muted-foreground text-xs'>
                {selected.credential.configured
                  ? selected.credential.keyHint
                    ? `Key ${selected.credential.keyHint}`
                    : 'Key stored'
                  : 'No key'}
              </span>
            </div>
            <p className='text-muted-foreground max-w-xl text-sm leading-6'>
              {meta.summary}
            </p>
          </div>
          <ModelList
            provider={selected.credential.provider}
            models={selected.models}
          />
          <AgentCredentialForm
            key={selected.credential.provider}
            credential={selected.credential}
            canEdit={canEdit}
          />
        </div>
      </div>
    </div>
  );
}

function ModelList({
  provider,
  models
}: {
  provider: AgentProviderRow['credential']['provider'];
  models: AgentProviderModel[];
}) {
  return (
    <div className='flex flex-col gap-2'>
      <p className='text-muted-foreground text-[11px] font-semibold tracking-[0.16em] uppercase'>
        Models
      </p>
      {models.length ? (
        <ul className='flex flex-wrap gap-1.5'>
          {models.map((model) => (
            <li
              key={model.id}
              className='border-border bg-muted/40 rounded-md border px-2 py-1 text-xs'
            >
              <span className='font-medium'>{model.name}</span>
              {model.name !== model.id ? (
                <span className='text-muted-foreground ml-1.5 font-mono'>
                  {model.id}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className='text-muted-foreground text-sm'>
          {provider === 'openrouter'
            ? 'No models yet. Add tool-capable slugs below, one per line.'
            : 'No models for this provider.'}
        </p>
      )}
    </div>
  );
}
