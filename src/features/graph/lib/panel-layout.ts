export type RightPanel = 'details' | 'notes';
export type BottomPanel = 'console' | 'activity';

export interface GraphPanelState {
  sidebar: boolean;
  details: boolean;
  notes: boolean;
  notesDetached: boolean;
  retainedRight: RightPanel;
  bottomTab: BottomPanel;
  bottomExpanded: boolean;
}

export const initialGraphPanels: GraphPanelState = {
  sidebar: false,
  details: false,
  notes: false,
  notesDetached: false,
  retainedRight: 'details',
  bottomTab: 'console',
  bottomExpanded: false
};

export type PanelAction =
  | { type: 'sidebar'; open: boolean | ((current: boolean) => boolean) }
  | { type: 'details'; open: boolean }
  | { type: 'toggle-details' }
  | { type: 'toggle-notes' }
  | { type: 'close-notes' }
  | { type: 'detach-notes' }
  | { type: 'attach-notes' }
  | { type: 'toggle-right' }
  | { type: 'close-right' }
  | { type: 'bottom'; open: boolean }
  | { type: 'toggle-bottom'; tab: BottomPanel };

export function graphPanelReducer(
  state: GraphPanelState,
  action: PanelAction
): GraphPanelState {
  switch (action.type) {
    case 'sidebar':
      return {
        ...state,
        sidebar:
          typeof action.open === 'function'
            ? action.open(state.sidebar)
            : action.open
      };
    case 'toggle-details':
      return graphPanelReducer(state, {
        type: 'details',
        open: !state.details
      });
    case 'details':
      return action.open
        ? {
            ...state,
            details: true,
            retainedRight: 'details',
            notes: state.notesDetached && state.notes
          }
        : { ...state, details: false };
    case 'toggle-notes':
      return state.notesDetached
        ? { ...state, notes: !state.notes }
        : {
            ...state,
            details: false,
            notes: !state.notes,
            retainedRight: 'notes'
          };
    case 'close-notes':
      return { ...state, notes: false };
    case 'detach-notes':
      return {
        ...state,
        notes: true,
        notesDetached: true,
        retainedRight: 'details'
      };
    case 'attach-notes':
      return {
        ...state,
        details: false,
        notes: true,
        notesDetached: false,
        retainedRight: 'notes'
      };
    case 'close-right':
      return {
        ...state,
        details: false,
        notes: state.notesDetached && state.notes
      };
    case 'toggle-right':
      if (state.details || (state.notes && !state.notesDetached))
        return graphPanelReducer(state, { type: 'close-right' });
      if (state.notesDetached || state.retainedRight === 'details')
        return graphPanelReducer(state, { type: 'details', open: true });
      return { ...state, notes: true };
    case 'bottom':
      return { ...state, bottomExpanded: action.open };
    case 'toggle-bottom':
      return {
        ...state,
        bottomTab: action.tab,
        bottomExpanded:
          action.tab === state.bottomTab ? !state.bottomExpanded : true
      };
  }
}

// Sidebars share a finite width with the canvas. Reserve 20% for the graph
// and scale both minima together, including while the agent changes width.
export function graphPanelSizes(width: number | null) {
  const available = Math.max(1, width || 1400);
  const scale = Math.min(1, (available * 0.8) / (400 + 360));
  const sidebarMin = ((400 * scale) / available) * 100;
  const rightMin = ((360 * scale) / available) * 100;
  return {
    canvasMin: 20,
    sidebarMin,
    rightMin,
    sidebarMax: Math.max(sidebarMin, Math.min(80, (860 / available) * 100)),
    rightMax: Math.max(rightMin, Math.min(80, (720 / available) * 100))
  };
}
