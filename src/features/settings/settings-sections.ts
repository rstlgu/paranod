export const SETTINGS_SECTIONS = [
  {
    href: '/settings',
    label: 'General',
    group: 'Preferences',
    icon: 'general',
    keywords: 'appearance theme light dark system'
  },
  {
    href: '/settings/account',
    label: 'Account',
    group: 'Preferences',
    icon: 'account',
    keywords: 'profile password security sessions name email'
  },
  {
    href: '/settings/workspace',
    label: 'Workspace',
    group: 'Workspace',
    icon: 'workspace',
    keywords: 'members users permissions organization'
  },
  {
    href: '/settings/agent',
    label: 'AI agent',
    group: 'Workspace',
    icon: 'agent',
    keywords: 'models providers credentials api keys'
  },
  {
    href: '/plugins',
    label: 'Plugins',
    group: 'Extensions',
    icon: 'plugins',
    keywords: 'tools transforms modules configuration'
  },
  {
    href: '/plugins?tab=addons',
    label: 'Addons',
    group: 'Extensions',
    icon: 'addons',
    keywords: 'install manifest external store url'
  },
  {
    href: '/settings/self-host',
    label: 'System',
    group: 'Installation',
    icon: 'system',
    keywords: 'deployment docker runner storage self host'
  }
] as const;

export function activeSettingsSection(pathname: string, tab: string | null) {
  if (pathname === '/plugins' || pathname.startsWith('/plugins/'))
    return tab === 'addons' ? '/plugins?tab=addons' : '/plugins';
  return (
    SETTINGS_SECTIONS.find(
      (s) =>
        s.href !== '/settings' &&
        !s.href.startsWith('/plugins') &&
        (pathname === s.href || pathname.startsWith(s.href + '/'))
    )?.href ?? '/settings'
  );
}
