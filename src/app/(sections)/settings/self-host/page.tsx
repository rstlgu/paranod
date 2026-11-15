import {
  SettingsSection,
  SettingsRow,
  settingsStyles as ui
} from '@/features/settings/settings-fields';
import { getWorkspacePolicy } from '@/lib/workspaces/workspace-policy';
export const dynamic = 'force-dynamic';

export default function SelfHostSettingsPage() {
  const policy = getWorkspacePolicy();
  const containerToolsTimeoutMs = Number(
    process.env.CONTAINER_TOOLS_TIMEOUT_MS ?? 180_000
  );

  return (
    <div>
      <SettingsSection title='Container runner'>
        <SettingsRow
          label='Runner address'
          description='Runs containerized OSINT tools on your host.'
        >
          <span>{policy.runner.url || 'Not configured'}</span>
        </SettingsRow>
        <SettingsRow label='Authentication token'>
          <span>{policy.runner.token ? 'Configured' : 'Not configured'}</span>
        </SettingsRow>
        <SettingsRow label='Tool timeout'>
          <span>{Math.round(containerToolsTimeoutMs / 1000)} seconds</span>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title='Isolated browser'>
        <SettingsRow label='Session lifetime'>
          <span>{Math.round(policy.ttlMs / 60_000)} minutes</span>
        </SettingsRow>
        <SettingsRow label='Sessions per workspace'>
          <span>{policy.maxActiveSessionsPerWorkspace}</span>
        </SettingsRow>
        <SettingsRow label='Sessions per user'>
          <span>{policy.maxActiveSessionsPerUser}</span>
        </SettingsRow>
        <SettingsRow label='Chrome image'>
          <span className={ui.value}>{policy.kasm.chromeImage}</span>
        </SettingsRow>
        <SettingsRow label='Tor image'>
          <span className={ui.value}>{policy.kasm.torImage}</span>
        </SettingsRow>
        <SettingsRow label='Memory per session'>
          <span>{Math.round(policy.kasm.memoryBytes / (1024 * 1024))} MB</span>
        </SettingsRow>
      </SettingsSection>
      <p className={ui.notice}>
        These values are managed in <code>.env.docker</code> or{' '}
        <code>docker-compose.yml</code>. Restart the installation after making
        changes.
      </p>
    </div>
  );
}
