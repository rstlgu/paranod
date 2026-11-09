'use client';

import { toast } from 'sonner';
import type { Edge, Node } from 'reactflow';

interface ImportedFlowPayload {
  nodes: unknown[];
  edges: unknown[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function exportFlowJson(args: { nodes: Node[]; edges: Edge[]; filename?: string }) {
  const json = JSON.stringify({ nodes: args.nodes, edges: args.edges }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = args.filename ?? `flow-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success('Flow exported');
}

export function parseFlowJsonText(text: string): ImportedFlowPayload | null {
  const parsed = JSON.parse(text) as unknown;
  if (!isObject(parsed)) return null;
  const nodes = (parsed as any).nodes;
  const edges = (parsed as any).edges;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return null;
  return { nodes, edges };
}

export async function readFlowJsonFile(file: File): Promise<ImportedFlowPayload | null> {
  const text = await file.text();
  return parseFlowJsonText(text);
}

export function openFlowImportPicker(args: {
  onImported: (payload: ImportedFlowPayload) => void;
  onInvalid?: () => void;
  onError?: (error: unknown) => void;
}) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const payload = await readFlowJsonFile(file);
      if (!payload) {
        args.onInvalid?.();
        return;
      }
      args.onImported(payload);
    } catch (error) {
      args.onError?.(error);
    }
  };
  input.click();
}
