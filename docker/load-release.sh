#!/bin/sh
# Download verified release images for the selected Linux Docker daemon.
set -eu
PARANOD_TAG="${1:-v2.3.1}"
if ! printf '%s\n' "$PARANOD_TAG" | LC_ALL=C grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Usage: $0 vMAJOR.MINOR.PATCH" >&2
  exit 1
fi
command -v curl >/dev/null
if command -v sha256sum >/dev/null 2>&1; then
  PARANOD_HASH_TOOL=sha256sum
elif command -v shasum >/dev/null 2>&1; then
  PARANOD_HASH_TOOL=shasum
else
  echo "Install sha256sum or shasum to verify the download." >&2
  exit 1
fi
PARANOD_DOCKER_CONTEXT=$(docker context show)
printf 'Docker context: %s\n' "$PARANOD_DOCKER_CONTEXT"
docker info --format '{{.Name}} {{.OSType}} {{.Architecture}}'
[ "$(docker info --format '{{.OSType}}')" = linux ] || {
  echo "A Linux Docker daemon is required (including Docker Desktop)." >&2; exit 1;
}
case "$(docker info --format '{{.Architecture}}')" in
  x86_64|amd64) PARANOD_ARCH=amd64 ;;
  aarch64|arm64) PARANOD_ARCH=arm64 ;;
  *) echo "No release image for this Docker architecture." >&2; exit 1 ;;
esac
PARANOD_ASSET="paranod-images-$PARANOD_TAG-linux-$PARANOD_ARCH.tar.gz"
PARANOD_DOWNLOAD_DIR=$(mktemp -d)
trap 'rm -rf "$PARANOD_DOWNLOAD_DIR"' EXIT HUP INT TERM
PARANOD_RELEASE_URL="https://github.com/rstlgu/paranod/releases/download/$PARANOD_TAG"
curl --fail --location --proto '=https' --tlsv1.2 --retry 3 \
  "$PARANOD_RELEASE_URL/SHA256SUMS" -o "$PARANOD_DOWNLOAD_DIR/SHA256SUMS"
curl --fail --location --proto '=https' --tlsv1.2 --retry 3 \
  "$PARANOD_RELEASE_URL/$PARANOD_ASSET" -o "$PARANOD_DOWNLOAD_DIR/$PARANOD_ASSET"
(
  cd "$PARANOD_DOWNLOAD_DIR"
  awk -v asset="$PARANOD_ASSET" '$2 == asset {print}' SHA256SUMS > selected.sha256
  [ "$(wc -l < selected.sha256 | tr -d ' ')" = 1 ] || {
    echo "Missing or ambiguous release checksum." >&2; exit 1;
  }
  if [ "$PARANOD_HASH_TOOL" = sha256sum ]; then
    sha256sum -c selected.sha256
  else
    shasum -a 256 -c selected.sha256
  fi
  [ "$(docker context show)" = "$PARANOD_DOCKER_CONTEXT" ] || {
    echo "Docker context changed during download; refusing to load images." >&2; exit 1;
  }
  docker info --format '{{.Name}} {{.OSType}} {{.Architecture}}'
  docker load -i "$PARANOD_ASSET"
)
printf '[paranod] Loaded %s for linux/%s. Set PARANOD_VERSION=%s in .env.docker.\n' \
  "$PARANOD_TAG" "$PARANOD_ARCH" "${PARANOD_TAG#v}"
