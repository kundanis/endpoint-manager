#!/bin/bash
# Installs the Endpoint IQ Agent on this Linux machine as a systemd service.
#
# Usage:
#   sudo ./install.sh --server-url https://uem.example.com:4000 --enrollment-token <token>
#   (--server-url may list several addresses, comma-separated, for LAN/WAN failover)
#
# What it does, in order:
#   1. Confirms it's running as root (needed for the systemd unit + apt/dnf install below).
#   2. Confirms a usable Node.js (>=18) is present, installing it via the detected package
#      manager (apt/dnf/yum) if it isn't - this agent relies on the target's own system
#      Node rather than bundling a portable runtime (see package-installer.sh).
#   3. Copies app/ into /opt/endpointpro-agent, writes app/config.json with the server
#      URL + enrollment token (mirrors the Windows agent's install.ps1 exactly - same JSON
#      shape, same "never touched again after first successful enrollment" contract).
#   4. Installs and starts the endpointpro-agent systemd service.
set -euo pipefail

INSTALL_DIR="/opt/endpointpro-agent"
SERVER_URL=""
ENROLLMENT_TOKEN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-url) SERVER_URL="$2"; shift 2 ;;
    --enrollment-token) ENROLLMENT_TOKEN="$2"; shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$SERVER_URL" || -z "$ENROLLMENT_TOKEN" ]]; then
  echo "Usage: sudo ./install.sh --server-url <url> --enrollment-token <token> [--install-dir <path>]" >&2
  exit 1
fi

if [[ "$EUID" -ne 0 ]]; then
  echo "This installer must be run as root (try: sudo ./install.sh ...)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Checking for a usable Node.js runtime..."
node_ok() {
  command -v node >/dev/null && [[ "$(node -v | sed 's/^v//' | cut -d. -f1)" -ge 18 ]]
}

if ! node_ok; then
  echo "Node.js >=18 not found — attempting to install it via this system's package manager..."
  if command -v apt-get >/dev/null; then
    apt-get update
    apt-get install -y nodejs
  elif command -v dnf >/dev/null; then
    dnf install -y nodejs
  elif command -v yum >/dev/null; then
    yum install -y nodejs
  else
    echo "No supported package manager (apt/dnf/yum) found to install Node.js automatically." >&2
    echo "Install Node.js 18+ yourself (see https://nodejs.org), then re-run this installer." >&2
    exit 1
  fi
fi

# Distro repositories often carry an old Node (Ubuntu 22.04: v12), which can't run the agent
# (it fails with MODULE_NOT_FOUND on "node:" imports). Fall back to NodeSource's Node 20.
if ! node_ok; then
  echo "The system's Node.js ($(node -v 2>/dev/null || echo none)) is older than 18 — installing Node.js 20 from NodeSource..."
  if ! command -v curl >/dev/null; then
    if command -v apt-get >/dev/null; then apt-get install -y curl; elif command -v dnf >/dev/null; then dnf install -y curl; else yum install -y curl; fi
  fi
  if command -v apt-get >/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif command -v dnf >/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    dnf install -y nodejs
  else
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    yum install -y nodejs
  fi
fi

if ! node_ok; then
  echo "Could not get Node.js 18 or newer (found: $(node -v 2>/dev/null || echo none))." >&2
  echo "Install Node.js 20 yourself (see https://nodejs.org/en/download), then re-run this installer." >&2
  exit 1
fi
NODE_BIN="$(command -v node)"
echo "Using Node.js at $NODE_BIN ($(node -v))"

# Stop any existing install first (re-running this script updates an existing enrollment's
# app code in place, same override-in-place behavior install.ps1 has) — but never touch an
# already-enrolled config.json/state.json, matching the Windows agent's identity-preservation
# rule exactly (see agent-manifest.json's packaging notes for why this matters for
# self-update too: the packaged tarball never contains either file).
if systemctl list-unit-files endpointpro-agent.service >/dev/null 2>&1; then
  echo "Stopping existing endpointpro-agent service..."
  systemctl stop endpointpro-agent.service || true
fi

echo "Installing to $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"
cp -r "$SCRIPT_DIR/app" "$INSTALL_DIR/"

# --server-url may be a comma-separated list (LAN, web URL, public IP - the order the agent
# tries them in); serverUrl holds the first, serverUrls all of them.
SERVER_URLS_JSON=""
FIRST_SERVER_URL=""
IFS=',' read -ra SERVER_URL_LIST <<< "$SERVER_URL"
for url in "${SERVER_URL_LIST[@]}"; do
  url="$(echo "$url" | xargs)"
  url="${url%/}"
  [[ -z "$url" ]] && continue
  [[ -z "$FIRST_SERVER_URL" ]] && FIRST_SERVER_URL="$url"
  SERVER_URLS_JSON="${SERVER_URLS_JSON:+$SERVER_URLS_JSON, }\"$url\""
done

if [[ ! -f "$INSTALL_DIR/app/config.json" ]]; then
  cat > "$INSTALL_DIR/app/config.json" << EOF
{
  "serverUrl": "$FIRST_SERVER_URL",
  "serverUrls": [$SERVER_URLS_JSON],
  "enrollmentToken": "$ENROLLMENT_TOKEN"
}
EOF
  chmod 600 "$INSTALL_DIR/app/config.json"
fi

echo "Installing systemd service..."
sed \
  -e "s|__NODE_BIN__|$NODE_BIN|g" \
  -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
  "$SCRIPT_DIR/endpointpro-agent.service" > /etc/systemd/system/endpointpro-agent.service

systemctl daemon-reload
systemctl enable --now endpointpro-agent.service

echo ""
echo "Done. The Endpoint IQ agent is installed and running (systemd service 'endpointpro-agent')."
echo "Check status with: systemctl status endpointpro-agent"
echo "View logs with:    journalctl -u endpointpro-agent -f"
