#!/bin/sh
# Compose entry point for the published, prebuilt images.
set -eu
cd "$(dirname "$0")/.."
ENV_FILE="${PARANOD_ENV_FILE:-.env.docker}"
if [ ! -f "$ENV_FILE" ]; then
  echo "[paranod] Missing '$ENV_FILE'. Copy .env.docker.example and configure it." >&2
  exit 1
fi
exec docker compose --env-file "$ENV_FILE" -f compose.release.yml "$@"
