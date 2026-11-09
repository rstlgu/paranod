# Operate a self-hosted release

Commands below use the prebuilt distribution's `docker/release.sh`. For a source deployment, replace that wrapper with `docker/compose.sh`; building from source additionally requires `up -d --build`. Work in the installation directory and inspect `docker context show` and `docker info` before changing Docker resources.

## Identify an installation

Keep its `.env.docker`, exact release version and `COMPOSE_PROJECT_NAME`. The project name determines the database, application volume and network. Versioned prebuilt images can be shared across projects; persistent data remains separate. `APP_URL` and `BETTER_AUTH_URL` must match the browser-facing origin.

```sh
./docker/release.sh ps
./docker/release.sh logs --tail=100 app
./docker/release.sh --profile agent logs --tail=100 agent-worker
```

Avoid publishing logs, expanded Compose configuration or backups: they can contain investigation data or credentials. Normal `down` preserves volumes. Do not use `down -v` for maintenance or upgrades.

## Back up

Choose a maintenance window. Wait for investigations, flows and addon jobs to finish, then stop writes before taking the snapshot. The following procedure copies both PostgreSQL and `/var/lib/paranod`, including encryption keys and uploaded files. It also saves the configuration containing any explicitly supplied keys.

```sh
umask 077
backup_dir="$PWD/backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir/app-data"
./docker/release.sh --profile agent stop agent-worker app
./docker/release.sh exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_dir/database.dump"
./docker/release.sh cp app:/var/lib/paranod/. "$backup_dir/app-data"
cp .env.docker compose.release.yml "$backup_dir/"
printf '%s\n' 'Paranod 2.3.0; PostgreSQL 16' > "$backup_dir/VERSION.txt"
./docker/release.sh up -d --wait
```

Execute these commands one at a time and check their exit status. If dumping or copying fails, keep the partial backup separate, restart the services with `up -d --wait` and repeat the backup after resolving the error. Check that `database.dump` is nonempty and inspect its directory using `pg_restore --list` before archiving it. A successful backup also needs a restore test.

Keep the directory private and copy it to encrypted storage on a different device. Protect the `.env.docker` file and application volume together. Losing encryption keys can make stored credentials and files unreadable even if the SQL database survives. Copying only PostgreSQL is insufficient. Update `VERSION.txt` to the actual version when using this procedure for a later release.

## Restore into a separate installation

Restore first into a new project, using an unused port and **the same Paranod release and PostgreSQL major version** as the backup. Do not overwrite a running installation. Download that release's deployment bundle into a new directory and load its images.

Copy the saved `.env.docker` into this directory as `.env.restore`. Preserve passwords, tokens and encryption secrets, but change `COMPOSE_PROJECT_NAME` to a unique name and change `APP_PORT`, `APP_URL` and `BETTER_AUTH_URL` consistently. Leave `DATABASE_URL` and `DIRECT_URL` unset for the bundled PostgreSQL service; external overrides could otherwise select the original database.

```sh
export PARANOD_ENV_FILE=.env.restore
# Set this to the absolute path of the complete backup.
backup_dir=/absolute/path/to/backup
./docker/release.sh config --quiet
./docker/release.sh up -d --wait postgres
./docker/release.sh exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --exit-on-error' < "$backup_dir/database.dump"
./docker/release.sh create --no-build app
./docker/release.sh cp "$backup_dir/app-data/." app:/var/lib/paranod/
./docker/release.sh up -d --wait
./docker/release.sh ps
```

The database must be empty before `pg_restore`. If restoration fails, investigate the separate restore project; do not retry against production. Check that users, saved graphs, files and provider settings are present. Verify the worker if enabled. After confirming the restore, plan any address switch separately. `unset PARANOD_ENV_FILE` when finished, so later commands return to their usual configuration.

The release workflow exercises this procedure with a synthetic database record and application file, comparing persistent key hashes before and after restoration on both supported CPU architectures. It does not send requests to an AI model or validate a real investigation.

## Update a prebuilt installation

1. Read the target release notes and take a verified backup of the current version, configuration and application volume.
2. Download and verify the target deployment bundle into a separate directory. Compare its Compose file and example configuration with the installed version before copying changes. Preserve `.env.docker`, project name, volume names, keys and local settings; never replace them with the example file.
3. Run `./docker/load-release.sh vMAJOR.MINOR.PATCH` for the target version. Set `PARANOD_VERSION` in `.env.docker` to the same numeric version. Use the Compose file supplied by that release.
4. Stop active work, then run `./docker/release.sh --profile agent stop agent-worker app`, `./docker/release.sh config --quiet` and `./docker/release.sh up -d --wait`.
5. Check service status, login, a saved graph, plugin settings and the agent worker. The application applies versioned database migrations during startup. Preserve the previous release assets and backup until verification is complete.

Do not run two application versions against the same database during an update. This first tagged distribution uses the same volume layout as earlier snapshots of this **OSS repository**, so they can adopt the prebuilt Compose file while preserving the project name. This is not a migration procedure for another distribution of Paranod.

A database migration may not be reversible. If an update fails, restore the pre-update backup with its original image version into a separate project; do not assume that selecting an older image reverses database changes. Never use schema reset or destructive synchronization to repair a production migration.
