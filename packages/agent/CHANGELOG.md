# Agent Changelog

Read by `scripts/package-installer.ps1` when it builds `agent-manifest.json` — the
top-most `## <version>` section (matching whatever version is currently in
`package.json`) becomes the release notes shown in the console's Agent Updates page.
Add a new section at the top on every version bump; never edit an already-shipped
section after the fact.

## 0.2.41
- Fixed: uninstalling from the tray icon (with the uninstall password) did nothing. The password was
  accepted and the tray said the agent would be removed within a minute, but the removal never
  started. It now runs, and if it can't start, the tray says so instead.

## 0.2.40
- However the agent is removed (Windows' Apps list, the console, the tray icon, or its files deleted
  by hand), it first takes back everything it applied: application blocks (programs blocked by name
  no longer stay blocked), web, IP and USB blocks, screenshot blocking, AI Guard blocks, quarantine,
  Remote Desktop access, Mail Guard and the Defender exclusions a policy added. Remote Desktop is
  only turned off again if this product had turned it on.
- The server is then told, so the endpoint leaves the console and its licence is free again. If the
  PC is offline, the report waits and is sent when it is back on the network (checked every 30
  minutes). If the agent's files are deleted without uninstalling, the PC releases everything and
  reports it after 20 minutes.
- Each removal is logged in C:\ProgramData\EndpointPro\uninstall.log.

## 0.2.39
- When the PC isn't connected, the tray app says why: the licence's endpoint limit has been reached,
  the server's licence isn't active, the enrollment token was rejected, the PC was removed from the
  console, the server can't be reached or its certificate isn't trusted. The agent keeps running and
  retries every minute instead of exiting when the server refuses it.
- The tray app shows the groups the PC belongs to.
- Pause requests can be permanent (until an administrator ends them).
- Uninstall agent… in the tray icon's menu: removes the agent with the organisation's uninstall
  password (not offered when no password is set).
- The agent keeps trying to open its channel to the tray app if the port is briefly taken (after an
  update), instead of leaving the tray app showing "isn't running".

## 0.2.38
- Application allowlisting: Store apps are allowed only when Windows, Microsoft or a hardware maker
  (Dell, Intel) publishes them; other Store apps are blocked like any other program. Computer
  makers' utilities installed under Program Files (Dell, HP, Lenovo, ASUS, Acer, MSI, Microsoft
  Surface and others) are allowed with the chip and driver makers' tools.

## 0.2.37
- Application allowlisting: Windows' packaged apps (Calculator, Photos, the new Notepad, Paint and
  Snipping Tool, Terminal, Microsoft Store, the new Teams and Outlook, Clock...) keep working for
  every user - the allowlist now allows every signed packaged app, as Windows blocks them otherwise
  once program rules are enforced. Internet Explorer's launcher (signed as its own product) is
  allowed with the rest of Windows.

## 0.2.36
- Endpoint user consent: the consent window no longer opens by itself. Users open it from the tray
  icon (Privacy consent, or a click on the icon while an answer is needed), or it opens when an
  administrator selects Ask for consent in the console.
- The tray app logs an unexpected error to %LOCALAPPDATA%\EndpointIQ\tray.log and keeps running
  instead of closing.

## 0.2.35
- Endpoint user consent (DPDP): when the organisation asks for consent, the tray app shows its notice
  to each Windows user at sign-in (and on clicking the icon); the user ticks I agree and saves, or
  declines, and can change their answer later from the menu (Privacy consent). Until every signed-in
  user has agreed, the agent sends only its check-ins - no inventory, usage, screen capture, DLP or
  other monitoring data (dropped, not sent later) - and keeps applying the security policies.

## 0.2.34
- AI Guard: looks for AI add-ons every 15 minutes instead of every 6 hours (reported when something
  was installed, removed or updated), and at once when an admin selects Scan now on the AI
  Extensions page - so a removed extension disappears from the list quickly.

## 0.2.33
- AI Guard: finds AI browser extensions (Chrome, Edge), AI extensions in code editors (VS Code,
  Cursor, Windsurf, VSCodium) and command-line AI tools installed with npm, for every user on the
  PC, and reports them (names and versions only). AI browser extensions an AI Guard policy blocks
  are disabled through the browsers' extension blocklist; blocked VS Code extensions through VS
  Code's AllowedExtensions policy. Entries the organisation set itself are never removed.
