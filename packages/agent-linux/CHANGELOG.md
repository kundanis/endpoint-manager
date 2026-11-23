# Linux Agent Changelog

Read by `scripts/package-installer.sh` when it builds `agent-manifest.json` — the
top-most `## <version>` section (matching whatever version is currently in
`package.json`) becomes the release notes shown in the console's Agent Updates page.
Add a new section at the top on every version bump; never edit an already-shipped
section after the fact.

## 0.1.6
- Security: the agent only acts on replies signed by its server, and remembers the server's key
  from the first signed reply, so another device on the network can't pose as the server.
- Security: enrollment sends the machine's serial number and network card, so a reinstall on the
  same machine keeps its endpoint record and nobody can take over another endpoint by its name.
- Security: agent keys and enrollment tokens are no longer written to logs.
- Security: updates are unpacked as root-owned files, and the install folder's ownership and
  permissions are repaired at start.
- Security: Command blocking no longer skips commands just because they mention the agent's name.
- Security: patch and package names are checked before they're passed to apt/dnf, and only
  updates found by the last scan are installed; packages run without a shell.
- Security: install.sh refuses to run from a folder other users can change, can read the
  enrollment token from standard input (--enrollment-token-stdin), writes config.json readable by
  root only and no longer falls back to installing Node.js from the internet; uninstall.sh no
  longer shows the agent key in the process list.

## 0.1.5
- New: Command blocking. Harmful commands chosen in the console (deleting logs, turning off the
  firewall, wiping disks, creating admin accounts and more) are stopped as soon as they start and
  reported to the policy's Events tab.

## 0.1.4
- Ships its own Node.js 22 runtime (x64 and arm64), so the agent no longer depends on the Linux
  machine's Node.js - an old distro Node (Ubuntu 22.04: v12) made it crash with MODULE_NOT_FOUND.
  Falls back to the system Node.js only on other CPUs or very old Linux.

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
