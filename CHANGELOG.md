# Changelog

## 2.3.3 — 2026-11-10

- Publish the panel animation fixes with the complete read-only browsing test suite aligned to reduced-motion support.
- No database or runtime behavior changes beyond the panel fixes listed below. The 2.3.2 candidate was not published because its release checks detected the outdated test mock.

## 2.3.2 — unpublished candidate

- Restore coordinated opening and closing animations for graph and flow panels while preserving concurrent panel state.
- Keep splitter dragging immediate and respect reduced-motion preferences.
- Retain docked note content while closing and animate floating agent window dismissal.

## 2.3.1 — 2026-11-10

- Fix concurrent side panels, notes, floating agent windows and console toggles.
- Preserve active-tab controls and notes across graph switches.
- Restore drag-to-open in the console and flow sidebar, and correct flow resize ordering.
- Keep toolbar commands reachable on narrow screens and closed panels out of keyboard interaction.
- Add regression coverage for concurrent layouts, resize gestures and floating-window cleanup.
- No database schema changes.

## 2.3.0 — 2026-11-09

Initial release of this clean-history AGPL repository.

- License the application and its container runner under AGPL-3.0-only; preserve third-party notices. The separate addon SDK remains MIT.
- Provide a visible License & source link, license copies in images, and an exact release-source archive with build instructions and lockfiles.
- Replace the React Leaflet integration with a local adapter over BSD-licensed Leaflet to remove Hippocratic-2.1 dependencies while preserving map interactions.
- Retain the graph, plugins/addons, signed async polling, agent approval rules and container tools from the standalone OSS application.
- Ship Traefik 3.7.17, native Linux amd64/arm64 Docker images, checksums and install/update/backup/restore documentation.

Earlier MIT grants remain applicable to copies obtained under those terms. This repository starts with one new root commit; it does not import previous application history.

A complete investigation through a real AI provider remains a separate, deferred validation step.
