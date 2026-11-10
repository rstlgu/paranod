# Install a prebuilt Paranod release

Paranod 2.3.1 is a self-hosted release under GNU AGPLv3 (`AGPL-3.0-only`). It requires a Linux Docker daemon and Docker Compose v2. Docker Desktop supplies a Linux daemon on macOS and Windows. Run the commands below in a POSIX shell. The deployment host needs Internet access to download the release and PostgreSQL image; external tools also contact their configured providers.

The release includes native **linux/amd64** and **linux/arm64** application, agent, runner and Traefik images. No Node.js installation or local build is required. These are Docker image archives on GitHub Releases, not images to pull from a registry. They can be downloaded without a GitHub account. Images for third-party tools and isolated browsers have their own architecture requirements; availability of the core arm64 stack does not guarantee that every external tool image supports arm64.

## 1. Download and verify the deployment files

Create a new directory and download these two assets from the [2.3.1 release](https://github.com/rstlgu/paranod/releases/tag/v2.3.1):

```sh
mkdir paranod-2.3.1
cd paranod-2.3.1
curl --fail --location --proto '=https' --tlsv1.2 -O https://github.com/rstlgu/paranod/releases/download/v2.3.1/paranod-deploy-v2.3.1.tar.gz
curl --fail --location --proto '=https' --tlsv1.2 -O https://github.com/rstlgu/paranod/releases/download/v2.3.1/SHA256SUMS
awk '$2 == "paranod-deploy-v2.3.1.tar.gz" {print}' SHA256SUMS > deploy.sha256
test "$(wc -l < deploy.sha256 | tr -d ' ')" = 1
shasum -a 256 -c deploy.sha256
tar -xzf paranod-deploy-v2.3.1.tar.gz
cp .env.docker.example .env.docker
chmod 600 .env.docker
```

On Linux, `sha256sum -c deploy.sha256` is an alternative to `shasum`. Stop if the checksum check fails. The checksum verifies the downloaded asset against the release over HTTPS; it is not a separate cryptographic publisher signature.

## 2. Configure the installation

Edit `.env.docker`. Replace `POSTGRES_PASSWORD`, `WORKSPACES_RUNNER_TOKEN` and `CRON_SECRET` with **three independent random values**, generating each with `openssl rand -hex 32`. Never commit this file. Hexadecimal passwords avoid URL escaping problems in the database connection string.

Keep `PARANOD_VERSION=2.3.1`. Choose a unique `COMPOSE_PROJECT_NAME` if another Paranod installation exists on the daemon. This name identifies the database and application volumes: keep it unchanged during future updates.

The default address is `http://localhost:3002`, bound to `127.0.0.1`. For LAN access, adjust `APP_BIND_IP`, `APP_PORT`, `APP_URL` and `BETTER_AUTH_URL` together. `APP_URL` and `BETTER_AUTH_URL` must be the address used by the browser. With a remote Docker context, `127.0.0.1` means the **remote daemon host**, not the computer running this command.

The runner can create Docker containers and has access to the Docker socket. Use a trusted daemon. The database and runner do not publish host ports. Configure an HTTPS reverse proxy before exposing the web interface to an untrusted network. Local HTTP use does not prevent installing remote HTTPS addons.

Leave `DOCKER_API_VERSION` empty so Traefik can negotiate with the daemon. Missing authentication and encryption keys are generated once in the application volume. Both this volume and PostgreSQL must be backed up.

## 3. Load images and start

```sh
docker context show
docker info
./docker/load-release.sh v2.3.1
./docker/release.sh config --quiet
./docker/release.sh up -d --wait
./docker/release.sh ps
```

The loader detects the **daemon's architecture**, downloads the appropriate image archive, verifies its SHA-256 checksum and loads the three versioned images. Compose then pulls PostgreSQL 16 if necessary. `compose.release.yml` contains no build steps and never pulls the Paranod images implicitly.

Open **http://localhost:3002/setup** and create the initial administrator. Configure plugin provider keys in the application before using integrations that need them.

## 4. Optional agent

Set these values in `.env.docker`, then run `./docker/release.sh up -d --wait` again:

```dotenv
PARANOD_AGENT_WORKER_ENABLED=true
COMPOSE_PROFILES=agent
```

In **Settings → Graph agent**, configure a provider and model. A healthy worker and valid provider configuration are required. Requests use your provider account. Approval modes still apply to builtin plugins, external addons and registered container tools. For details, see [agent operations](https://github.com/rstlgu/paranod/blob/v2.3.1/docs/AGENT-OPERATIONS.md).

## Addons and maintenance

Install an addon from its personalized manifest URL in **Plugins & Addons**. No central Paranod account, public domain or inbound callback port is needed for SDK 0.5 addons supporting signed outbound polling. See the [complete addon walkthrough](https://github.com/rstlgu/paranod/blob/v2.3.1/docs/ADDON-WALKTHROUGH.md).

The prebuilt application has no external store link configured. Direct manifest installation remains available. `NEXT_PUBLIC_ADDON_STORE_URL` is a build-time setting: changing it in `.env.docker` does not change prebuilt JavaScript. To customize this link, build from source with that setting.

Use the [operations guide](https://github.com/rstlgu/paranod/blob/v2.3.1/docs/OPERATIONS.md) for updates, backups and restore. Normal `./docker/release.sh down` preserves data; adding `-v` removes the installation's named volumes.

Source builds remain supported by the [repository instructions](https://github.com/rstlgu/paranod/blob/v2.3.1/README.md#build-from-source-with-docker). Use `docker/compose.sh` for source builds and `docker/release.sh` for prebuilt releases. Both use the same data layout and configuration file.
