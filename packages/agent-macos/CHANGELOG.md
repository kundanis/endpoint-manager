# macOS Agent Changelog

Read by `scripts/package-installer.mjs` when it builds `agent-manifest.json` — the
top-most `## <version>` section (matching whatever version is currently in
`package.json`) becomes the release notes shown in the console's Agent updates page.
Add a new section at the top on every version bump; never edit an already-shipped
section after the fact.

## 0.1.3
- Security: the agent only acts on replies signed by its server, and remembers the server's key
  from the first signed reply, so another device on the network can't pose as the server.
- Security: enrollment sends the Mac's serial number and network card, so a reinstall on the
  same Mac keeps its endpoint record and nobody can take over another endpoint by its name.
- Security: agent keys and enrollment tokens are no longer written to logs, and the log folder
  and file are readable by root only (repaired at start on existing installs).
- Security: Command blocking no longer skips commands just because they mention the agent's name.
- Security: updates are unpacked without keeping the archive's owners.
- Security: install.sh refuses to run from a folder other users can change, can read the
  enrollment token from standard input (--enrollment-token-stdin) and writes config.json readable
  by root only; uninstall.sh no longer shows the agent key in the process list.

## 0.1.2
- New: Command blocking. Harmful commands chosen in the console (deleting Time Machine backups,
  turning off Gatekeeper or the firewall, erasing disks, creating admin accounts and more) are
  stopped as soon as they start and reported to the policy's Events tab.

## 0.1.1
- The product is now called Endpoint IQ: install and uninstall messages use the new name.

## 0.1.0
- Initial release — Endpoint Hub + patch management for macOS 12 (Monterey) and later, on
  Apple silicon and Intel: enrollment, check-in, hardware/OS/installed-app inventory, remote
  command execution (bash/sh), software deployment (.pkg and self-installing shell
  scripts), macOS software-update scanning and installing via `softwareupdate`, agent
  self-update, and automatic re-enrollment when the server no longer recognises a saved
  identity. Runs as a launchd daemon (`com.endpointone.agent`) with a bundled Node.js
  runtime, so nothing has to be installed on the Mac first.
- Not yet included (a deliberate v1 scope, as for the Linux agent): Security Posture
  (security baseline, Zero Trust, EDR-lite) and Data Governance (DLP, USB control, app
  control, web/command/IP block, user productivity).
