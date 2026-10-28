#!/bin/sh
set -eu

if [ "${PARANOD_AGENT_WORKER_ENABLED:-false}" != "true" ]; then
  echo "[agent] Worker disabled."
  exit 0
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[agent] Database configuration is required." >&2
  exit 1
fi

# Only the web entrypoint owns migrations, maintenance and key generation.
# Its healthy state guarantees this read-only volume has been initialized.
if [ -z "${SECRETS_ENCRYPTION_KEY:-}" ]; then
  secrets_key_file="${AUTH_STATE_DIR:-/var/lib/paranod}/secrets-encryption-key"
  if [ ! -r "$secrets_key_file" ] || [ ! -s "$secrets_key_file" ]; then
    echo "[agent] Shared encryption key unavailable; start the web service first." >&2
    exit 1
  fi
  SECRETS_ENCRYPTION_KEY="$(tr -d '\r\n' < "$secrets_key_file")"
  if [ -z "$SECRETS_ENCRYPTION_KEY" ]; then
    echo "[agent] Shared encryption key is empty." >&2
    exit 1
  fi
  export SECRETS_ENCRYPTION_KEY
fi

if [ -z "${TEMP_FILE_ENCRYPTION_KEY:-}" ]; then
  file_key_path="${AUTH_STATE_DIR:-/var/lib/paranod}/temp-file-key"
  if [ ! -r "$file_key_path" ] || [ ! -s "$file_key_path" ]; then
    echo "[agent] Shared file key unavailable; start the web service first." >&2
    exit 1
  fi
  TEMP_FILE_ENCRYPTION_KEY="$(tr -d '\r\n' < "$file_key_path")"
  if [ -z "$TEMP_FILE_ENCRYPTION_KEY" ]; then
    echo "[agent] Shared file key is empty." >&2
    exit 1
  fi
  export TEMP_FILE_ENCRYPTION_KEY
fi

exec node dist/agent-worker.cjs
