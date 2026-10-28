import { expect, it } from 'vitest';
import { graphEditability } from './graph-editability';

const ready = {
  enabled: true,
  snapshotVersion: 0,
  state: { version: 0, locked: false, expiresAt: null },
  error: false,
  rejected: false
};
it('allows only a confirmed current snapshot', () => {
  expect(graphEditability(ready)).toBe('editable');
  expect(graphEditability({ ...ready, snapshotVersion: undefined })).toBe(
    'checking'
  );
  expect(graphEditability({ ...ready, state: undefined })).toBe('checking');
});
it('freezes for the full lease and requires a new snapshot after release', () => {
  expect(
    graphEditability({
      ...ready,
      state: { ...ready.state, version: 1, locked: true }
    })
  ).toBe('locked');
  expect(
    graphEditability({ ...ready, state: { ...ready.state, version: 2 } })
  ).toBe('stale');
  expect(
    graphEditability({
      ...ready,
      snapshotVersion: 2,
      state: { ...ready.state, version: 2 }
    })
  ).toBe('editable');
});
it('fails closed after network loss or a rejected save', () => {
  expect(graphEditability({ ...ready, error: true })).toBe('unavailable');
  expect(graphEditability({ ...ready, rejected: true })).toBe('stale');
});
it('does not lock graphless notes', () => {
  expect(graphEditability({ ...ready, enabled: false, error: true })).toBe(
    'editable'
  );
});
