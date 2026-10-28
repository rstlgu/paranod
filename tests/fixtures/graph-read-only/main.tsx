import { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'next-themes';
import { SWRConfig, useSWRConfig } from 'swr';
import { Toaster } from 'sonner';
import L from 'leaflet';
import GraphViewPage from '@/features/graph/components/graph-view-page';
import { SaveStatusProvider } from '@/contexts/save-status-context';
import { TooltipProvider } from '@/components/ui/tooltip';
import { graphClientCoordinator } from '@/features/graph/lib/graph-client-coordinator';
import { useAgentActivityStore } from '@/features/agent/store/agent-activity-store';
import { useAgentPanelStore } from '@/features/agent/store/agent-panel-store';
import { useWorkspaceTabsStore } from '@/features/workspace/store/workspace-tabs-store';
import { GRAPH_ID, GRAPH_NAME } from './mock-fetch';
import { fixtureServer } from './bootstrap';
import '@/app/globals.css';
import './preview.css';

// Keep the real Leaflet controls/markers; only replace external tile imagery.
L.TileLayer.prototype.getTileUrl = () => '/offline-map-tile.svg';
useWorkspaceTabsStore.setState({
  tabs: [{ id: `graph:${GRAPH_ID}`, kind: 'graph', resourceId: GRAPH_ID, title: GRAPH_NAME }],
  activeTabId: `graph:${GRAPH_ID}`,
  hasHydrated: true
});
useAgentPanelStore.setState({ open: false });

const swrConfig = { provider: () => new Map(), shouldRetryOnError: false };
function publishActivity() {
  const { run, events } = fixtureServer.state;
  if (run) useAgentActivityStore.getState().receive(run, [...events], true);
}

function Fixture() {
  const { mutate } = useSWRConfig();
  useSyncExternalStore(fixtureServer.subscribe, fixtureServer.getRevision);
  useSyncExternalStore(graphClientCoordinator.subscribe, graphClientCoordinator.getRevision);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const state = fixtureServer.state;
  useEffect(() => {
    const timer = setInterval(() => setReady(graphClientCoordinator.isLoaded(GRAPH_ID)), 200);
    return () => clearInterval(timer);
  }, []);

  async function lock() {
    setBusy(true);
    setError('');
    try {
      await graphClientCoordinator.start({
        graphId: GRAPH_ID, goal: 'Synthetic graph lock QA',
        model: 'fixture-no-provider', reasoning: 'low', approvalMode: 'guarded'
      });
      publishActivity();
      await mutate(`/api/graphs/${GRAPH_ID}/write-state`);
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
    } finally { setBusy(false); }
  }

  async function complete() {
    setBusy(true);
    setError('');
    try {
      fixtureServer.complete();
      publishActivity();
      if (state.run) await graphClientCoordinator.observe(state.run);
      await mutate(`/api/graphs/${GRAPH_ID}/write-state`);
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
    } finally { setBusy(false); }
  }

  useEffect(() => {
    Object.assign(window, { graphReadOnlyFixture: {
      server: fixtureServer, coordinator: graphClientCoordinator,
      lock, complete, graphId: GRAPH_ID
    } });
  });

  return (
    <div className='fixture-shell'>
      <header className='fixture-toolbar' aria-label='Synthetic graph controls'>
        <strong>Graph read-only QA</strong>
        <button data-testid='lock-graph' disabled={busy || state.locked || !ready} onClick={() => void lock()}>Lock graph</button>
        <button data-testid='complete-run' disabled={busy || !state.locked} onClick={() => void complete()}>Unlock + canonical completion</button>
        <output aria-label='Fixture lock state'>{busy ? 'Updating' : state.locked ? 'Locked' : ready ? 'Editable' : 'Loading'}</output>
        <output aria-label='Write version'>Version {state.version}</output>
        <output aria-label='Accepted writes'>Writes: {state.acceptedWrites}</output>
        <output aria-label='Rejected writes'>Rejected: {state.rejectedWrites}</output>
        <output aria-label='Unexpected requests'>Unmocked: {state.unexpectedRequests}</output>
        <button onClick={() => location.reload()}>Reset fixture</button>
        {error && <span role='alert'>{error}</span>}
      </header>
      <main className='fixture-workspace' aria-label='Full graph editor'>
        <GraphViewPage graphId={GRAPH_ID} />
      </main>
      <Toaster />
    </div>
  );
}

createRoot(document.getElementById('root')!, {
  onUncaughtError: (error) => {
    document.getElementById('root')!.textContent = error instanceof Error ? (error.stack ?? error.message) : String(error);
  }
}).render(
  <SWRConfig value={swrConfig}>
    <ThemeProvider attribute='class' defaultTheme='light' enableSystem={false} storageKey='graph-read-only-theme'>
      <TooltipProvider>
        <SaveStatusProvider><Fixture /></SaveStatusProvider>
      </TooltipProvider>
    </ThemeProvider>
  </SWRConfig>
);
