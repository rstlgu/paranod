/**
 * Hook per caricare le configurazioni dei plugin dal database
 */

import { useEffect, useState } from 'react';

export interface PluginConfigs {
  [pluginId: string]: Record<string, unknown>;
}

export function usePluginConfigs() {
  const [configs, setConfigs] = useState<PluginConfigs>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadConfigs() {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch('/api/plugins/config');
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load plugin configurations');
        }

        if (data.success && data.data) {
          setConfigs(data.data);
        } else {
          setConfigs({});
        }
      } catch (err) {
        console.error('Error loading plugin configs:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setConfigs({});
      } finally {
        setIsLoading(false);
      }
    }

    loadConfigs();
  }, []);

  return { configs, isLoading, error };
}
