'use client';

import { useEffect, useMemo, useRef } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/lib/auth-client';

interface PluginTransform {
  id: string;
  name: string;
  description: string;
  inputType: string;
  outputTypes: string[];
}

interface ConfigField {
  type: 'string' | 'number' | 'boolean' | 'select';
  label: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  options?: Array<{ label: string; value: string }>;
  secret?: boolean;
  /** Edizioni in cui il campo esiste (default entrambe). */
}

export type PluginCategory =
  | 'network'
  | 'identity'
  | 'media'
  | 'location'
  | 'blockchain'
  | 'ai'
  | 'osint'
  | 'social'
  | 'documents'
  | 'other';

export interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  icon?: string;
  logoUrl?: string;
  category: PluginCategory;
  inputTypes: string[];
  outputTypes: string[];
  transforms: PluginTransform[];
  isInstalled: boolean;
  enabled: boolean;
  requiresConfig?: boolean;
  configSchema?: Record<string, ConfigField>;
  config?: Record<string, unknown>;
}

export interface CommunityPlugin {
  id: string;
  name: string;
  description: string | null;
  version: string;
  iconUrl?: string;
  inputTypes: string[];
  installs: number;
  isVerified: boolean;
  installed: boolean;
  enabled: boolean;
  isOwner: boolean;
}

export interface CustomPlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  icon?: string;
  logoUrl?: string;
  category: PluginCategory;
  inputTypes: string[];
  outputTypes: string[];
  transforms: PluginTransform[];
  enabled: boolean;
  requiresConfig?: boolean;
  configSchema?: Record<string, ConfigField>;
  config?: Record<string, unknown>;
  isOwner: boolean;
  isPublic: boolean;
  isVerified: boolean;
  installs: number;
}

export interface Addon {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  icon?: string;
  logoUrl?: string;
  category: PluginCategory;
  inputTypes: string[];
  outputTypes: string[];
  transforms: PluginTransform[];
  isInstalled: boolean;
  enabled: boolean;
  type: 'addon';
  installationId?: string;
  installedAt?: string;
  manifestUrl?: string;
  hasConfig?: boolean;
  requiresConfig?: boolean;
  configSchema?: Record<string, ConfigField>;
  config?: Record<string, unknown>;
}

/** @deprecated use Addon */
export type ExternalPlugin = Addon;

interface PluginsData {
  builtin: Plugin[];
  community: CommunityPlugin[];
  custom: CustomPlugin[];
  addons: Addon[];
  isAdmin: boolean;
}

const isDebugPlugins =
  process.env.NODE_ENV === 'development' &&
  process.env.NEXT_PUBLIC_DEBUG_PLUGINS === 'true';

function debugPluginsLog(...args: unknown[]) {
  if (!isDebugPlugins) return;
  // eslint-disable-next-line no-console
  console.log(...args);
}

const fetcher = async (url: string): Promise<PluginsData> => {
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 401) {
      // Not authenticated, return empty data
      return {
        builtin: [],
        community: [],
        custom: [],
        addons: [],
        isAdmin: false
      };
    }
    throw new Error('Failed to fetch plugins');
  }
  const data = await response.json();
  debugPluginsLog('✅ Received plugins:', {
    builtin: data.builtin?.length || 0,
    community: data.community?.length || 0,
    custom: data.custom?.length || 0,
    addons: data.addons?.length || 0,
    isAdmin: data.isAdmin
  });
  return data;
};

/**
 * Hook per caricare i plugins con caching SWR
 * - Mostra dati stale immediatamente mentre rivalidata in background
 * - Cache condivisa tra componenti
 * - Rivalidazione automatica su focus/reconnect
 */
export function usePlugins() {
  const { isLoaded, isSignedIn } = useAuth();

  // Fetch only after the local session has loaded and the user is signed in.
  // The workspace is resolved server-side from user preferences.
  const shouldFetch = isLoaded && isSignedIn;

  const { data, error, isLoading, mutate } = useSWR<PluginsData>(
    shouldFetch ? '/api/plugins' : null,
    fetcher,
    {
      revalidateOnFocus: false, // Non ricaricare su focus per evitare flash
      revalidateOnReconnect: true,
      dedupingInterval: 5000, // Deduplica richieste entro 5 secondi
      keepPreviousData: true, // Mantieni dati precedenti durante il refresh
      shouldRetryOnError: false // Don't retry on errors
    }
  );

  const debugSnapshot = useMemo(
    () =>
      JSON.stringify({
    shouldFetch,
    isLoaded,
    isSignedIn,
    isLoading,
        hasData: Boolean(data),
    builtinCount: data?.builtin?.length || 0,
    addonsCount: data?.addons?.length || 0,
    error: error?.message
      }),
    [shouldFetch, isLoaded, isSignedIn, isLoading, data, error]
  );

  const lastDebugSnapshotRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isDebugPlugins) return;
    if (lastDebugSnapshotRef.current === debugSnapshot) return;
    lastDebugSnapshotRef.current = debugSnapshot;
    debugPluginsLog('🎯 usePlugins hook state:', JSON.parse(debugSnapshot));
  }, [debugSnapshot]);

  return useMemo(
    () => ({
    builtinPlugins: data?.builtin || [],
    communityPlugins: data?.community || [],
    customPlugins: data?.custom || [],
    addons: data?.addons || [],
    isWorkspaceAdmin: data?.isAdmin || false,
    isLoading: shouldFetch ? isLoading : false,
    isError: shouldFetch ? !!error : false,
    refresh: mutate
    }),
    [data, shouldFetch, isLoading, error, mutate]
  );
}
