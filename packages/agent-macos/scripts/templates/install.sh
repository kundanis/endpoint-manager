#!/bin/bash
# Installs the Endpoint IQ agent on this Mac as a launchd daemon.
#
# Usage:
#   sudo bash install.sh --server-url https://uem.example.com:4443 --enrollment-token <token>
#   (--server-url may list several addresses, comma-separated, for LAN/WAN failover)
#   Optional: --ca-cert <file.pem>  trust a private CA / self-signed server certificate
#
# What it does, in order:
#   1. Confirms it's running as root (needed for /Library/LaunchDaemons).
#   2. Picks the bundled Node.js runtime for this Mac (Apple silicon or Intel) - nothing is
#      downloaded or installed system-wide.
#   3. Copies app/ and the runtime into /Library/EndpointProAgent and writes app/config.json
#      with the server URL + enrollment token (same JSON shape and "never touched again after
#      first enrollment" rule as the Windows and Linux agents).
#   4. Installs and starts the com.endpointone.agent launchd daemon.
set -euo pipefail

INSTALL_DIR="/Library/EndpointProAgent"
LOG_DIR="/Library/Logs/EndpointProAgent"
LABEL="com.endpointone.agent"
PLIST_PATH="/Library/LaunchDaemons/$LABEL.plist"
SERVER_URL=""
ENROLLMENT_TOKEN=""
CA_CERT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-url) SERVER_URL="$2"; shift 2 ;;
    --enrollment-token) ENROLLMENT_TOKEN="$2"; shift 2 ;;
    --ca-cert) CA_CERT="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$SERVER_URL" || -z "$ENROLLMENT_TOKEN" ]]; then
  echo "Usage: sudo bash install.sh --server-url <url> --enrollment-token <token> [--ca-cert <file.pem>]" >&2
  exit 1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This is the macOS installer - use the Linux or Windows installer on other systems." >&2
  exit 1
fi

if [[ "$EUID" -ne 0 ]]; then
  echo "This installer must be run as root (try: sudo bash install.sh ...)" >&2
  exit 1
fi

if [[ -n "$CA_CERT" && ! -f "$CA_CERT" ]]; then
  echo "CA certificate not found: $CA_CERT" >&2
  exit 1
fi

OS_MAJOR="$(sw_vers -productVersion | cut -d. -f1)"
if [[ "$OS_MAJOR" -lt 12 ]]; then
  echo "macOS 12 (Monterey) or later is required; this Mac runs $(sw_vers -productVersion)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# hw.optional.arm64 is 1 on Apple silicon even when this shell runs under Rosetta (where
# `uname -m` would say x86_64), so the native runtime is always chosen.
if [[ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" == "1" ]]; then
  ARCH="arm64"
else
  ARCH="x64"
fi
RUNTIME_DIR="$SCRIPT_DIR/runtime/node-darwin-$ARCH"
if [[ ! -x "$RUNTIME_DIR/bin/node" && ! -f "$RUNTIME_DIR/bin/node" ]]; then
  echo "The bundled Node.js runtime for $ARCH is missing from this package ($RUNTIME_DIR)." >&2
  exit 1
fi
echo "Using the bundled Node.js runtime for $ARCH."

# Re-running this script updates an existing install in place, but never touches an
# already-enrolled config.json or .state/ (the package never contains either).
if launchctl print "system/$LABEL" >/dev/null 2>&1; then
  echo "Stopping the existing agent..."
  launchctl bootout "system/$LABEL" 2>/dev/null || true
fi

echo "Installing to $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR/app" "$LOG_DIR"
rm -rf "$INSTALL_DIR/app/dist" "$INSTALL_DIR/app/node_modules" "$INSTALL_DIR/node"
cp -R "$SCRIPT_DIR/app/." "$INSTALL_DIR/app/"
cp -R "$RUNTIME_DIR" "$INSTALL_DIR/node"
cp "$SCRIPT_DIR/uninstall.sh" "$INSTALL_DIR/uninstall.sh"
chmod 755 "$INSTALL_DIR/node/bin/node" "$INSTALL_DIR/uninstall.sh"
# A package downloaded with a browser carries the quarantine flag onto everything unpacked
# from it; launchd would refuse to run the quarantined node binary.
xattr -dr com.apple.quarantine "$INSTALL_DIR" 2>/dev/null || true

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
fi

if [[ -n "$CA_CERT" ]]; then
  mkdir -p "$INSTALL_DIR/app/certs-trust"
  cp "$CA_CERT" "$INSTALL_DIR/app/certs-trust/dev-server-public.pem"
fi

chown -R root:wheel "$INSTALL_DIR"
chmod 755 "$INSTALL_DIR"
chmod 700 "$INSTALL_DIR/app"
chmod 600 "$INSTALL_DIR/app/config.json"

# --use-system-ca makes Node trust certificates in the macOS keychain too (e.g. a company
# CA pushed by MDM). Only added when this runtime supports it, so the daemon can't fail on
# an unknown flag.
NODE_FLAGS=""
if "$INSTALL_DIR/node/bin/node" --use-system-ca -e "" >/dev/null 2>&1; then
  NODE_FLAGS="    <string>--use-system-ca</string>\n"
fi

echo "Installing the launchd daemon..."
sed \
  -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
  -e "s|__LOG_DIR__|$LOG_DIR|g" \
  "$SCRIPT_DIR/$LABEL.plist" | awk -v flags="$NODE_FLAGS" '
    /^__NODE_FLAGS__/ { sub(/^__NODE_FLAGS__/, ""); gsub(/\\n/, "\n", flags); printf "%s", flags }
    { print }
  ' > "$PLIST_PATH"
chown root:wheel "$PLIST_PATH"
chmod 644 "$PLIST_PATH"
plutil -lint "$PLIST_PATH" >/dev/null

launchctl bootstrap system "$PLIST_PATH"
launchctl enable "system/$LABEL"
launchctl kickstart -k "system/$LABEL" 2>/dev/null || true

echo ""
echo "Done. The Endpoint IQ agent is installed and running (launchd daemon '$LABEL')."
echo "Check status with: sudo launchctl print system/$LABEL | head -20"
echo "View logs with:    tail -f $LOG_DIR/agent.log"
echo "Uninstall with:    sudo $INSTALL_DIR/uninstall.sh"
