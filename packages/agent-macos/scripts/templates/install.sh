#!/bin/bash
# Installs the Endpoint IQ agent on this Mac as a launchd daemon.
#
# Usage (extract as root into a root-owned folder, then run from there):
#   d=$(sudo mktemp -d /tmp/EndpointProAgentMac.XXXXXX) && sudo tar --no-same-owner -xzf EndpointProAgentMac.tar.gz -C "$d" &&
#   printf '%s' '<token>' | sudo bash "$d/install.sh" --server-url https://uem.example.com:4443 --enrollment-token-stdin
#   (--server-url may list several addresses, comma-separated, for LAN/WAN failover)
#   --enrollment-token-stdin reads the token from stdin (prompting when stdin is a terminal),
#   so it never appears in the process list. --enrollment-token <token> still works.
#   Optional: --ca-cert <file.pem>  trust a private CA / self-signed server certificate
#
# What it does, in order:
#   1. Confirms it's running as root (needed for /Library/LaunchDaemons), and that nobody but
#      root can modify this package's files before root runs them.
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
TOKEN_FROM_STDIN=""
CA_CERT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-url) SERVER_URL="$2"; shift 2 ;;
    --enrollment-token) ENROLLMENT_TOKEN="$2"; shift 2 ;;
    --enrollment-token-stdin) TOKEN_FROM_STDIN="yes"; shift ;;
    --ca-cert) CA_CERT="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -n "$TOKEN_FROM_STDIN" ]]; then
  if [[ -t 0 ]]; then
    read -rsp "Enrollment token: " ENROLLMENT_TOKEN || true
    echo
  else
    IFS= read -r ENROLLMENT_TOKEN || true
  fi
  ENROLLMENT_TOKEN="${ENROLLMENT_TOKEN//[[:space:]]/}"
fi

if [[ -z "$SERVER_URL" || -z "$ENROLLMENT_TOKEN" ]]; then
  echo "Usage: sudo bash install.sh --server-url <url> (--enrollment-token-stdin | --enrollment-token <token>) [--ca-cert <file.pem>]" >&2
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

# -P: the real folder (/tmp is /private/tmp), so the ownership check sees what will be read.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# Root is about to run install.sh's neighbours (the bundled node, app/). If any non-root user
# can change them - package extracted by a normal user, or into a folder someone else owns
# (e.g. a pre-created /tmp/<name>) - they could swap that code first. So the package folder
# and everything in it must be root-owned and not group/world-writable, and every parent
# folder root-owned and not writable by others (except sticky ones like /tmp).
owner_and_mode() { stat -f '%u %Mp%Lp' "$1"; }
unsafe_package() {
  echo "Refusing to install: $1" >&2
  echo "Extract the package as root into a root-owned folder and run install.sh from there, e.g.:" >&2
  echo "  d=\$(sudo mktemp -d /tmp/EndpointProAgentMac.XXXXXX) && sudo tar --no-same-owner -xzf EndpointProAgentMac.tar.gz -C \"\$d\" && sudo bash \"\$d/install.sh\" ..." >&2
  exit 1
}
read -r OWNER MODE <<< "$(owner_and_mode "$SCRIPT_DIR")"
if [[ "$OWNER" != "0" ]] || (( 8#$MODE & 8#022 )); then
  unsafe_package "$SCRIPT_DIR is not owned by root or is writable by other users."
fi
CHECK_DIR="$SCRIPT_DIR"
while [[ "$CHECK_DIR" != "/" ]]; do
  CHECK_DIR="$(dirname "$CHECK_DIR")"
  read -r OWNER MODE <<< "$(owner_and_mode "$CHECK_DIR")"
  if [[ "$OWNER" != "0" ]] || { (( 8#$MODE & 8#022 )) && ! (( 8#$MODE & 8#1000 )); }; then
    unsafe_package "the parent folder $CHECK_DIR is not owned by root or is writable by other users."
  fi
done
NOT_ROOTS="$(find "$SCRIPT_DIR" ! -type l \( ! -user 0 -o -perm -0020 -o -perm -0002 \) -print 2>/dev/null | sed -n 1p || true)"
if [[ -n "$NOT_ROOTS" ]]; then
  unsafe_package "$NOT_ROOTS is not owned by root or is writable by other users."
fi

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
mkdir -p "$INSTALL_DIR/app"
# app/ holds config.json (token) and .state/ (agent key): root-only from the start.
chown root:wheel "$INSTALL_DIR" "$INSTALL_DIR/app"
chmod 755 "$INSTALL_DIR"
chmod 700 "$INSTALL_DIR/app"
rm -rf "$INSTALL_DIR/app/dist" "$INSTALL_DIR/app/node_modules" "$INSTALL_DIR/node"
cp -R "$SCRIPT_DIR/app/." "$INSTALL_DIR/app/"
cp -R "$RUNTIME_DIR" "$INSTALL_DIR/node"
cp "$SCRIPT_DIR/uninstall.sh" "$INSTALL_DIR/uninstall.sh"
chmod 755 "$INSTALL_DIR/node/bin/node" "$INSTALL_DIR/uninstall.sh"
# A package downloaded with a browser carries the quarantine flag onto everything unpacked
# from it; launchd would refuse to run the quarantined node binary.
xattr -dr com.apple.quarantine "$INSTALL_DIR" 2>/dev/null || true

if [[ ! -f "$INSTALL_DIR/app/config.json" ]]; then
  # --server-url may be a comma-separated list (LAN, web URL, public IP - the order the agent
  # tries them in); serverUrl holds the first, serverUrls all of them. The bundled node writes
  # the JSON so any character in the URL or token is escaped properly; values go in via the
  # environment, never the command line, and umask 077 makes the file 0600 from its first byte.
  (
    umask 077
    EP_SERVER_URL="$SERVER_URL" EP_ENROLLMENT_TOKEN="$ENROLLMENT_TOKEN" "$INSTALL_DIR/node/bin/node" -e '
      const urls = process.env.EP_SERVER_URL.split(",").map((u) => u.trim().replace(/\/$/, "")).filter(Boolean);
      if (urls.length === 0) { console.error("--server-url has no usable address"); process.exit(1); }
      const config = { serverUrl: urls[0], serverUrls: urls, enrollmentToken: process.env.EP_ENROLLMENT_TOKEN };
      process.stdout.write(JSON.stringify(config, null, 2) + "\n");
    ' > "$INSTALL_DIR/app/config.json.tmp"
  )
  mv -f "$INSTALL_DIR/app/config.json.tmp" "$INSTALL_DIR/app/config.json"
fi

if [[ -n "$CA_CERT" ]]; then
  mkdir -p "$INSTALL_DIR/app/certs-trust"
  cp "$CA_CERT" "$INSTALL_DIR/app/certs-trust/dev-server-public.pem"
fi

chown -R root:wheel "$INSTALL_DIR"
chmod 755 "$INSTALL_DIR"
chmod 700 "$INSTALL_DIR/app"
chmod 600 "$INSTALL_DIR/app/config.json"

# launchd appends the daemon's stdout/stderr here as root: keep it root-only (logs written
# before redaction may hold secrets). Also tightens a 0755 folder / 0644 file from older installs.
mkdir -p "$LOG_DIR"
touch "$LOG_DIR/agent.log"
chown root:wheel "$LOG_DIR" "$LOG_DIR/agent.log"
chmod 700 "$LOG_DIR"
chmod 600 "$LOG_DIR/agent.log"

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
echo "View logs with:    sudo tail -f $LOG_DIR/agent.log"
echo "Uninstall with:    sudo $INSTALL_DIR/uninstall.sh"
