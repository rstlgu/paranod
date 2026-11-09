'use client';

/**
 * useFlows — lista flows dell'workspace attiva (SWR, cache condivisa).
 * `triggerTypes` è calcolato server-side dai nodi trigger: serve per capire
 * quali flow sono eseguibili su una data entità del grafo.
 */

import useSWR from 'swr';

export interface FlowSummary {
  id: string;
  name: string;
  description: string | null;
  triggerTypes: string[];
  nodeCount: number;
  edgeCount: number;
  thumbnail: string | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch flows');
  const data = await res.json();
  return (data.flows ?? []) as FlowSummary[];
};

export function useFlows() {
  const { data, error, isLoading, mutate } = useSWR<FlowSummary[]>(
    '/api/flows',
    fetcher,
    { revalidateOnFocus: false }
  );

  return {
    flows: data ?? [],
    isLoading,
    error,
    refresh: mutate
  };
}

/** Nodi/edge completi di un flow (per l'esecuzione). */
export async function fetchFlowDefinition(flowId: string): Promise<{
  nodes: unknown[];
  edges: unknown[];
  name: string;
} | null> {
  const res = await fetch(`/api/flows/${flowId}`);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const f = data?.flow;
  if (!f) return null;
  return {
    nodes: Array.isArray(f.nodes) ? f.nodes : [],
    edges: Array.isArray(f.edges) ? f.edges : [],
    name: String(f.name ?? '')
  };
}