- AI Guard prompt protection for AI desktop apps (ChatGPT, Claude and other AI programs): when one
  comes to the front while the clipboard holds data the policy protects, the tray app warns, takes
  the text off the clipboard, or swaps in a masked copy - as the policy says - and puts the
  original back when the user switches away. Reported with a masked sample only.

## 0.2.32
- AI Guard prompt protection: the agent gives the Endpoint IQ Browser Guard extension (Chrome and
  Edge) this endpoint's identity, so the extension can check what is pasted into, sent to or
  uploaded to AI websites against the endpoint's AI Guard policy. The extension is installed
  automatically while an AI Guard policy with prompt protection applies to the endpoint.

## 0.2.31
- Security: the agent only acts on replies signed by its server, and remembers the server's key
  from the first signed reply, so another device on the network can't pose as the server and send
  commands, scripts or updates.
- Security: enrollment sends the PC's serial number and network card, so a reinstall on the same
  PC keeps its endpoint record and nobody can take over another endpoint by its name.
- Security: Application control no longer allows programs from other folders under
  ProgramData\EndpointPro; blocked-launch reports go to the agent instead of a folder users could
  write to; the agent's folders are locked to SYSTEM and administrators (and repaired at start).
- Security: the desktop safety net only reacts when a user's desktop never started, not when a
  user closes explorer.exe.
- Security: update and helper scripts run as SYSTEM are written to the agent's locked folder, not
  Windows\Temp; install and update never open the install folder to users.
- Security: the tray talks to the agent with a per-user key, and the user name in usage,
  screenshot and pause reports comes from that key.
- Security: agent keys and enrollment tokens are no longer written to the log; setup passes the
  enrollment token and uninstall password without putting them on a command line.
- Security: installers run without cmd.exe (silent arguments with &, |, > or %VARIABLES% no longer
  work; quoted arguments do); server values in PowerShell are quoted against Unicode quote marks.

