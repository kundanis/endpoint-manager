#!/bin/bash
# Builds the self-installing Linux agent tarball (mirrors packages/agent/scripts/
# package-installer.ps1's structure exactly, adapted for tar/systemd instead of
# zip/Scheduled-Tasks). The official nodejs.org runtime is bundled for x64 and arm64
# (checked against nodejs.org's SHASUMS256.txt), so the agent never depends on the Linux
# machine's own Node - distro packages are often too old (Ubuntu 22.04 ships v12).
# NODE_VERSION overrides the bundled version; downloads are cached in dist-installer/.node-cache.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$AGENT_DIR/../.." && pwd)"
SHARED_DIR="$REPO_ROOT/packages/shared"
TEMPLATES_DIR="$SCRIPT_DIR/templates"

echo "Building @em/shared and @em/agent-linux..."
(cd "$REPO_ROOT" && npm run build -w @em/shared)
(cd "$REPO_ROOT" && npm run build -w @em/agent-linux)

DIST_INSTALLER_DIR="$AGENT_DIR/dist-installer"
STAGING_ROOT="$DIST_INSTALLER_DIR/EndpointProAgentLinux"
rm -rf "$STAGING_ROOT"
mkdir -p "$STAGING_ROOT"

echo "Staging app files..."
APP_DIR="$STAGING_ROOT/app"
mkdir -p "$APP_DIR/dist"
cp -r "$AGENT_DIR/dist/." "$APP_DIR/dist/"

# Pure grep/sed rather than `node -e "require(...)"` - avoids a Node dependency at
# packaging time for a one-line field read (Node itself needs the freshly-built dist/
# from the build step above just to start, which is otherwise unrelated to this line).
read_json_version() {
  grep -m1 '"version"' "$1" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
}

AGENT_VERSION="$(read_json_version "$AGENT_DIR/package.json")"

# Minimal, not the real package.json (no scripts/devDependencies needed at runtime) - same
# synthetic-package.json convention package-installer.ps1 uses, and for the exact same
# reason here: config.ts's readAgentVersion() reads "../package.json" once installed, so
# Agent.agentVersion always matches what agent-manifest.json (built below) says the package
# actually is.
cat > "$APP_DIR/package.json" << EOF
{
  "name": "endpoint-pro-agent-linux-deployment",
  "version": "$AGENT_VERSION",
  "private": true,
  "main": "dist/index.js"
}
EOF

echo "Resolving runtime dependencies..."
APP_NODE_MODULES="$APP_DIR/node_modules"
mkdir -p "$APP_NODE_MODULES"
DEPS_STAGING_DIR="$DIST_INSTALLER_DIR/.deps-staging"
rm -rf "$DEPS_STAGING_DIR"
mkdir -p "$DEPS_STAGING_DIR"

get_installed_version() {
  read_json_version "$REPO_ROOT/node_modules/$1/package.json"
}

AXIOS_VERSION="$(get_installed_version axios)"
SYSTEMINFORMATION_VERSION="$(get_installed_version systeminformation)"
# @em/shared requires zod at runtime (its schemas), so it must ship too.
ZOD_VERSION="$(get_installed_version zod)"

cat > "$DEPS_STAGING_DIR/package.json" << EOF
{
  "name": "endpoint-pro-agent-linux-runtime-deps",
  "private": true,
  "dependencies": {
    "axios": "$AXIOS_VERSION",
    "systeminformation": "$SYSTEMINFORMATION_VERSION",
    "zod": "$ZOD_VERSION"
  }
}
EOF

(cd "$DEPS_STAGING_DIR" && npm install --omit=dev --no-audit --no-fund --no-package-lock)
cp -r "$DEPS_STAGING_DIR/node_modules/." "$APP_NODE_MODULES/"
rm -rf "$DEPS_STAGING_DIR"

# @em/shared isn't a real npm-published package - hand-build the node_modules entry
# require("@em/shared") needs, mirroring the workspace symlink the agent uses in dev mode
# (same trick package-installer.ps1 uses for the Windows agent).
SHARED_DEST="$APP_NODE_MODULES/@em/shared"
mkdir -p "$SHARED_DEST"
cp -r "$SHARED_DIR/dist" "$SHARED_DEST/dist"
cp "$SHARED_DIR/package.json" "$SHARED_DEST/package.json"

