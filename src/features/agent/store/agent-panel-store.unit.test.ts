import { beforeEach, describe, expect, it } from 'vitest';
import { effectiveAgentRunId, useAgentPanelStore } from './agent-panel-store';

beforeEach(() =>
  useAgentPanelStore.setState({
    drafts: {},
    submissions: {},
    selectedRuns: {},
    open: false
  })
);

describe('confirmed conversation drafts', () => {
  it.each(['graph', 'parent'])(
    'restores %s after a rejected start without losing the draft',
    (scope) => {
      const store = useAgentPanelStore.getState();
      store.setDraft(scope, 'Keep this goal');
      store.rememberSubmission('missing-run', scope, 'Keep this goal');
      store.selectRun('graph', 'missing-run');
      store.rejectSubmission('graph', 'missing-run');
      const state = useAgentPanelStore.getState();
      const expected = scope === 'graph' ? null : scope;
      expect(state.selectedRuns.graph).toBe(expected);
      expect(state.restoredRuns.graph).toBe(expected);
      expect(state.drafts[scope]).toBe('Keep this goal');
      expect(state.submissions).toEqual({});
    }
  );
  it('does not replace a newer conversation selection on late preparation failure', () => {
    const store = useAgentPanelStore.getState();
    store.rememberSubmission('failed', 'graph', 'Goal');
    store.selectRun('graph', 'newer');
    store.rejectSubmission('graph', 'failed');
    expect(useAgentPanelStore.getState().selectedRuns.graph).toBe('newer');
    expect(useAgentPanelStore.getState().restoredRuns.graph).toBe('newer');
  });
  it('clears the original graph scope even after selecting the confirmed run', () => {
    const store = useAgentPanelStore.getState();
    store.setDraft('graph', ' First goal ');
    store.rememberSubmission('run', 'graph', ' First goal ');
    store.selectRun('graph', 'run');
    store.setDraft('run', 'Next question');
    store.confirmSubmission('run');
    store.selectRun('graph', null);
    expect(useAgentPanelStore.getState().drafts).toEqual({
      run: 'Next question'
    });
  });
  it('clears only the captured parent scope after follow-up confirmation', () => {
    const store = useAgentPanelStore.getState();
    store.setDraft('parent', 'Follow-up');
    store.setDraft('graph', 'Separate conversation');
    store.rememberSubmission('child', 'parent', 'Follow-up');
    store.setOpen(false);
    store.confirmSubmission('child');
    expect(useAgentPanelStore.getState().drafts).toEqual({
      graph: 'Separate conversation'
    });
    expect(useAgentPanelStore.getState().submissions).toEqual({});
  });
  it('preserves uncertain drafts, and a newer draft on late confirmation', () => {
    const store = useAgentPanelStore.getState();
    store.setDraft('parent', 'Original');
    store.rememberSubmission('child', 'parent', 'Original');
    expect(useAgentPanelStore.getState().drafts.parent).toBe('Original');
    store.setDraft('parent', 'Newer typing');
    store.confirmSubmission('child');
    store.confirmSubmission('child');
    expect(useAgentPanelStore.getState().drafts.parent).toBe('Newer typing');
  });
  it('keeps a draft after preparation or explicit start rejection', () => {
    const store = useAgentPanelStore.getState();
    store.setDraft('parent', 'Not sent');
    store.rememberSubmission('child', 'parent', 'Not sent');
    store.forgetSubmission('child');
    store.confirmSubmission('child');
    expect(useAgentPanelStore.getState().drafts.parent).toBe('Not sent');
  });
});

describe('remembered agent preferences', () => {
  it('keeps the chosen model and permission mode in the panel store', () => {
    const store = useAgentPanelStore.getState();
    store.setApprovalMode('auto');
    store.setModelSelection({ model: 'gpt-6-luna', reasoning: 'low' });
    expect(useAgentPanelStore.getState().approvalMode).toBe('auto');
    expect(useAgentPanelStore.getState().modelSelection).toEqual({
      model: 'gpt-6-luna',
      reasoning: 'low'
    });
  });
});

describe('graph-scoped conversations', () => {
  it('keeps a separate selected conversation for each graph', () => {
    const store = useAgentPanelStore.getState();
    store.selectRun('graph-a', 'run-a');
    store.selectRun('graph-b', 'run-b');
    expect(useAgentPanelStore.getState().selectedRuns).toEqual({
      'graph-a': 'run-a',
      'graph-b': 'run-b'
    });
    store.selectRun('graph-a', null);
    expect(useAgentPanelStore.getState().selectedRuns).toEqual({
      'graph-a': null,
      'graph-b': 'run-b'
    });
  });
  it('resumes the latest conversation of a graph unless a new one was chosen', () => {
    const runs = [
      { id: 'b-latest', graphId: 'graph-b' },
      { id: 'a-latest', graphId: 'graph-a' },
      { id: 'a-older', graphId: 'graph-a' }
    ];
    expect(effectiveAgentRunId({}, 'graph-a', runs)).toBe('a-latest');
    expect(effectiveAgentRunId({ 'graph-a': null }, 'graph-a', runs)).toBe(
      null
    );
    expect(effectiveAgentRunId({ 'graph-a': 'a-older' }, 'graph-a', runs)).toBe(
      'a-older'
    );
    expect(effectiveAgentRunId({}, 'graph-c', runs)).toBe(null);
  });
  it('restores an earlier selection only when the catalog lists it for that graph', () => {
    const runs = [
      { id: 'a-latest', graphId: 'graph-a' },
      { id: 'a-older', graphId: 'graph-a' },
      { id: 'b-run', graphId: 'graph-b' }
    ];
    const restore = (id: string | null) =>
      effectiveAgentRunId({}, 'graph-a', runs, { 'graph-a': id });
    expect(restore('a-older')).toBe('a-older');
    expect(restore(null)).toBe(null);
    expect(restore('b-run')).toBe('a-latest');
    expect(restore('foreign')).toBe('a-latest');
    expect(
      effectiveAgentRunId({}, 'graph-a', undefined, { 'graph-a': 'a-older' })
    ).toBe(null);
  });
  it('records every selection for the next page load', () => {
    useAgentPanelStore.setState({ restoredRuns: {} });
    const store = useAgentPanelStore.getState();
    store.selectRun('graph-a', 'run-a');
    store.selectRun('graph-b', null);
    expect(useAgentPanelStore.getState().restoredRuns).toEqual({
      'graph-a': 'run-a',
      'graph-b': null
    });
  });
});
