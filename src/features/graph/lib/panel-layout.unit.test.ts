import { describe, expect, it } from 'vitest';
import {
  graphPanelReducer as reduce,
  graphPanelSizes,
  initialGraphPanels as initial,
  type PanelAction
} from './panel-layout';

describe('panel commands', () => {
  it('keeps notes open when deselection closes details', () => {
    const notes = reduce(initial, { type: 'toggle-notes' });
    expect(reduce(notes, { type: 'details', open: false })).toEqual(notes);
  });

  it('honors consecutive commands, including close/reopen and detach/attach', () => {
    let state = reduce(initial, { type: 'toggle-notes' });
    state = reduce(state, { type: 'detach-notes' });
    state = reduce(state, { type: 'details', open: true });
    expect(state.details && state.notes && state.notesDetached).toBe(true);
    state = reduce(state, { type: 'toggle-right' });
    expect(state.notes && !state.details).toBe(true);
    state = reduce(state, { type: 'toggle-right' });
    state = reduce(state, { type: 'attach-notes' });
    expect(state.details).toBe(false);
    expect(state.notes && !state.notesDetached).toBe(true);
    state = reduce(state, { type: 'close-notes' });
    expect(reduce(state, { type: 'toggle-right' }).notes).toBe(true);
  });

  it('does not toggle the console twice or collapse it when selecting Activity', () => {
    let state = reduce(initial, { type: 'toggle-bottom', tab: 'console' });
    expect(state.bottomExpanded).toBe(true);
    state = reduce(state, { type: 'toggle-bottom', tab: 'activity' });
    expect(state.bottomExpanded).toBe(true);
    state = reduce(state, { type: 'toggle-bottom', tab: 'activity' });
    expect(state.bottomExpanded).toBe(false);
    state = reduce(state, { type: 'toggle-bottom', tab: 'console' });
    expect(state.bottomExpanded).toBe(true);
  });

  it('never assigns two docked contents to the right edge through any reachable transition', () => {
    const actions: PanelAction[] = [
      { type: 'details', open: true },
      { type: 'details', open: false },
      { type: 'toggle-details' },
      { type: 'toggle-notes' },
      { type: 'close-notes' },
      { type: 'detach-notes' },
      { type: 'attach-notes' },
      { type: 'toggle-right' },
      { type: 'close-right' }
    ];
    const seen = new Set<string>();
    const pending = [initial];
    while (pending.length) {
      const state = pending.pop()!;
      const key = JSON.stringify(state);
      if (seen.has(key)) continue;
      seen.add(key);
      expect(state.details && state.notes && !state.notesDetached).toBe(false);
      if (state.details) expect(state.retainedRight).toBe('details');
      if (state.notes && !state.notesDetached)
        expect(state.retainedRight).toBe('notes');
      pending.push(...actions.map((action) => reduce(state, action)));
    }
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });
});

describe('responsive panel constraints', () => {
  it.each([200, 320, 640, 768, 1024, 1280, 1920, 2560])(
    'fits both sides and the canvas into %ipx',
    (width) => {
      const sizes = graphPanelSizes(width);
      expect(
        sizes.sidebarMin + sizes.rightMin + sizes.canvasMin
      ).toBeLessThanOrEqual(100.00001);
      expect(sizes.sidebarMin).toBeLessThanOrEqual(sizes.sidebarMax);
      expect(sizes.rightMin).toBeLessThanOrEqual(sizes.rightMax);
    }
  );
});
