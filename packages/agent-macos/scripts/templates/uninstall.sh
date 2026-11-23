#!/bin/bash
# Uninstalls the Endpoint IQ agent from this Mac.
#
# Usage: sudo /Library/EndpointProAgent/uninstall.sh
set -uo pipefail

INSTALL_DIR="/Library/EndpointProAgent"
LOG_DIR="/Library/Logs/EndpointProAgent"
LABEL="com.endpointone.agent"
PLIST_PATH="/Library/LaunchDaemons/$LABEL.plist"

if [[ "$EUID" -ne 0 ]]; then
  echo "This script must be run as root (try: sudo $0)" >&2
  exit 1
fi

echo "Stopping the agent..."
launchctl bootout "system/$LABEL" 2>/dev/null || true

# Best-effort self-report to the server (see confirmAgentUninstalled server-side) so the
# Agent row - and its license seat - is freed immediately instead of lingering as an
# "offline" row. Must run before the install dir is removed, since config.json/state.json
# live inside it. Any failure here is swallowed - local removal proceeds regardless.
CONFIG_PATH="$INSTALL_DIR/app/config.json"
STATE_PATH="$INSTALL_DIR/app/.state/state.json"
CA_PATH="$INSTALL_DIR/app/certs-trust/dev-server-public.pem"
if [[ -f "$CONFIG_PATH" && -f "$STATE_PATH" ]]; then
  SERVER_URL="$(grep -o '"serverUrl"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_PATH" | sed -E 's/.*"([^"]+)"$/\1/')"
  AGENT_ID="$(grep -o '"agentId"[[:space:]]*:[[:space:]]*"[^"]*"' "$STATE_PATH" | sed -E 's/.*"([^"]+)"$/\1/')"
  API_KEY="$(grep -o '"apiKey"[[:space:]]*:[[:space:]]*"[^"]*"' "$STATE_PATH" | sed -E 's/.*"([^"]+)"$/\1/')"
  if [[ -n "$SERVER_URL" && -n "$AGENT_ID" && -n "$API_KEY" ]]; then
    CURL_CA=()
    [[ -f "$CA_PATH" ]] && CURL_CA=(--cacert "$CA_PATH")
    # Headers go through a root-only file (curl -H @file, 7.55+), not the command line, where
    # any local user could read the agent key from the process list.
    HEADER_FILE="$(umask 077 && mktemp)"
    printf 'X-Agent-Id: %s\nX-Agent-Key: %s\n' "$AGENT_ID" "$API_KEY" > "$HEADER_FILE"
    curl -s -m 10 "${CURL_CA[@]+"${CURL_CA[@]}"}" -X POST "$SERVER_URL/api/agent/uninstalled" \
      -H "@$HEADER_FILE" >/dev/null 2>&1 || true
    rm -f "$HEADER_FILE"
  fi
fi

echo "Removing the launchd daemon..."
rm -f "$PLIST_PATH"

echo "Removing $INSTALL_DIR and $LOG_DIR ..."
rm -rf "$INSTALL_DIR" "$LOG_DIR"

echo ""
echo "Endpoint IQ agent uninstalled."
