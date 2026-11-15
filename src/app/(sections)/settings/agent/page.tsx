import { AgentProviderSettings } from '@/features/agent/components/agent-provider-settings';
import { getAgentCredentialStatus } from '@/features/agent/server/credential';
import { AGENT_MODELS } from '@/features/agent/server/policy';
import { getActiveWorkspaceAccess } from '@/lib/auth-utils';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AgentSettingsPage() {
  const access = await getActiveWorkspaceAccess();
  if (!access) redirect('/settings/workspace');
  const status = await getAgentCredentialStatus(access.workspaceId);

  return (
    <div className='flex w-full flex-col gap-8'>
      <AgentProviderSettings
        canEdit={access.role === 'admin'}
        rows={status.providers.map((credential) => ({
          credential,
          models:
            credential.provider === 'openrouter'
              ? credential.models.map((slug) => ({ id: slug, name: slug }))
              : AGENT_MODELS.filter(
                  (model) => model.provider === credential.provider
                ).map((model) => ({ id: model.id, name: model.name }))
        }))}
      />
    </div>
  );
}