NODE_VERSION="${NODE_VERSION:-v22.23.2}"
NODE_CACHE_DIR="$DIST_INSTALLER_DIR/.node-cache"
mkdir -p "$NODE_CACHE_DIR"
echo "Fetching the Node.js $NODE_VERSION runtime for Linux..."
SHASUMS="$(curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt")"
for NODE_ARCH in x64 arm64; do
  NODE_FILE="node-$NODE_VERSION-linux-$NODE_ARCH.tar.gz"
  EXPECTED="$(printf '%s\n' "$SHASUMS" | awk -v f="$NODE_FILE" '$2 == f { print $1 }')"
  if [[ -z "$EXPECTED" ]]; then echo "$NODE_FILE is not listed in SHASUMS256.txt" >&2; exit 1; fi
  CACHED="$NODE_CACHE_DIR/$NODE_FILE"
  if [[ ! -f "$CACHED" ]] || [[ "$(sha256sum "$CACHED" | cut -d' ' -f1)" != "$EXPECTED" ]]; then
    echo "Downloading $NODE_FILE..."
    curl -fsSL -o "$CACHED" "https://nodejs.org/dist/$NODE_VERSION/$NODE_FILE"
    if [[ "$(sha256sum "$CACHED" | cut -d' ' -f1)" != "$EXPECTED" ]]; then
      echo "$NODE_FILE: SHA-256 does not match nodejs.org's SHASUMS256.txt" >&2
      rm -f "$CACHED"
      exit 1
    fi
  else
    echo "Using cached $NODE_FILE"
  fi
  RUNTIME_DEST="$STAGING_ROOT/runtime/node-linux-$NODE_ARCH"
  mkdir -p "$RUNTIME_DEST/bin"
  NODE_ROOT="node-$NODE_VERSION-linux-$NODE_ARCH"
  tar --force-local -xzf "$CACHED" -C "$RUNTIME_DEST" --strip-components=1 "$NODE_ROOT/bin/node" "$NODE_ROOT/LICENSE"
  chmod 755 "$RUNTIME_DEST/bin/node" 2>/dev/null || true
done

echo "Staging install/uninstall scripts and systemd unit template..."
cp "$TEMPLATES_DIR/install.sh" "$STAGING_ROOT/"
cp "$TEMPLATES_DIR/uninstall.sh" "$STAGING_ROOT/"
cp "$TEMPLATES_DIR/endpointpro-agent.service" "$STAGING_ROOT/"
chmod +x "$STAGING_ROOT/install.sh" "$STAGING_ROOT/uninstall.sh"

echo "Building tarball..."
TARBALL_PATH="$DIST_INSTALLER_DIR/EndpointProAgentLinux.tar.gz"
rm -f "$TARBALL_PATH"
# Entries are owned by root (0:0), not this Windows user's UID (e.g. 197613): root extracting
# with owners preserved would otherwise hand the install tree to whatever local account has
# that UID. go-w for the same reason (the agent and install.sh also refuse/repair it).
tar --owner=0 --group=0 --numeric-owner --mode=go-w -czf "$TARBALL_PATH" -C "$STAGING_ROOT" .

# This exact tarball (config.json/.state are never staged into it - see above) doubles as
# the self-update payload: the server streams it as-is from
# config.agentInstallerTarballPathLinux, and the agent extracts it directly over an existing
# install (see selfUpdater.ts). The manifest tells both the console (what's staged, what
# changed) and the agent (expected checksum before it trusts the download) about THIS exact
# tarball - same convention as the Windows agent's agent-manifest.json.
echo "Writing agent-manifest.json..."
TARBALL_HASH="$(sha256sum "$TARBALL_PATH" | cut -d' ' -f1)"
TARBALL_SIZE="$(stat -c%s "$TARBALL_PATH" 2>/dev/null || stat -f%z "$TARBALL_PATH")"

CHANGELOG_PATH="$AGENT_DIR/CHANGELOG.md"
SECTION_HEADER="## $AGENT_VERSION"
if ! grep -qF "$SECTION_HEADER" "$CHANGELOG_PATH"; then
  echo "CHANGELOG.md has no '$SECTION_HEADER' section - add one before packaging version $AGENT_VERSION." >&2
  exit 1
fi
# Print from the matching header up to (excluding) the next "## " header, or EOF.
RELEASE_NOTES="$(awk -v header="$SECTION_HEADER" '
  $0 == header { found=1; print; next }
  found && /^## / { exit }
  found { print }
' "$CHANGELOG_PATH")"
# Trim trailing blank lines.
RELEASE_NOTES="$(printf '%s' "$RELEASE_NOTES" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')"

BUILT_AT="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"

# Escapes a string for embedding as a JSON string value: backslash and double-quote first
# (order matters - escaping quotes before backslashes would double-escape the backslashes
# that step just introduced), then real newlines/tabs to their \n/\t escape sequences.
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk '{printf "%s\\n", $0}' | sed -e '$ s/\\n$//' -e 's/\t/\\t/g'
}

cat > "$DIST_INSTALLER_DIR/agent-manifest.json" << EOF
{"version":"$(json_escape "$AGENT_VERSION")","sha256":"$(json_escape "$TARBALL_HASH")","fileSizeBytes":$TARBALL_SIZE,"releaseNotes":"$(json_escape "$RELEASE_NOTES")","builtAt":"$(json_escape "$BUILT_AT")"}
EOF

echo ""
echo "Installer tarball created: $TARBALL_PATH"
echo "Manifest created: $DIST_INSTALLER_DIR/agent-manifest.json"
