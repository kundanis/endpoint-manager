#!/bin/bash
# Installs the Endpoint IQ Agent on this Linux machine as a systemd service.
#
# Usage (extract as root into a root-owned folder, then run from there):
#   d=$(sudo mktemp -d) && sudo tar --no-same-owner -xzf EndpointProAgentLinux.tar.gz -C "$d" &&
#   printf '%s' '<token>' | sudo bash "$d/install.sh" --server-url https://uem.example.com:4000 --enrollment-token-stdin
#   (--server-url may list several addresses, comma-separated, for LAN/WAN failover)
#   --enrollment-token-stdin reads the token from stdin (prompting when stdin is a terminal),
#   so it never appears in the process list. --enrollment-token <token> still works.
#
# What it does, in order:
#   1. Confirms it's running as root (needed for the systemd unit + apt/dnf install below), and
#      that nobody but root can modify this package's files before root runs them.
#   2. Uses the Node.js runtime bundled in this package for the machine's CPU (x64/arm64).
#      Only if that can't run here (another CPU, or a Linux too old for it) does it fall
#      back to the system Node.js 18+, installing it from the distro's own repositories.
#   3. Copies app/ into /opt/endpointpro-agent, writes app/config.json with the server
#      URL + enrollment token (mirrors the Windows agent's install.ps1 exactly - same JSON
#      shape, same "never touched again after first successful enrollment" contract).
#   4. Installs and starts the endpointpro-agent systemd service.
set -euo pipefail

INSTALL_DIR="/opt/endpointpro-agent"
SERVER_URL=""
ENROLLMENT_TOKEN=""
TOKEN_FROM_STDIN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-url) SERVER_URL="$2"; shift 2 ;;
    --enrollment-token) ENROLLMENT_TOKEN="$2"; shift 2 ;;
    --enrollment-token-stdin) TOKEN_FROM_STDIN="yes"; shift ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
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
  echo "Usage: sudo bash install.sh --server-url <url> (--enrollment-token-stdin | --enrollment-token <token>) [--install-dir <path>]" >&2
  exit 1
fi

if [[ "$EUID" -ne 0 ]]; then
  echo "This installer must be run as root (try: sudo bash install.sh ...)" >&2
  exit 1
fi

