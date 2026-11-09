'use client';

import { useMemo } from 'react';
import { usePlugins } from './use-plugins';

/**
 * Hook per ottenere la lista dei plugin abilitati per l'utente corrente
 * Usa SWR tramite usePlugins per caching condiviso tra tutti i componenti
 */
export function useEnabledPlugins() {
  const { builtinPlugins, communityPlugins, customPlugins, addons, isLoading } =
    usePlugins();

  const enabledPluginIds = useMemo(() => {
    const enabled: string[] = [];

    // Plugin built-in abilitati
    for (const plugin of builtinPlugins) {
      if (plugin.enabled) {
        enabled.push(plugin.id);
      }
    }

    // Plugin community installati e abilitati
    for (const plugin of communityPlugins) {
      if (plugin.enabled) {
        enabled.push(plugin.id);
      }
    }

    // Plugin custom (sempre abilitati se esistono)
    for (const plugin of customPlugins) {
      enabled.push(plugin.id);
    }

    // Addon abilitati
    for (const addon of addons) {
      if (addon.enabled) {
        enabled.push(addon.id);
      }
    }

    // Se non ci sono plugin caricati ancora, restituisci null
    // (che significa "abilita tutti i plugin di default")
    return isLoading ? null : enabled;
  }, [builtinPlugins, communityPlugins, customPlugins, addons, isLoading]);

  return { enabledPluginIds, isLoading };
}
