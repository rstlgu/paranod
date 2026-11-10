import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useGraphPanelTogglesStore as store,
  type GraphPanelTogglesControls
} from './graph-panel-toggles-store';

const controls = (): GraphPanelTogglesControls => ({
  isSidebarOpen: false,
  isRightPanelOpen: false,
  isBottomDockExpanded: false,
  toggleSidebar: vi.fn(),
  toggleRightPanel: vi.fn(),
  toggleConsole: vi.fn()
});
afterEach(() => store.setState({ controls: null }));

describe('active tab panel controls', () => {
  it('retains the newer tab controls if the old tab cleans up later', () => {
    const first = controls(),
      second = controls();
    const releaseFirst = store.getState().setControls(first);
    const releaseSecond = store.getState().setControls(second);
    releaseFirst();
    expect(store.getState().controls).toBe(second);
    store.getState().controls!.toggleRightPanel();
    expect(second.toggleRightPanel).toHaveBeenCalledOnce();
    releaseSecond();
    expect(store.getState().controls).toBe(null);
  });
  it('does not erase a newer render from the same tab', () => {
    const releaseOldRender = store.getState().setControls(controls());
    const latest = controls();
    store.getState().setControls(latest);
    releaseOldRender();
    releaseOldRender();
    expect(store.getState().controls).toBe(latest);
  });
});
