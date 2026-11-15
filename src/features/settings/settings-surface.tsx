'use client';

import { createContext, useContext } from 'react';

export const SettingsSurfaceContext = createContext(false);
export const SettingsReturnContext = createContext('/');
export const useSettingsSurface = () => useContext(SettingsSurfaceContext);

export const SettingsLayerContext = createContext<{
  intercepted: boolean;
  setIntercepted: (open: boolean) => void;
}>({ intercepted: false, setIntercepted: () => {} });

export function underlyingApplicationPath(
  pathname: string,
  returnHref: string
) {
  return /^\/(settings|plugins|profile)(\/|$)/.test(pathname)
    ? returnHref.split(/[?#]/)[0] || '/'
    : pathname;
}
