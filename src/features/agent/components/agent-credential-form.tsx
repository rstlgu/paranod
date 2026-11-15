'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  SettingsRow,
  settingsStyles as ui
} from '@/features/settings/settings-fields';
import { Textarea } from '@/components/ui/textarea';
import { AGENT_PROVIDERS } from '@/features/agent/lib/contracts';
import type { AgentProviderCredential } from '@/features/agent/server/credential';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

interface AgentCredentialFormProps {
  credential: AgentProviderCredential;
  canEdit: boolean;
}

export function AgentCredentialForm({
  credential,
  canEdit
}: AgentCredentialFormProps) {
  const router = useRouter();
  const { provider, configured, updatedAt } = credential;
  const { label, keyPlaceholder } = AGENT_PROVIDERS[provider];
  const hasModelList = provider === 'openrouter';
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState(credential.models.join('\n'));
  const [isSaving, setIsSaving] = useState(false);
  const fieldId = `agent-api-key-${provider}`;
  const parsedModels = models
    .split(/[\s,]+/)
    .map((slug) => slug.trim())
    .filter(Boolean);
  const hasModelChanges =
    parsedModels.join('\n') !== credential.models.join('\n');
  const canSubmit =
    apiKey.trim().length >= 20 || (configured && hasModelChanges);

  async function submit(method: 'PUT' | 'DELETE') {
    setIsSaving(true);
    try {
      const response = await fetch(
        method === 'DELETE'
          ? `/api/agent/credential?provider=${provider}`
          : '/api/agent/credential',
        {
          method,
          headers: { 'Content-Type': 'application/json' },
          body:
            method === 'PUT'
              ? JSON.stringify({
                  provider,
                  ...(apiKey.trim() ? { apiKey } : {}),
                  ...(hasModelList ? { models: parsedModels } : {})
                })
              : undefined
        }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(ERROR_MESSAGES[data?.error] ?? 'Save failed');
      }
      setApiKey('');
      toast.success(
        method === 'PUT'
          ? `${label}: configuration saved`
          : `${label}: key removed`
      );
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className='w-full'>
      {updatedAt ? (
        <p className='text-muted-foreground text-xs'>
          Updated {new Date(updatedAt).toLocaleString()}
        </p>
      ) : null}

      {canEdit ? (
        <form
          className='w-full'
          onSubmit={(event) => {
            event.preventDefault();
            submit('PUT');
          }}
        >
          <SettingsRow
            label={configured ? 'Replace API key' : 'API key'}
            htmlFor={fieldId}
            description='Encrypted on the server. The saved key is never displayed.'
          >
            <Input
              id={fieldId}
              type='password'
              autoComplete='off'
              spellCheck={false}
              placeholder={keyPlaceholder}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </SettingsRow>
          {hasModelList ? (
            <SettingsRow
              label='Allowed models'
              htmlFor={`${fieldId}-models`}
              description='One model ID per line, up to 20. Models must support tools.'
            >
              <Textarea
                id={`${fieldId}-models`}
                rows={4}
                spellCheck={false}
                placeholder={
                  'x-ai/grok-4\nmistralai/mistral-large\ndeepseek/deepseek-chat'
                }
                value={models}
                onChange={(event) => setModels(event.target.value)}
              />
            </SettingsRow>
          ) : null}
          <div className={ui.actions}>
            <Button
              className={ui.action}
              type='submit'
              disabled={isSaving || !canSubmit}
            >
              {isSaving ? 'Saving…' : 'Save'}
            </Button>
            {configured ? (
              <Button
                type='button'
                className={ui.action}
                disabled={isSaving}
                onClick={() => submit('DELETE')}
              >
                Remove
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        <p className='text-muted-foreground text-sm'>
          Only workspace admins can change the key.
        </p>
      )}
    </div>
  );
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_agent_key: 'Invalid key or models',
  workspace_admin_required: 'Admin role required',
  encryption_required: 'Encryption is not configured on the server',
  agent_key_required: 'Enter the key first',
  agent_origin_not_allowed: 'Request not allowed'
};