## 0.2.30
- Allowlist policies (Application control, only where the server has advanced application control):
  only Windows and what it needs (the Windows folder, Windows' own signed components such as
  Microsoft Defender, drivers' tools, Edge and WebView2, .NET, Store apps), the agent and the
  applications the policy allows can run. Every other program, and every .msi installer a user
  starts, is blocked by Windows AppLocker. Allowed applications can be common applications from a
  list, folders, publishers (with an optional product, file name and version) or exact files by
  hash. Administrators can run anything when they run it as administrator, if the policy allows it.
  Blocked attempts are reported with the program's publisher, version, hash and user. Windows Home
  doesn't enforce AppLocker and reports Failed on Sync status. Emergency release, pause, the
  desktop safety net and uninstall remove the allowlist.

## 0.2.29
- New setup without PowerShell (EndpointProAgentSetup-NoPowerShell.exe), for PCs where Group Policy
  blocks powershell.exe and the standard setup fails with "This program is blocked by group policy".
  It installs the same agent the same way (files, Windows service, folder protection, watchdog)
  without starting PowerShell. The standard setup now says plainly when PowerShell is blocked and
  points to the setup without PowerShell. The agent itself is unchanged.

## 0.2.28
- Threat Protection (only where the server has the module): the agent reports Microsoft Defender's
  status (real-time protection, signature age, last scans) and the threats Defender found, applies
  Threat Protection policies (it only ever switches protection on, never off; adds and later removes
  only its own exclusions), and runs quick, full and folder scans, signature updates and threat
  actions (remove, restore from quarantine, allow) requested from the console. Settings Windows
  refuses (Tamper Protection, Group Policy, Intune) or another active antivirus show as Failed on
  Sync status. Uninstall removes the exclusions the agent added.

## 0.2.27
- Advanced application control (only where the server has it switched on): the agent turns DLL
  rules, Allow (exception) rules and the script and installer file types (.ps1, .bat, .cmd, .vbs,
  .js, .msi) into Windows AppLocker rules, so Windows itself blocks them, including when run from an
  open Command Prompt or PowerShell window or from a scheduled task. Rules apply to signed-in users,
  not to Windows services or the agent. A company's own AppLocker rules are kept. Blocks show on the
  Events tab; if Windows can't enforce a rule, Sync status shows Failed with the reason. The desktop
  safety net, emergency release, pause and uninstall remove the agent's AppLocker rules.

## 0.2.26
- Microsoft Defender no longer quarantines the agent's own data files. Defender's machine-learning
  scan could flag the App Control rules file (a list of the programs your policies block) as a
  trojan, such as "Trojan:Win32/Cammando.B!ml", and remove it, which stopped App Control until the
  next sync. The agent now excludes its data folder (app\.state, data only, not its programs) from
  Defender scanning and checks it every 6 hours; uninstalling removes the exclusion. Where Defender's
  exclusions are managed by Intune or Group Policy, add the folder there instead.

## 0.2.25
- Data movement: files are recorded the moment they land on a USB drive, cloud-sync folder or mapped
  network drive, with where they came from (copied or moved from a folder on the PC) and the user
  signed in. Old files copied today are now caught too: arrival is judged by when the file was
  created or moved there, not its last-modified date. Cloud-sync folders and mapped drives are found
  for every signed-in user, not the service account.
- Screenshot blocking (EPM): on PCs with a screenshot-blocking policy, Print Screen, Win+Shift+S and
  similar keys do nothing, screenshot tools (Snipping Tool, ShareX, Greenshot, Lightshot and others)
  are closed when they open, Snipping Tool, Game Bar capture and Edge's web capture are turned off,
  and optionally any picture copied to the clipboard is removed. The user is told each time, and each
  attempt is reported. Everything is put back when the policy no longer applies.
- Screen capture: when a policy keeps screenshot images for this PC, each new screenshot is read the
  moment it appears and uploaded to the server (images only, up to 15 MB; screen recordings never).

## 0.2.24
- User productivity: the Endpoint IQ icon records the time each user spends in each application and,
  in Chrome, Edge, Firefox, Brave, Opera and Vivaldi, on each website (domain only), while they
  aren't idle. Reported every 5 minutes. Window titles and page addresses are never collected.

## 0.2.23
- Runs as the Windows service "Endpoint IQ Agent" (automatic start, restarted if it stops) instead of
  a hidden scheduled task. Existing endpoints move to the service by themselves after this update.
- Endpoint IQ icon in the notification area for every signed-in user: connection status, last sync,
  Sync now, and the EPM and DLP policies on the PC.
- Users can ask to pause one or more of those policies for 15 minutes to 1 day, with a reason. The
  request appears on Access exceptions for an administrator to approve or reject, and the user is
  notified of the answer.

## 0.2.22
- Installs the Endpoint IQ Mail Guard browser extension in Chrome and Edge from their stores while an
  Email attachment blocking policy is in use (users can't remove or disable it), and removes it
  when none is. Starts once the store IDs are added on the server.

## 0.2.21
- Sets the server address for the Endpoint IQ Mail Guard browser extension (Chrome and Edge) through
  browser policy, so the extension always reports to this agent's server and the user can't change it.

## 0.2.20
- Command blocking: protections from the console's list are enforced the moment a command starts
  (by the same process watcher as Application control); the 20-second check stays as a backstop.
  The desktop safety net no longer weakens them; Emergency release still turns them off.
- Command blocking never touches anything the agent itself started (deployments, scripts).

## 0.2.19
- Application control: a program-name rule such as AnyDesk.exe also catches renamed copies of
  programs that store no original file name, by their product name or description ("AnyDesk").
- If the process watcher can't run, every sync closes matching programs instead, and the policy's
  Sync status shows Failed with the reason (also logged to app-control-watcher.log on the device).

## 0.2.18
- Application control now really blocks on Windows 11 (Windows ignores the Software Restriction
  Policy rules earlier agents wrote; they are removed). A program named in a rule is stopped before
  it opens and the user sees a message; renamed copies, other versions and the new Product name /
  Publisher rules are closed the moment they start. Every block is reported to the policy's Activity.
- Self-update also runs on laptops on battery (the update used to wait at "applying").
- Application control and Command blocking report after every sync, for the policies' new Sync status tab.

## 0.2.17
- Application control now reports each blocked program (from the Windows event log) to the policy's
  Activity tab and the endpoint page, instead of always showing no activity.

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
