import { AgentProviderSettings } from '@/features/agent/components/agent-provider-settings';
import { getAgentCredentialStatus } from '@/features/agent/server/credential';
import { AGENT_MODELS } from '@/features/agent/server/policy';
import { SettingsPageHeader } from '@/features/settings/settings-page-header';
import { getActiveWorkspaceAccess } from '@/lib/auth-utils';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AgentSettingsPage() {
  const access = await getActiveWorkspaceAccess();
  if (!access) redirect('/settings/workspace');
  const status = await getAgentCredentialStatus(access.workspaceId);

  return (
    <div className='flex w-full flex-col gap-8'>
      <SettingsPageHeader
        eyebrow='Workspace settings'
        title='Graph agent'
        description='The model that investigates a graph. Connect a provider, then pick it when you start a run.'
      />
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
