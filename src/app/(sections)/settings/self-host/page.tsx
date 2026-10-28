/** Deployment settings for the self-hosted installation. */

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { SettingsPageHeader } from '@/features/settings/settings-page-header';
import { getWorkspacePolicy } from '@/lib/workspaces/workspace-policy';

export const dynamic = 'force-dynamic';

function RunnerIcon() {
  return (
    <svg
      aria-hidden='true'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinecap='round'
      strokeLinejoin='round'
      className='size-5'
    >
      <rect x='3' y='4' width='18' height='6' rx='2' />
      <rect x='3' y='14' width='18' height='6' rx='2' />
      <path d='M7 7h.01M7 17h.01M11 7h7M11 17h7' />
    </svg>
  );
}

function SafeBrowserIcon() {
  return (
    <svg
      aria-hidden='true'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinecap='round'
      strokeLinejoin='round'
      className='size-5'
    >
      <rect x='3' y='4' width='18' height='16' rx='2' />
      <path d='M3 9h18M7 6.5h.01M10 6.5h.01' />
    </svg>
  );
}

function ConfiguredBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <Badge
      variant='outline'
      className='border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/30 dark:bg-emerald-900/10 dark:text-emerald-400'
    >
      Configured
    </Badge>
  ) : (
    <Badge
      variant='outline'
      className='border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/30 dark:bg-amber-900/10 dark:text-amber-400'
    >
      Not set
    </Badge>
  );
}

function Row({
  label,
  value,
  badge
}: {
  label: string;
  value?: string | number | null;
  badge?: React.ReactNode;
}) {
  return (
    <div className='flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6'>
      <span className='text-muted-foreground text-sm'>{label}</span>
      <span className='flex min-w-0 items-center gap-2 text-sm font-medium sm:justify-end sm:text-right'>
        {value != null && value !== '' ? String(value) : null}
        {badge}
      </span>
    </div>
  );
}

export default function SelfHostSettingsPage() {
  const policy = getWorkspacePolicy();
  const containerToolsTimeoutMs = Number(
    process.env.CONTAINER_TOOLS_TIMEOUT_MS ?? 180_000
  );

  return (
    <div className='w-full space-y-8'>
      <SettingsPageHeader
        eyebrow='System settings'
        title='Deployment'
        description='Review the local runner and isolated-browser configuration for this self-hosted installation.'
        action={<Badge variant='outline'>Read only</Badge>}
      />

      <div className='grid items-start gap-6 xl:grid-cols-2'>
        <Card className='border-border/70 shadow-none'>
          <CardHeader className='border-border/60 border-b'>
            <div className='flex items-start gap-3'>
              <span className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg'>
                <RunnerIcon />
              </span>
              <div>
                <CardTitle className='text-base'>Container runner</CardTitle>
                <CardDescription className='mt-1.5 leading-5'>
                  Executes OSINT tools and isolated browser workloads on your
                  host.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className='divide-border/60 divide-y'>
            <Row
              label='Runner URL'
              value={policy.runner.url}
              badge={<ConfiguredBadge ok={!!policy.runner.url} />}
            />
            <Row
              label='Authentication token'
              badge={<ConfiguredBadge ok={!!policy.runner.token} />}
            />
            <Row
              label='Tool timeout'
              value={`${Math.round(containerToolsTimeoutMs / 1000)}s`}
            />
          </CardContent>
        </Card>

        <Card className='border-border/70 shadow-none'>
          <CardHeader className='border-border/60 border-b'>
            <div className='flex items-start gap-3'>
              <span className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg'>
                <SafeBrowserIcon />
              </span>
              <div>
                <CardTitle className='text-base'>Safe browser</CardTitle>
                <CardDescription className='mt-1.5 leading-5'>
                  Resource limits for Kasm-based isolated browser sessions.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className='divide-border/60 divide-y'>
            <Row
              label='Session lifetime'
              value={`${Math.round(policy.ttlMs / 60_000)} min`}
            />
            <Row
              label='Sessions per workspace'
              value={policy.maxActiveSessionsPerWorkspace}
            />
            <Row
              label='Sessions per user'
              value={policy.maxActiveSessionsPerUser}
            />
            <Row label='Chrome image' value={policy.kasm.chromeImage} />
            <Row label='Tor image' value={policy.kasm.torImage} />
            <Row
              label='Memory per session'
              value={`${Math.round(policy.kasm.memoryBytes / (1024 * 1024))} MB`}
            />
          </CardContent>
        </Card>
      </div>

      <div className='border-border bg-muted/20 rounded-xl border border-dashed px-4 py-3'>
        <p className='text-muted-foreground text-xs leading-5'>
          To change these values, edit <code>.env.docker</code> or{' '}
          <code>docker-compose.yml</code>, then restart the stack.
        </p>
      </div>
    </div>
  );
}
