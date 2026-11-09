'use client';

import { create } from 'zustand';

export interface GraphPanelTogglesControls {
  isSidebarOpen: boolean;
  isRightPanelOpen: boolean;
  isBottomDockExpanded: boolean;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  toggleConsole: () => void;
}

interface GraphPanelTogglesState {
  controls: GraphPanelTogglesControls | null;
  setControls: (controls: GraphPanelTogglesControls | null) => void;
}

export const useGraphPanelTogglesStore = create<GraphPanelTogglesState>(
  (set) => ({
    controls: null,
    setControls: (controls) => set({ controls })
  })
);
