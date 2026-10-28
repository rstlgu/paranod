'use client';

import React, { createContext, useContext, useMemo } from 'react';
import type { Addon } from '@/features/plugins/hooks/use-plugins';
import {
  usePluginConfigs,
  type PluginConfigs
} from '@/features/plugins/hooks/use-plugin-configs';

interface EnabledPluginsContextType {
  enabledPluginIds: string[] | null;
  addons: Addon[];
  graphId?: string;
  isLoading: boolean;
  pluginConfigs: PluginConfigs;
  isLoadingConfigs: boolean;
}

const EnabledPluginsContext = createContext<EnabledPluginsContextType | null>(
  null
);

export function EnabledPluginsProvider({
  children,
  enabledPluginIds,
  addons = [],
  graphId,
  isLoading
}: {
  children: React.ReactNode;
  enabledPluginIds: string[] | null;
  addons?: Addon[];
  graphId?: string;
  isLoading: boolean;
}) {
  // Carica le configurazioni dei plugin dal database
  const { configs: pluginConfigs, isLoading: isLoadingConfigs } =
    usePluginConfigs();
  const value = useMemo<EnabledPluginsContextType>(
    () => ({
      enabledPluginIds,
      addons,
      graphId,
      isLoading,
      pluginConfigs,
      isLoadingConfigs
    }),
    [
      addons,
      enabledPluginIds,
      graphId,
      isLoading,
      isLoadingConfigs,
      pluginConfigs
    ]
  );

  return (
    <EnabledPluginsContext.Provider value={value}>
      {children}
    </EnabledPluginsContext.Provider>
  );
}

export function useEnabledPluginsContext() {
  const context = useContext(EnabledPluginsContext);
  if (!context) {
    // Se non siamo dentro il context, restituisci valori di default
    return {
      enabledPluginIds: null,
      addons: [],
      graphId: undefined,
      isLoading: false,
      pluginConfigs: {},
      isLoadingConfigs: false
    };
  }
  return context;
}
