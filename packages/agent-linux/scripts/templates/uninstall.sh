#!/bin/bash
# Uninstalls the Endpoint Pro Agent from this Linux machine.
#
# Usage: sudo ./uninstall.sh
set -uo pipefail

INSTALL_DIR="/opt/endpointpro-agent"

if [[ "$EUID" -ne 0 ]]; then
  echo "This script must be run as root (try: sudo ./uninstall.sh)" >&2
  exit 1
fi

echo "Stopping endpointpro-agent service..."
systemctl stop endpointpro-agent.service 2>/dev/null || true
systemctl disable endpointpro-agent.service 2>/dev/null || true

# Best-effort self-report to the server (see confirmAgentUninstalled server-side, and the
# Windows agent's identical buildUninstallAgentScript) so the Agent row - and its license
# seat - is freed immediately instead of lingering forever as an unreachable "offline" row.
# Must run BEFORE the install dir is removed below, since config.json/state.json live inside
# it. Any failure here (offline, server down, files missing) is swallowed - local removal
# proceeds regardless.
CONFIG_PATH="$INSTALL_DIR/app/config.json"
STATE_PATH="$INSTALL_DIR/app/.state/state.json"
if [[ -f "$CONFIG_PATH" && -f "$STATE_PATH" ]] && command -v curl >/dev/null; then
  SERVER_URL="$(grep -o '"serverUrl"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_PATH" | sed -E 's/.*"([^"]+)"$/\1/')"
  AGENT_ID="$(grep -o '"agentId"[[:space:]]*:[[:space:]]*"[^"]*"' "$STATE_PATH" | sed -E 's/.*"([^"]+)"$/\1/')"
  API_KEY="$(grep -o '"apiKey"[[:space:]]*:[[:space:]]*"[^"]*"' "$STATE_PATH" | sed -E 's/.*"([^"]+)"$/\1/')"
  if [[ -n "$SERVER_URL" && -n "$AGENT_ID" && -n "$API_KEY" ]]; then
    curl -s -m 10 -X POST "$SERVER_URL/api/agent/uninstalled" \
      -H "X-Agent-Id: $AGENT_ID" -H "X-Agent-Key: $API_KEY" >/dev/null 2>&1 || true
  fi
fi

echo "Removing systemd service..."
rm -f /etc/systemd/system/endpointpro-agent.service
systemctl daemon-reload 2>/dev/null || true

echo "Removing $INSTALL_DIR ..."
rm -rf "$INSTALL_DIR"

echo ""
echo "Endpoint Pro agent uninstalled."
