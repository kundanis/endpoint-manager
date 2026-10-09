# AV / EDR exclusions for Endpoint Pro Agent

Give this to a customer's IT/security team — for every endpoint before or right after
installing the agent, and for any existing fleet retroactively. It's a standing prerequisite
now, not a per-incident fix: without it, some agent features intermittently fail on machines
with active behavioral AV/EDR protection (confirmed root cause — see below), silently and
without the endpoint showing as unhealthy.

**All current customers run Kaspersky** — the Kaspersky section below is the complete,
primary path and is where to actually send people today. The other vendor sections exist so
this doc doesn't need rewriting the day a future customer runs something else; skip them
until that's actually true.

## What to exclude

| What | Value |
|---|---|
| Install folder | `C:\ProgramData\EndpointPro\Agent\` (recursive) |
| Main process | `C:\ProgramData\EndpointPro\Agent\node\node.exe` |
| Scheduled Tasks | `EndpointProAgent`, `EndpointProWatchdog`, `EndpointProSelfUpdateHelper` (the last one is created transiently during a self-update and removes itself after) |

## What kind of exclusion — this matters

This needs a **"trusted application" / process-behavior exclusion**, not a plain file-scan
exclusion. The confirmed failure mode is the agent's `node.exe` being denied permission to
**spawn** child processes (`powershell.exe`, `reg.exe`) it needs for routine management
tasks — a behavioral/process-creation control, not a malware file detection. Whatever
product is in use, look for a setting that lets a specific trusted process spawn children
without being restricted by behavior monitoring / HIPS / anti-ransomware protection, applied
to `node.exe` at the exact path above (not `node.exe` in general — that's far too broad to
ask for).

### Kaspersky Endpoint Security (primary — every current customer)

Apply this once, fleet-wide, via a policy in **Kaspersky Security Center** — not per
machine. If different customer entities are managed under separate KSC
tenants/administration groups, this needs doing once per tenant.

1. In the KSC Web Console, go to **Devices → Policies & profiles**.
2. Open the policy applied to the administration group that contains the customer's
   Windows endpoints (ideally the group/policy covering the whole fleet, so this only
   needs doing once — not a policy scoped to a single test machine).
3. Go to **Application settings → Threats and Exclusions → Trusted Applications**.
4. Click **Add**, and configure:
   - **Executable file**: `C:\ProgramData\EndpointPro\Agent\node\node.exe`
     (path-based, not by hash/signature — the same relative path is used on every
     endpoint since the installer always installs to this fixed location)
   - Under the exclusion's scope, enable:
     - **Do not monitor application activity** — exempts it from Behavior
       Detection/System Watcher process-creation restrictions; this is the setting
       that actually matters, confirmed against the reproduced failure
     - **Do not inherit restrictions of the parent process**
   - Leave file scanning of the install folder itself alone unless you also want a
     separate scan exclusion for it (optional, not required for this specific failure —
     don't conflate this with a plain file-scan exclusion, which won't fix it on its
     own).
5. **Save** the policy.
6. Force it to push out now rather than waiting for the normal sync interval: **Devices →
   Managed devices**, select the affected devices (or the whole group), and use **Force
   synchronization** / **Send update**.
7. Confirm on one endpoint afterward: the Trusted Applications list should show the entry
   under **Settings → Threats and Exclusions** in the local Kaspersky client (Path A from
   the build-machine walkthrough, if you want to eyeball it) — if it's greyed out there,
   that's expected; it means it's locked to the policy, which is correct.

### Microsoft Defender for Endpoint / Defender Antivirus (future customers only)

- **Antivirus exclusions**: Settings → Virus & threat protection → Exclusions → add the
  install folder as a **Folder** exclusion.
- **Attack Surface Reduction (ASR) rules**: if any ASR rule blocking process creation from
  scripts/Office/etc. is enabled, add `node.exe` at the path above to that rule's exclusion
  list (Intune: Endpoint security → Attack surface reduction → the specific rule →
  Exclusions).
- **Controlled Folder Access**: if enabled, add `node.exe` at the path above to the allowed
  apps list.

### CrowdStrike Falcon (future customers only)

- Falcon console → **Host setup and management → Sensor visibility exclusions** (or
  **File exclusions**, depending on version) → add the install folder path.
- If Falcon's behavioral prevention policies are blocking process creation specifically, an
  **IOA (Indicator of Attack) exclusion** scoped to `node.exe` at this path may be needed
  instead of/in addition to a file exclusion — this is the process-creation-blocking
  equivalent of Kaspersky's "do not monitor application activity".

### SentinelOne (future customers only)

- Console → **Exclusions** → add an exclusion of type **Path**, scope **Interoperability +
  Performance + Firewall** (not just "Files" — a files-only exclusion won't cover the
  spawn-blocking symptom), targeting the install folder.

### Other products not listed here

Look for the same underlying concept regardless of vendor terminology: a way to mark
`C:\ProgramData\EndpointPro\Agent\node\node.exe` as a **trusted process allowed to create
child processes without behavioral restriction** — variously called "trusted application",
"process exclusion", "IOA/behavioral exclusion", or "allow child process creation" depending
on the product. A plain file/malware-scan exclusion alone is usually not sufficient for this
specific symptom.

## How to tell if an endpoint needs this

Symptom: a Web Block or IP Block policy assignment shows `lastSyncStatus: FAILED` with
`lastSyncError` containing `spawn EPERM` (Console → EPM → the policy → check its
assignments), or any other agent feature that shells out to `powershell.exe`/`reg.exe`
silently stops working on one specific endpoint while checkins keep succeeding normally.
Since almost every agent feature (inventory, patch scanning, USB control, App Control,
command execution, etc.) uses the same process-spawning mechanism, an endpoint hitting this
for one feature is very likely to hit it for others too, even if only one has surfaced so
far — apply the exclusion proactively, not just for the specific feature that happened to
be noticed first.

## Rolling this out

- **Existing fleet**: this is a per-customer action, since each customer manages their own
  AV/EDR — there's no way for Endpoint Manager itself to push a security-product exclusion
  remotely. Send this document to each affected customer's IT/security contact and ask them
  to apply it fleet-wide, not just to the one endpoint that happened to show symptoms.
- **New deployments**: this should be a standard pre-install or immediately-post-install
  step from now on, not something discovered reactively per incident — see the reference
  added to `docs/fresh-deployment.md`.
