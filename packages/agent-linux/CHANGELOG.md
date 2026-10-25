# Linux Agent Changelog

Read by `scripts/package-installer.sh` when it builds `agent-manifest.json` — the
top-most `## <version>` section (matching whatever version is currently in
`package.json`) becomes the release notes shown in the console's Agent Updates page.
Add a new section at the top on every version bump; never edit an already-shipped
section after the fact.

## 0.1.3
- Installer: when the system's own Node.js package is too old (Ubuntu 22.04 ships v12), installs
  Node.js 20 from NodeSource instead of setting the agent up on a runtime that can't start it.

## 0.1.2
- The product is now called Endpoint IQ: install and uninstall messages use the new name.

## 0.1.1
- Re-enrolls automatically when the server no longer recognises this agent's saved
  identity (e.g. the server was reinstalled), instead of failing every check-in.
- Reports the IP and MAC of the real network adapter, skipping VPN, Docker and other
  virtual adapters.
- Supports several server addresses with automatic failover (LAN, web URL, public IP).
- Fix: the package now includes zod, which the agent needs at runtime; without it the
  service failed to start.

## 0.1.0
- Initial release — Core Endpoint Manager + Patch Management for Linux (Debian/Ubuntu
  via apt, RHEL/CentOS/Fedora via dnf or yum): enrollment, check-in, hardware/OS/
  installed-package inventory, remote command execution (bash/sh), software deployment
  (.deb/.rpm/self-installing shell scripts), OS package patch scanning and installing,
  and agent self-update via systemd. Runs as a systemd service (`endpointpro-agent`)
  rather than a Windows Scheduled Task.
- Not yet included (a deliberate v1 scoping decision, not a gap to be assumed fixed by a
  later version bump without checking): Security Manager (security config baseline,
  Zero Trust, EDR-lite) and Data Manager (DLP, USB control, app control, web/command/IP
  block, user productivity) — see the Windows agent for those.
