# Contributor instructions

This repository contains the self-hosted Paranod application. Preserve authentication, workspace authorization, addon validation and agent approval boundaries when changing features.

## Local checks

Use Node.js 22 and pnpm 9.15.5. Run `pnpm prisma generate` after schema changes, then `pnpm typecheck`, relevant tests, `pnpm lint` and a production build. Database changes require versioned migrations. Do not replace migrations with destructive schema synchronization.

## Docker isolation

Before any command that creates, changes or removes Docker resources, inspect `docker context show` and `docker info`. Select the daemon deliberately. Use a unique `COMPOSE_PROJECT_NAME`, separate credentials, a free port and disposable volumes for tests. Never run tests against another installation's database or remove its containers, images, networks or volumes.

The entry point is `docker/compose.sh`, which reads the untracked `.env.docker` file (or `PARANOD_ENV_FILE`). Validate configuration with `docker/compose.sh config --quiet` before deployment changes. Avoid printing expanded configuration because it contains secrets.

## Repository hygiene

Keep secrets in ignored local files. Commit only placeholder `.env.example` and `.env.docker.example`. Exclude local editor/agent state, Git bundles, database dumps, caches, generated builds and uploaded investigation files.

Before publishing, review staged files and run `git diff --check`. Never log credential values. Preserve third-party notices and licenses.
