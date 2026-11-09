import { createFixtureServer } from './mock-fetch';

export const fixtureServer = createFixtureServer(location.origin);
window.fetch = fixtureServer.request;

// Start clean only on this dedicated fixture origin, before any persisted stores hydrate.
localStorage.clear();
sessionStorage.clear();
sessionStorage.setItem('paranod-graph-view-mode', 'free');
sessionStorage.setItem('paranod-investigation-mode', 'free');

void import('./main').catch((error) => {
  document.getElementById('root')!.textContent = String(error?.stack ?? error);
});
