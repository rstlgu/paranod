'use client';

interface ImportedGraphPayload {
  nodes: unknown[];
  edges: unknown[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseGraphJsonText(text: string): ImportedGraphPayload | null {
  const parsed = JSON.parse(text) as unknown;
  if (!isObject(parsed)) return null;
  const nodes = parsed.nodes;
  const edges = parsed.edges;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return null;
  return { nodes, edges };
}

export async function readGraphJsonFile(file: File): Promise<ImportedGraphPayload | null> {
  const text = await file.text();
  return parseGraphJsonText(text);
}

export function openGraphImportPicker(args: {
  onImported: (payload: ImportedGraphPayload) => void;
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
      const payload = await readGraphJsonFile(file);
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
