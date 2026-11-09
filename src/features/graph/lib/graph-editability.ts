import type { GraphWriteState } from './graph-write-state';

export type GraphEditability =
  | 'editable'
  | 'checking'
  | 'locked'
  | 'stale'
  | 'unavailable';

export function graphEditability(input: {
  enabled: boolean;
  snapshotVersion?: number;
  state?: GraphWriteState;
  error: boolean;
  rejected: boolean;
}): GraphEditability {
  if (!input.enabled) return 'editable';
  if (input.error) return 'unavailable';
  if (!input.state || input.snapshotVersion === undefined) return 'checking';
  if (input.state.locked) return 'locked';
  if (input.rejected || input.state.version !== input.snapshotVersion)
    return 'stale';
  return 'editable';
}

export function downloadLocalDraft(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
