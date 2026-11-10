# Paranod

Paranod is an open-source, self-hosted OSINT framework. It brings tools together around an interactive graph: select an entity, run a transformation and inspect the new entities and relationships. An optional AI agent can use reviewed tools and update the same graph under application-enforced permissions and approval rules.

## Features

- Visual graph with typed entities, relationships, notes and investigation cases.
- Builtin plugins, external HTTP addons and isolated container tools.
- Addon installation from personalized manifests, with an optional store link for discovery.
- Visual flows for composing transformations.
- Optional graph agent with configurable model providers, an activity timeline and approval modes.
- Local administrator and user accounts, with a shared workspace.
- Docker deployment with PostgreSQL, persistent encrypted credentials and background workers.

Provider accounts and API keys belong to the administrator of the installation. External data and AI providers may charge for their own services; Paranod does not sell plans or credits.

## Install a prebuilt release

Download the [Paranod 2.3.1 release](https://github.com/rstlgu/paranod/releases/tag/v2.3.1) and follow the [installation guide](docs/INSTALL.md). It includes checksum-verified Docker images for Linux amd64 and arm64, plus a deployment bundle. No local compilation or GitHub login is required. Use [operations](docs/OPERATIONS.md) for updates, backup and restore, and the [addon walkthrough](docs/ADDON-WALKTHROUGH.md) to connect a working polling addon.

## Build from source with Docker

Requirements: Docker Engine with Compose v2. Container tools and browser sessions require a Linux Docker daemon (Docker Desktop provides one on macOS). Build and runtime resources depend on the tools and concurrent browser sessions you enable.

Traefik negotiates the Docker API version with the daemon. Leave `DOCKER_API_VERSION` empty in `.env.docker`; an explicit value disables negotiation and can make the stack incompatible with older engines. If troubleshooting requires an override, choose a version supported by both client and server using `docker version`. See the [Docker API documentation](https://docs.docker.com/reference/api/engine/#versioned-api-and-sdk) and the [Traefik Docker client configuration](https://github.com/traefik/traefik/blob/v3.7.17/pkg/provider/docker/shared.go).

```sh
git clone https://github.com/rstlgu/paranod.git
cd paranod
cp .env.docker.example .env.docker
```

Edit `.env.docker` and replace the database password, runner token and maintenance token with independent random values. Generate each value with `openssl rand -hex 32`. The sample binds the application to `127.0.0.1:3002`. For a different address, set `APP_BIND_IP`, `APP_PORT`, `APP_URL` and `BETTER_AUTH_URL` consistently. Keep the configuration file out of Git.

Check the Docker daemon before starting the stack:

```sh
docker context show
docker info
./docker/compose.sh config --quiet
./docker/compose.sh up -d --build
```

Open **http://localhost:3002/setup** and create the first administrator. Further accounts are created by an administrator in the workspace settings. Configure each plugin's API key in its settings before running operations that require one.

The stack contains:

| Service            | Purpose                                                       |
| ------------------ | ------------------------------------------------------------- |
| `traefik`          | HTTP entry point and same-origin browser-session routing      |
| `app`              | Web interface, API, authentication and maintenance            |
| `postgres`         | Application data and the agent's durable queue                |
| `container-runner` | Container tools and isolated browser sessions                 |
| `agent-worker`     | Optional AI agent execution, enabled with the `agent` profile |

The runner has access to the Docker socket and must be treated as a privileged service. Its API and PostgreSQL are not published on host ports. Use a trusted host and configure TLS before exposing the web interface beyond a trusted local environment.

### Enable the agent

Set these values in `.env.docker`:

```dotenv
PARANOD_AGENT_WORKER_ENABLED=true
COMPOSE_PROFILES=agent
```

Run `./docker/compose.sh up -d --build` again, then configure a provider in **Settings → Graph agent**. The application requires both a configured provider and a healthy worker before starting a run. Provider requests use your account and may incur charges. See [Agent operations](docs/AGENT-OPERATIONS.md) for approvals, limits and recovery.

### Operations

```sh
./docker/compose.sh ps
./docker/compose.sh logs -f app agent-worker
./docker/compose.sh down
```

The first startup generates missing authentication and encryption keys in the application volume. Back up **both PostgreSQL and the application volume**: losing the encryption keys prevents access to stored credentials and uploaded files. Normal `down` preserves named volumes.

The database starts from the migration in `prisma/migrations` and applies later migrations during startup. This repository targets a fresh installation. Do not point it at a database from another distribution without a separately reviewed migration.

For more than one installation on the same daemon, use a different `COMPOSE_PROJECT_NAME` and `APP_PORT` for each. Networks, volumes and spawned browser/container names are scoped to that project. Source-build image names are project-scoped; prebuilt release images can be shared.

## Local development

Requirements: Node.js 22, pnpm 9.15.5 and PostgreSQL 16.

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
```

Set database credentials and independent authentication/encryption secrets in `.env`. Then:

```sh
pnpm prisma generate
pnpm prisma migrate deploy
pnpm dev
```

Container tools and isolated browsers require the runner; a local web server alone does not supply it. The agent requires a separate worker process and an enabled configuration.

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm build:agent
pnpm build
```

CI checks the schema against a fresh PostgreSQL database, types, tests, lint and the production build. Integration tests must use disposable databases and isolated Docker project names.

## Extend Paranod

Builtin plugins describe accepted inputs, configuration fields and output types. Their implementations run behind authenticated server routes. External addons expose a manifest, registration and transformation endpoints; signed requests connect them to the platform. Container tools run through the local Docker runner.

Workspace membership, permissions and addon installations are part of the self-hosted application. An addon can run on a separate server and use free or paid data providers. Installing it does not require a central Paranod account or a Paranod subscription.

An administrator can install an addon directly from its personalized manifest URL in **Plugins & Addons**. The optional `NEXT_PUBLIC_ADDON_STORE_URL` build setting adds a link to an external catalogue; manifest installation works without that link. Set it before building the application image if you want a store link in your installation.

The [Paranod addon SDK](https://github.com/rstlgu/paranod-addon-sdk) 0.5 supports local installations without a public platform address. Run Paranod at `http://localhost:3002`, install the provider's personalized HTTPS manifest, and use its tools. Synchronous results return directly; compatible background actions use signed outbound polling. No domain, inbound port or local TLS certificate is required for those addons.

Docker includes the polling worker: results continue to be collected while the browser is closed, and pending polls resume after an application restart. Older addons that only support callbacks still need a reachable HTTPS platform address for background actions; ask their provider to upgrade for local use. See [Extension protocol and security](docs/ADDON-SECURITY-AND-PUBLISHING.md) for compatibility, and [Architecture](ARCHITECTURE.md) for the application structure. The SDK is not required to build or run Paranod.

The graph agent can run enabled builtin plugins, compatible synchronous/asynchronous addons, and the registered Sherlock, Maigret and Holehe container tools. It waits for results and imports them before continuing the investigation. Existing approval modes apply to these operations. See [Agent operations](docs/AGENT-OPERATIONS.md) for setup, cancellation and limits.

## Security and contributions

See [SECURITY.md](SECURITY.md) for vulnerability reporting. Contributions should include focused tests for changes to authorization, graph writes, addon validation and agent execution. Never commit local configuration, provider keys, database exports or uploaded investigation data.

## License

Copyright (c) 2026 Luigi Rosato. Paranod is licensed under the [GNU Affero General Public License, version 3 only](LICENSE) (`AGPL-3.0-only`). It is provided without warranty. See [licensing and source availability](docs/LICENSING.md). The separately maintained addon SDK remains MIT. Third-party attribution is preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); dependencies retain their respective licenses.
