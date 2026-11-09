import { create } from 'zustand';

interface HoverState {
  hoveredNodeId: string | null;
  hoveredEdgeId: string | null;
  setHoveredNodeId: (id: string | null) => void;
  setHoveredEdgeId: (id: string | null) => void;
}

export const useHoverStore = create<HoverState>((set) => ({
  hoveredNodeId: null,
  hoveredEdgeId: null,
  setHoveredNodeId: (id) => set({ hoveredNodeId: id }),
  setHoveredEdgeId: (id) => set({ hoveredEdgeId: id })
}));
