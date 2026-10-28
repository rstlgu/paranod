# Architecture

Paranod is a TypeScript application built with Next.js and React. PostgreSQL stores application records through Prisma. Better Auth manages local accounts and sessions. A workspace groups users, graphs, cases, flows and tool configuration; the self-hosted application uses one shared workspace.

```text
Browser → Traefik → Next.js application → PostgreSQL
                         ├─ builtin transforms → external data providers
                         ├─ signed addon requests → external addon services
                         └─ local Docker runner → tools and browser sessions

Next.js → PostgreSQL queue → agent worker → controlled graph/tool gateway
```

## Graph and persistence

The graph editor presents typed nodes and edges. Stored graph snapshots retain data and presentation state; application validation checks references and limits before accepting changes. Cases organize graphs and notes. Graph version checks, serialized saves and agent leases prevent conflicting writers from silently overwriting one another.

## Extension boundaries

The plugin registry describes inputs, outputs and configuration fields. Authenticated transform routes validate the active workspace, plugin state and graph write permission before dispatch. Streaming transformations use bounded progress events and a terminal result.

An addon is a separate HTTP service, not code loaded into the application. Installation validates a manifest and its destinations, registers the workspace and stores encrypted configuration. Signed requests, signed callbacks, event deduplication and conditional job transitions protect the asynchronous lifecycle. The administrator controls which addons are installed and enabled.

The local Docker runner executes allowlisted images and creates isolated browser sessions. It is a privileged component because it controls Docker. Authentication tokens protect the internal runner API; resource limits, per-instance naming and expiration constrain sessions. Traefik forwards session paths on the application's origin.

## Agent execution

The web application validates a request, acquires a fenced graph lease and queues work in PostgreSQL. A separate worker loads the selected provider credentials and executes the agent loop. The model discovers reviewed tools on demand and proposes operations; application code validates every call, applies the selected approval policy and validates the returned entities and relationships.

Activity events, conversation state and checkpoints are persisted. Worker heartbeats determine readiness. Stop/recovery paths revoke write ownership, and stale workers cannot continue writing after losing their lease. Provider usage records are diagnostic; they do not guarantee an exact spending limit.

## Deployment

Docker Compose runs the web app, PostgreSQL, proxy, runner and optional agent worker. The web entrypoint applies versioned Prisma migrations before serving requests and starts maintenance. The agent worker waits for web health and shares only the read-only configuration volume; it does not apply migrations or mount the Docker socket.

The repository contains a clean initial schema for fresh installations. PostgreSQL stores durable application data and queue state. The application volume stores encryption keys and temporary file data. Both are required for a recoverable backup.

## Source map

| Directory | Responsibility |
| --- | --- |
| `src/app` | Pages and authenticated API routes |
| `src/features/graph` | Graph UI, snapshots, write coordination and leases |
| `src/features/plugins` | Registry, builtin transforms, addon lifecycle and configuration |
| `src/features/agent` | Agent UI, model providers, gateway and worker |
| `src/features/flow` | Visual flow editing and execution |
| `src/lib/security` | Encryption, request bounds, signing and safe HTTP |
| `src/lib/runner` | Application client for the local runner |
| `services/container-runner` | Docker tool and browser-session service |
| `prisma` | Schema and versioned migrations |
| `docker` | Startup, maintenance and proxy configuration |
