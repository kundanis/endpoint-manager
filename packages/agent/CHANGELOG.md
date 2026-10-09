# Agent Changelog

Read by `scripts/package-installer.ps1` when it builds `agent-manifest.json` — the
top-most `## <version>` section (matching whatever version is currently in
`package.json`) becomes the release notes shown in the console's Agent Updates page.
Add a new section at the top on every version bump; never edit an already-shipped
section after the fact.

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
