'use client';

import { AGENT_PROVIDERS } from '@/features/agent/lib/contracts';
import type { AgentProviderCredential } from '@/features/agent/server/credential';
import { Button } from '@/components/ui/button';
import {
  SettingsSection,
  SettingsRow,
  settingsStyles as ui
} from '@/features/settings/settings-fields';
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <div>
      <SettingsSection
        title='Model providers'
        description='Connect the providers you want to use. Choose a model from the agent when starting an investigation.'
      >
        {rows.map(({ credential, models }) => {
          const meta = AGENT_PROVIDERS[credential.provider];
          const expanded = selectedId === credential.provider;
          return (
            <div key={credential.provider}>
              <SettingsRow label={meta.label} description={meta.summary}>
                <span className={ui.status}>
                  {credential.configured ? 'Connected' : 'Not connected'}
                </span>
                <Button
                  className={ui.action}
                  aria-expanded={expanded}
                  aria-controls={`provider-${credential.provider}`}
                  onClick={() =>
                    setSelectedId(expanded ? null : credential.provider)
                  }
                >
                  {expanded ? 'Close' : canEdit ? 'Configure' : 'Details'}
                </Button>
              </SettingsRow>
              {expanded && (
                <div
                  id={`provider-${credential.provider}`}
                  className={ui.editor}
                >
                  <SettingsRow label='Available models'>
                    <ul className={ui.models}>
                      {models.length ? (
                        models.map((model) => (
                          <li key={model.id}>{model.name}</li>
                        ))
                      ) : (
                        <li className={ui.value}>Add model IDs below.</li>
                      )}
                    </ul>
                  </SettingsRow>
                  <AgentCredentialForm
                    credential={credential}
                    canEdit={canEdit}
                  />
                </div>
              )}
            </div>
          );
        })}
      </SettingsSection>
    </div>
  );
}
