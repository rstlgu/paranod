export interface LeftPanelSnapshot {
  sidebar: boolean;
  agent: boolean;
  // A floating agent window does not occupy the left edge.
  docked: boolean;
  active: boolean;
}

// The docked agent and the nodes sidebar share the left edge: the latest one opened wins.
export function conflictingLeftPanel(
  current: LeftPanelSnapshot,
  previous: LeftPanelSnapshot
): 'sidebar' | 'agent' | null {
  if (!current.active || !current.sidebar || !current.agent || !current.docked)
    return null;
  if (!previous.active || !previous.agent || !previous.docked) return 'sidebar';
  return 'agent';
}
