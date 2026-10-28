import { NavItem } from '@/types';

// Info: dati usati per sidebar navigation e Cmd-K.
export const navItems: NavItem[] = [
  {
    title: 'Workspace',
    url: '/',
    icon: 'dashboard',
    isActive: false,
    shortcut: ['w', 'w'],
    items: []
  },
  {
    title: 'Cases',
    url: '/cases',
    icon: 'cases',
    shortcut: ['c', 'a'],
    isActive: false,
    items: []
  },
  {
    title: 'Flows',
    url: '/flows',
    icon: 'flow',
    shortcut: ['f', 'l'],
    isActive: false,
    items: []
  },
  {
    title: 'Plugins & Addons',
    url: '/plugins',
    icon: 'store',
    shortcut: ['p', 'l'],
    isActive: false,
    items: []
  }
  // Settings lives in the user menu.
];

/** Navigation shared by the sidebar and command menu. */
export function getVisibleNavItems(): NavItem[] {
  return navItems;
}
