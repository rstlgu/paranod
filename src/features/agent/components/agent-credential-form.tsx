'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
    <div className='flex flex-col gap-4'>
      {updatedAt ? (
        <p className='text-muted-foreground text-xs'>
          Updated {new Date(updatedAt).toLocaleString()}
        </p>
      ) : null}

      {canEdit ? (
        <form
          className='flex flex-col gap-4'
          onSubmit={(event) => {
            event.preventDefault();
            submit('PUT');
          }}
        >
          <div className='flex flex-col gap-2'>
            <Label htmlFor={fieldId}>
              {configured ? 'Replace key' : 'API key'}
            </Label>
            <Input
              id={fieldId}
              type='password'
              autoComplete='off'
              spellCheck={false}
              placeholder={keyPlaceholder}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              Encrypted on the server and never shown again.
            </p>
          </div>
          {hasModelList ? (
            <div className='flex flex-col gap-2'>
              <Label htmlFor={`${fieldId}-models`}>Allowed models</Label>
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
              <p className='text-muted-foreground text-xs'>
                One slug per line, up to 20. The agent only works with models
                that support tools.
              </p>
            </div>
          ) : null}
          <div className='flex flex-wrap gap-2'>
            <Button type='submit' disabled={isSaving || !canSubmit}>
              {isSaving ? 'Saving…' : 'Save'}
            </Button>
            {configured ? (
              <Button
                type='button'
                variant='outline'
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
