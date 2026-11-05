# macOS Agent Changelog

Read by `scripts/package-installer.mjs` when it builds `agent-manifest.json` — the
top-most `## <version>` section (matching whatever version is currently in
`package.json`) becomes the release notes shown in the console's Agent updates page.
Add a new section at the top on every version bump; never edit an already-shipped
section after the fact.

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
