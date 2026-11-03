# Agent Changelog

Read by `scripts/package-installer.ps1` when it builds `agent-manifest.json` — the
top-most `## <version>` section (matching whatever version is currently in
`package.json`) becomes the release notes shown in the console's Agent Updates page.
Add a new section at the top on every version bump; never edit an already-shipped
section after the fact.

## 0.2.16
- Reports installed software straight away when an admin selects Sync now on the endpoint's Software tab,
  and after every command or deployment finishes (an uninstall no longer shows the app for up to 10 minutes).

## 0.2.15
- Safety: never applies an Application control rule that would stop Windows (.exe / .com / .scr /
  .dll extensions, the Windows folder, explorer.exe and other core programs, the agent itself), even
  if one reaches the device.
- Safety: Command blocking never touches Windows processes (only script hosts such as PowerShell and
  cmd can still be matched), skips rules that would match Windows, and stops at most 10 processes per scan.
- Safety: USB control never disables the disk holding Windows or user profiles.
- New desktop safety net: if a signed-in user's desktop doesn't start for 2 minutes while blocking rules
  are in force, the agent removes its rules, tells the user to sign in again, and the endpoint is paused.

## 0.2.14
- New: Windows signals for User risk - failed sign-ins, users added to local Administrators, cleared
  event logs, antivirus or firewall switched off, newly installed software and bursts of deleted
  files in users' folders. Makes sure failed-logon and group-change auditing is on.
- Screen capture: antivirus and EDR scanners (Kaspersky, ESET, Quick Heal, Sophos and others) reading a new
  screenshot are no longer reported as "opened by".

## 0.2.13
- The product is now called Endpoint IQ: setup, uninstall and log messages use the new name.

## 0.2.12
- Data discovery scans look for the data categories chosen on the policy (from Data types), including
  keyword lists such as "Confidentiality markers", instead of a fixed DPDP / GDPR pattern set.
- New: DLP screen capture monitoring. Screenshots saved by Windows, Snipping Tool, Game Bar, ShareX or
  admin-chosen folders are recorded the moment they appear (deleting them afterwards doesn't hide
  them), along with deletions and - through Windows file-access auditing - the programs that opened
  them. Only metadata is reported, never the image.

## 0.2.11
- Patch scans now report Microsoft's description of each missing update, shown under its
  title on the Patches page so you know why a patch is needed before dispatching it.

## 0.2.10
- New: "Scan now" on a Zero Trust policy or security benchmark makes the endpoint re-run that
  scan at its next check-in (within about 30 seconds), instead of waiting for its regular
  schedule (every 2 hours for Zero Trust).

## 0.2.9
- Fix: the installed-software list could come back empty. One malformed registry entry
  made the whole query fail; each app is now read on its own, with a reg.exe fallback if
  PowerShell can't be used at all.
- New: per-user installs (VS Code, Zoom, Teams, ... installed for one user) are listed for
  every signed-in user, not only machine-wide installs.
- New: the agent writes a log to app\logs\agent.log (administrators only), so problems on
  an endpoint can be diagnosed.

## 0.2.8
- Fix: the endpoint's IP and MAC address now come from its real network adapter. Previously
  the first adapter listed was used, which on machines with a VPN (e.g. Tailscale) or
  Hyper-V/WSL was a virtual adapter - showing the VPN IP and no MAC address at all.

## 0.2.7
- Fix: after re-enrolling (0.2.6), the agent kept sending its old, rejected identity on every
  request after the first, so the endpoint showed online once and then went offline. It now
  uses the new identity for everything.

## 0.2.6
- Fix: an endpoint that was previously enrolled against a different server (or before the
  server's database was reset) now re-enrolls by itself with its enrollment token, instead
  of being rejected forever with "Invalid agent credentials" and never appearing in the
  console. Only an identity that has never been accepted since the agent started is
  replaced - an endpoint deleted by an admin, or one being uninstalled, does not come back.

## 0.2.5
- New: LAN/WAN failover. The agent knows every address the server can be reached on (local
  IP, web URL, public IP - set under Enrollment Tokens -> Server connection details) and
  switches to the next one whenever the current address stops answering, so a laptop that
  leaves the office keeps checking in over the internet, and moves back to the local address
  within about 5 minutes of returning. The address list is refreshed from the server on every
  check-in.
- New: per-token setup files from the console carry the server addresses and the enrollment
  token, so installing needs no typing at all.

## 0.2.4
- Fixed: USB Control never re-enabled a drive it had disabled — so an approved access
  exception, removing the policy, pausing the agent, or whitelisting the drive's serial all
  left an already-blocked drive blocked. Disabled USB drives are now re-enabled once they're
  no longer meant to be blocked (checked right away when enforcement stops, then every 5
  minutes, only on endpoints that have ever enforced USB Control).
- Fixed: Web Block deleted any hosts-file entries placed after its own managed section on
  every sync. Those entries are now kept, the hosts file is only rewritten when something
  actually changed, and the DNS cache is flushed after a change so unblocks (e.g. an
  approved access exception) take effect immediately.
- Includes the 0.2.3 Data Discovery fixes below (0.2.3 was never rolled out).

## 0.2.3
- Fixed: Data Discovery never scanned any user's files. The agent runs as SYSTEM, so
  `%USERPROFILE%` (and `%APPDATA%`, `%LOCALAPPDATA%`, `%ONEDRIVE%`) expanded to SYSTEM's own
  profile and every scan read 0 files. These paths now expand once per real user profile
  on the machine, and Documents/Desktop/Pictures also cover OneDrive-redirected copies.
- New: Data Discovery now scans Word, Excel and PowerPoint files (.docx/.xlsx/.pptx), not
  only plain-text formats. PDF and legacy .doc/.xls/.ppt are still not scanned.
- Changed: Aadhaar matches must pass the Verhoeff checksum (cuts false positives such as
  the first 12 digits of a card number); up to 2000 files per policy per scan (was 500).

## 0.2.2
- Changed: Web Block and IP Block's re-assert/sync poll interval reduced from 15 minutes to
  5 minutes, so a newly-assigned policy is never more than 5 minutes away from actually
  syncing to the endpoint instead of up to 15.

## 0.2.1
- Fixed: Web Block's browser-policy step (Chrome/Edge URLBlocklist) no longer shells out
  to `powershell.exe -ExecutionPolicy Bypass -Command <script>` to write those registry
  values — that exact pattern is a heavily-flagged AV/EDR heuristic and was causing the
  sync to fail with `spawn EPERM` on endpoints with active real-time protection. It now
  uses `reg.exe add`/`reg.exe delete` directly for the same registry keys — same result,
  far less likely to be blocked. The hosts-file half of Web Block sync is unchanged.

## 0.2.0
- New: agents can now be updated in place from the console (Agent Updates page)
  without re-running the installer by hand on the endpoint. An admin picks which
  endpoints or groups to push to and clicks once; the agent downloads the new
  build, applies it, and reports success or failure back automatically.
- Fixed: uninstall.ps1 now sets its error-handling mode correctly and releases any
  assigned policies (e.g. quarantine/USB/web-block) as part of a clean uninstall,
  instead of a failure partway through silently leaving the endpoint half-removed.

## 0.1.0
- Initial release.
