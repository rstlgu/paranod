#!/bin/sh
set -eu

if [ -z "${BETTER_AUTH_SECRET:-}" ]; then
  auth_state_dir="${AUTH_STATE_DIR:-/var/lib/paranod}"
  auth_secret_file="$auth_state_dir/auth-secret"
  mkdir -p "$auth_state_dir"
  umask 077

  if [ ! -s "$auth_secret_file" ]; then
    openssl rand -base64 48 > "$auth_secret_file"
    echo "[paranod] Generated a persistent local authentication secret."
  fi

  BETTER_AUTH_SECRET="$(tr -d '\r\n' < "$auth_secret_file")"
  export BETTER_AUTH_SECRET
fi

if [ -z "${TEMP_FILE_ENCRYPTION_KEY:-}" ]; then
  file_state_dir="${AUTH_STATE_DIR:-/var/lib/paranod}"
  file_secret_path="$file_state_dir/temp-file-key"
  mkdir -p "$file_state_dir"
  umask 077
  if [ ! -s "$file_secret_path" ]; then
    openssl rand -base64 32 > "$file_secret_path"
    echo "[paranod] Generated a persistent file encryption key."
  fi
  TEMP_FILE_ENCRYPTION_KEY="$(tr -d '\r\n' < "$file_secret_path")"
  export TEMP_FILE_ENCRYPTION_KEY
fi

if [ -z "${SECRETS_ENCRYPTION_KEY:-}" ]; then
  secrets_key_file="${AUTH_STATE_DIR:-/var/lib/paranod}/secrets-encryption-key"
  mkdir -p "$(dirname "$secrets_key_file")"
  umask 077
  if [ ! -s "$secrets_key_file" ]; then
    openssl rand -base64 32 > "$secrets_key_file"
    echo "[paranod] Generated a persistent secrets encryption key."
  fi
  SECRETS_ENCRYPTION_KEY="$(tr -d '\r\n' < "$secrets_key_file")"
  export SECRETS_ENCRYPTION_KEY
fi

if [ -z "${CRON_SECRET:-}" ]; then
  cron_secret_file="${AUTH_STATE_DIR:-/var/lib/paranod}/cron-secret"
  mkdir -p "$(dirname "$cron_secret_file")"
  umask 077
  if [ ! -s "$cron_secret_file" ]; then
    openssl rand -base64 48 > "$cron_secret_file"
    echo "[paranod] Generated a persistent local maintenance secret."
  fi
  CRON_SECRET="$(tr -d '\r\n' < "$cron_secret_file")"
  export CRON_SECRET
fi

echo "[paranod] Waiting for DB..."

if [ -n "${DATABASE_URL:-}" ]; then
  i=0
  until node -e '
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    prisma.$queryRawUnsafe("SELECT 1")
      .then(() => prisma.$disconnect())
      .then(() => process.exit(0))
      .catch(async () => {
        await prisma.$disconnect().catch(() => {});
        process.exit(1);
      });
  ' >/dev/null 2>&1; do
    i=$((i+1))
    if [ "$i" -gt 60 ]; then
      echo "[paranod] Timeout while waiting for the database"
      exit 1
    fi
    sleep 1
  done
fi

# Apply the versioned schema, including database integrity constraints.
# Existing installations of this repository upgrade through additive migrations.
echo "[paranod] Applying database migrations..."
./node_modules/.bin/prisma migrate deploy

echo "[paranod] Starting Next.js and maintenance worker..."
node node_modules/next/dist/bin/next start -H 0.0.0.0 -p 3000 &
app_pid=$!
node docker/maintenance.mjs &
maintenance_pid=$!

cleanup() {
  kill "$app_pid" "$maintenance_pid" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

set +e
wait "$app_pid"
status=$?
set -e
exit "$status"