if [[ "$INSTALL_DIR" != /* || "$INSTALL_DIR" == "/" ]]; then
  echo "--install-dir must be an absolute path (not /)." >&2
  exit 1
fi

# -P: the real folder, so the ownership check below sees what will actually be read.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# Root is about to run install.sh's neighbours (the bundled node, app/). If any non-root user
# can change them - package extracted by a normal user, or into a folder someone else owns
# (e.g. a pre-created /tmp/<name>) - they could swap that code first. So the package folder
# and everything in it must be root-owned and not group/world-writable, and every parent
# folder root-owned and not writable by others (except sticky ones like /tmp).
owner_and_mode() { stat -c '%u %a' "$1" 2>/dev/null || stat -f '%u %Mp%Lp' "$1"; }
unsafe_package() {
  echo "Refusing to install: $1" >&2
  echo "Extract the package as root into a root-owned folder and run install.sh from there, e.g.:" >&2
  echo "  d=\$(sudo mktemp -d) && sudo tar --no-same-owner -xzf EndpointProAgentLinux.tar.gz -C \"\$d\" && sudo bash \"\$d/install.sh\" ..." >&2
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
NOT_ROOTS="$(find "$SCRIPT_DIR" ! -type l \( ! -user 0 -o -perm -0020 -o -perm -0002 \) -print -quit 2>/dev/null || true)"
if [[ -n "$NOT_ROOTS" ]]; then
  unsafe_package "$NOT_ROOTS is not owned by root or is writable by other users."
fi

node_ok() {
  command -v node >/dev/null && [[ "$(node -v | sed 's/^v//' | cut -d. -f1)" -ge 18 ]]
}

case "$(uname -m)" in
  x86_64 | amd64) RUNTIME_ARCH="x64" ;;
  aarch64 | arm64) RUNTIME_ARCH="arm64" ;;
  *) RUNTIME_ARCH="" ;;
esac
BUNDLED_NODE=""
if [[ -n "$RUNTIME_ARCH" && -f "$SCRIPT_DIR/runtime/node-linux-$RUNTIME_ARCH/bin/node" ]]; then
  chmod 755 "$SCRIPT_DIR/runtime/node-linux-$RUNTIME_ARCH/bin/node"
  if "$SCRIPT_DIR/runtime/node-linux-$RUNTIME_ARCH/bin/node" -e "" >/dev/null 2>&1; then
    BUNDLED_NODE="yes"
  else
    echo "The bundled Node.js can't run on this system (very old Linux?) - falling back to the system Node.js."
  fi
fi

if [[ -n "$BUNDLED_NODE" ]]; then
  echo "Using the bundled Node.js runtime ($RUNTIME_ARCH)."
else
echo "Checking for a usable Node.js runtime..."
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

# Distro repositories often carry an old Node (Ubuntu 22.04: v12), which can't run the agent.
# No third-party setup script is piped into a root shell here; the admin installs Node.js
# from a source they trust instead.
if ! node_ok; then
  echo "Could not get Node.js 18 or newer (found: $(node -v 2>/dev/null || echo none))." >&2
  echo "The Node.js bundled with this package can't run on this machine, and the system's is too old." >&2
  echo "Install Node.js 20 yourself (see https://nodejs.org/en/download), then re-run this installer." >&2
  exit 1
fi
NODE_BIN="$(command -v node)"
echo "Using Node.js at $NODE_BIN ($(node -v))"
fi

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
if [[ -n "$BUNDLED_NODE" ]]; then
  mkdir -p "$INSTALL_DIR/runtime"
  rm -rf "$INSTALL_DIR/runtime/node-linux-$RUNTIME_ARCH"
  cp -r "$SCRIPT_DIR/runtime/node-linux-$RUNTIME_ARCH" "$INSTALL_DIR/runtime/"
  chmod 755 "$INSTALL_DIR/runtime/node-linux-$RUNTIME_ARCH/bin/node"
  NODE_BIN="$INSTALL_DIR/runtime/node-linux-$RUNTIME_ARCH/bin/node"
  echo "Using Node.js at $NODE_BIN ($("$NODE_BIN" -v))"
fi
# Root-only: the agent runs as root, and app/ holds config.json (token) and .state/ (key).
# Also undoes any non-root ownership an earlier self-update left behind.
chown -R -h 0:0 "$INSTALL_DIR"
chmod -R go-w "$INSTALL_DIR"
chmod 700 "$INSTALL_DIR/app"

if [[ ! -f "$INSTALL_DIR/app/config.json" ]]; then
  # --server-url may be a comma-separated list (LAN, web URL, public IP - the order the agent
  # tries them in); serverUrl holds the first, serverUrls all of them. Node writes the JSON so
  # any character in the URL or token is escaped properly; values go in via the environment,
  # never the command line, and umask 077 makes the file 0600 from its first byte.
  (
    umask 077
    EP_SERVER_URL="$SERVER_URL" EP_ENROLLMENT_TOKEN="$ENROLLMENT_TOKEN" "$NODE_BIN" -e '
      const urls = process.env.EP_SERVER_URL.split(",").map((u) => u.trim().replace(/\/$/, "")).filter(Boolean);
      if (urls.length === 0) { console.error("--server-url has no usable address"); process.exit(1); }
      const config = { serverUrl: urls[0], serverUrls: urls, enrollmentToken: process.env.EP_ENROLLMENT_TOKEN };
      process.stdout.write(JSON.stringify(config, null, 2) + "\n");
    ' > "$INSTALL_DIR/app/config.json.tmp"
  )
  mv -f "$INSTALL_DIR/app/config.json.tmp" "$INSTALL_DIR/app/config.json"
  chmod 600 "$INSTALL_DIR/app/config.json"
fi

# Escapes a value for the right-hand side of a sed s|...|...| replacement.
sed_escape() { printf '%s' "$1" | sed -e 's/[\\|&]/\\&/g'; }

echo "Installing systemd service..."
sed \
  -e "s|__NODE_BIN__|$(sed_escape "$NODE_BIN")|g" \
  -e "s|__INSTALL_DIR__|$(sed_escape "$INSTALL_DIR")|g" \
  "$SCRIPT_DIR/endpointpro-agent.service" > /etc/systemd/system/endpointpro-agent.service
chmod 644 /etc/systemd/system/endpointpro-agent.service

systemctl daemon-reload
systemctl enable --now endpointpro-agent.service

echo ""
echo "Done. The Endpoint IQ agent is installed and running (systemd service 'endpointpro-agent')."
echo "Check status with: systemctl status endpointpro-agent"
echo "View logs with:    journalctl -u endpointpro-agent -f"
