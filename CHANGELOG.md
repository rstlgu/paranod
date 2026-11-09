# Changelog

## 2.3.0 — 2026-11-09

Initial release of this clean-history AGPL repository.

- License the application and its container runner under AGPL-3.0-only; preserve third-party notices. The separate addon SDK remains MIT.
- Provide a visible License & source link, license copies in images, and an exact release-source archive with build instructions and lockfiles.
- Replace the React Leaflet integration with a local adapter over BSD-licensed Leaflet to remove Hippocratic-2.1 dependencies while preserving map interactions.
- Retain the graph, plugins/addons, signed async polling, agent approval rules and container tools from the standalone OSS application.
- Ship Traefik 3.7.17, native Linux amd64/arm64 Docker images, checksums and install/update/backup/restore documentation.

Earlier MIT grants remain applicable to copies obtained under those terms. This repository starts with one new root commit; it does not import previous application history.

A complete investigation through a real AI provider remains a separate, deferred validation step.
