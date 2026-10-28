/** Settings hub: one responsive navigation and a consistent content column. */

import {
  SettingsNav,
  type SettingsNavItem
} from '@/features/settings/settings-nav';

export const metadata = {
  title: 'PARANOD : Settings'
};

export default function SettingsLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const items: SettingsNavItem[] = [
    {
      href: '/settings/account',
      label: 'Profile & security',
      shortLabel: 'Account',
      icon: 'account'
    },
    {
      href: '/settings/workspace',
      label: 'Workspace & members',
      shortLabel: 'Workspace',
      icon: 'workspaces'
    },
    {
      href: '/settings/agent',
      label: 'Graph agent',
      shortLabel: 'Agent',
      icon: 'agent'
    },
    {
      href: '/settings/self-host',
      label: 'Deployment',
      shortLabel: 'Self-host',
      icon: 'self-host'
    }
  ];

  return (
    <div className='bg-page h-full min-h-0 w-full overflow-y-auto'>
      <SettingsNav items={items} />
      <main className='min-w-0'>
        <div className='mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 sm:py-9 lg:px-8 lg:py-11'>
          {children}
        </div>
      </main>
    </div>
  );
}
