import { describe, expect, it } from 'vitest';
import { conflictingLeftPanel } from './left-panels';

const closed = { sidebar: false, agent: false, docked: false, active: true };

describe('conflicting left panels', () => {
  it('closes the nodes sidebar when the agent opens', () => {
    expect(
      conflictingLeftPanel(
        { sidebar: true, agent: true, docked: true, active: true },
        { ...closed, sidebar: true }
      )
    ).toBe('sidebar');
  });
  it('closes the agent when the nodes sidebar opens', () => {
    expect(
      conflictingLeftPanel(
        { sidebar: true, agent: true, docked: true, active: true },
        { ...closed, agent: true, docked: true }
      )
    ).toBe('agent');
  });
  it('does nothing when only one panel is open', () => {
    expect(
      conflictingLeftPanel(
        { sidebar: true, agent: false, docked: false, active: true },
        closed
      )
    ).toBe(null);
    expect(
      conflictingLeftPanel(
        { sidebar: false, agent: true, docked: true, active: true },
        closed
      )
    ).toBe(null);
  });
  it('closes the sidebar when switching to a graph that had it open while the agent is showing', () => {
    expect(
      conflictingLeftPanel(
        { sidebar: true, agent: true, docked: true, active: true },
        { sidebar: true, agent: true, docked: true, active: false }
      )
    ).toBe('sidebar');
  });
  it('keeps a floating agent window open when the nodes sidebar opens', () => {
    expect(
      conflictingLeftPanel(
        { sidebar: true, agent: true, docked: false, active: true },
        { sidebar: false, agent: true, docked: false, active: true }
      )
    ).toBe(null);
  });
  it('closes the nodes sidebar when a floating agent is docked beside it', () => {
    expect(
      conflictingLeftPanel(
        { sidebar: true, agent: true, docked: true, active: true },
        { sidebar: true, agent: true, docked: false, active: true }
      )
    ).toBe('sidebar');
  });
});
