# Read-only graph browser check

Run `node scripts/preview-graph-read-only.mjs` from the repository, then open
`http://127.0.0.1:4183/`. Use Node 22. `--port=4184` selects another port;
`--build` verifies the bundle without keeping a server running.

This fixture renders the real graph editor with synthetic data. API requests are
handled in memory, unknown requests fail closed, and map tiles are local. It does
not load environment files, database credentials or provider keys.

1. Click **Lock graph**. An initial save barrier may increment **Writes**.
2. Switch between Manual, Copilot, Analysis and Map. Test fit, pan, zoom, node
   selection, details and relation navigation, node list, console and notes.
   Writes must not increase while locked, and Rejected/Unmocked should stay zero.
3. Try dragging a node or pressing Delete. Nodes must remain unchanged. Add,
   delete, edit, transforms, imports and persisted layout controls stay disabled.
4. Click **Unlock + canonical completion**. A synthetic result is added and the
   person label changes; the selected node remains selected and editing returns.
5. Start another run. Browsing and selection must not cause a snapshot conflict.

**Reset fixture** discards only this page's synthetic in-memory data.
