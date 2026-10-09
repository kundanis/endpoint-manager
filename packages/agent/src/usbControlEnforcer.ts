import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import type { AssignedUsbControlResponse, UsbControlEventPayload, UsbControlSyncResultPayload } from "@em/shared";
import { agentConfig } from "./config";

const execFileAsync = promisify(execFile);

// Written the first time this endpoint enforces any USB Control policy; its presence is what
// makes the no-policy re-enable pass worth running at all (see runUsbControlScan).
const enforcedMarkerPath = () => path.join(agentConfig.stateDir, "usb-control-enforced");
const RE_ENABLE_PASS_INTERVAL_MS = 5 * 60 * 1000;
let lastRunEnforced = false;
let lastReEnablePassAt = 0;

function psEscape(value: string): string {
  return value.replace(/'/g, "''");
}

interface RawEvent {
  SerialNumber: string;
  DeviceDescription: string | null;
  Action: "DISABLED";
  OccurredAt: string;
}

// A USB mass-storage device's PNPDeviceID looks like
// USBSTOR\DISK&VEN_...&PROD_...&REV_...\<SERIAL>&0 — the serial is the segment after the
// last backslash, up to its first '&'. Disabling the disk-drive PnP device instance is
// enough to make the volume inaccessible.
//
// Re-enabling runs first, every time: a disabled disk unloads its driver and drops out of
// Win32_DiskDrive, but stays in Win32_PnPEntity with ConfigManagerErrorCode 22 (disabled).
// Any such present USBSTOR disk is re-enabled when it's no longer meant to be blocked —
// its serial is now allowed, or no USB Control policy applies at all (policy removed,
// access exception approved, or agent paused). Without this, an exception or a newly
// whitelisted serial never un-blocked a drive the agent had already disabled.
function buildScanScript(allowedSerials: string[], enforce: boolean): string {
  const allowedLiteral = allowedSerials.map((s) => `'${psEscape(s)}'`).join(", ");

  return `
$ErrorActionPreference = 'SilentlyContinue'
$allowed = @(${allowedLiteral})
$enforce = $${enforce ? "true" : "false"}

function Get-UsbSerial($pnp) {
  $parts = $pnp -split '\\\\'
  return ($parts[$parts.Length - 1] -split '&')[0]
}

$disabledUsbDisks = Get-CimInstance Win32_PnPEntity -Filter "PNPClass='DiskDrive' AND ConfigManagerErrorCode=22" |
  Where-Object { $_.PNPDeviceID -like 'USBSTOR\\*' }
foreach ($dev in $disabledUsbDisks) {
  if (-not $enforce -or $allowed -contains (Get-UsbSerial $dev.PNPDeviceID)) {
    Enable-PnpDevice -InstanceId $dev.PNPDeviceID -Confirm:$false -ErrorAction SilentlyContinue
  }
}

$events = @()
if (-not $enforce) { Write-Output '[]'; return }

$disks = Get-CimInstance Win32_DiskDrive | Where-Object { $_.InterfaceType -eq 'USB' }

foreach ($disk in $disks) {
  $pnp = $disk.PNPDeviceID
  if ([string]::IsNullOrEmpty($pnp)) { continue }
  $serial = Get-UsbSerial $pnp

  if ($allowed -notcontains (Get-UsbSerial $pnp)) {
    Disable-PnpDevice -InstanceId $pnp -Confirm:$false -ErrorAction SilentlyContinue
    $events += [PSCustomObject]@{
      SerialNumber = $serial
      DeviceDescription = $disk.Model
      Action = 'DISABLED'
      OccurredAt = (Get-Date).ToUniversalTime().ToString('o')
    }
  }
}

if ($events.Count -eq 0) {
  Write-Output '[]'
} else {
  Write-Output (ConvertTo-Json -InputObject $events -Compress -Depth 3)
}
`;
}

// Never throws — same discipline as every other EPM enforcer. Reports both a
// lastSyncedAt/Status health snapshot (like IP Block) AND an append-only event per disabled
// device (like Command Block), since unlike IP Block's firewall-rule assertion, a device
// being disabled IS a well-defined, directly-attributable occurrence.
export async function runUsbControlScan(client: AxiosInstance): Promise<void> {
  if (process.platform !== "win32") return;

  let assigned: AssignedUsbControlResponse;
  try {
    const { data } = await client.get<AssignedUsbControlResponse>("/api/agent/usb-control/assigned");
    assigned = data;
  } catch (err) {
    console.error("Failed to fetch assigned USB Control rules", err);
    return;
  }

  // No policy applies (none assigned, an access exception, or paused): nothing to block and
  // no sync result to report — but drives disabled while a policy applied must come back.
  // Only endpoints that have ever enforced USB Control need that, and most never have, so
  // this doesn't spawn PowerShell every 20s fleet-wide: immediately when enforcement just
  // stopped, then every few minutes (a blocked stick plugged back in later still recovers).
  if (assigned.policyIds.length === 0) {
    const justStopped = lastRunEnforced;
    lastRunEnforced = false;
    if (!fs.existsSync(enforcedMarkerPath())) return;
    if (!justStopped && Date.now() - lastReEnablePassAt < RE_ENABLE_PASS_INTERVAL_MS) return;
    lastReEnablePassAt = Date.now();
    try {
      await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", buildScanScript([], false)],
        { maxBuffer: 1024 * 1024 },
      );
    } catch (err) {
      console.error("USB Control re-enable pass failed", err);
    }
    return;
  }

  lastRunEnforced = true;
  if (!fs.existsSync(enforcedMarkerPath())) {
    try {
      fs.mkdirSync(agentConfig.stateDir, { recursive: true });
      fs.writeFileSync(enforcedMarkerPath(), new Date().toISOString());
    } catch (err) {
      console.error("Failed to write USB Control marker", err);
    }
  }

  let events: UsbControlEventPayload[] = [];
  let syncPayload: UsbControlSyncResultPayload;
  try {
    const script = buildScanScript(assigned.allowedSerials, true);
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { maxBuffer: 1024 * 1024 },
    );

    const parsed: unknown = JSON.parse(stdout.trim() || "[]");
    // PowerShell 5.1's ConvertTo-Json unwraps a single-element array into a bare object.
    const rawEvents = (Array.isArray(parsed) ? parsed : [parsed]) as RawEvent[];
    events = rawEvents
      .filter((e) => e && e.SerialNumber)
      .map((e) => ({
        serialNumber: e.SerialNumber,
        deviceDescription: e.DeviceDescription ?? null,
        action: "DISABLED" as const,
        occurredAt: e.OccurredAt,
      }));
    syncPayload = { policyIds: assigned.policyIds, status: "SUCCESS", errorMessage: null };
  } catch (err) {
    console.error("USB Control scan failed", err);
    syncPayload = {
      policyIds: assigned.policyIds,
      status: "FAILED",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    await client.post("/api/agent/usb-control/sync-result", syncPayload);
  } catch (err) {
    console.error("Failed to report USB Control sync result", err);
  }

  if (events.length === 0) return;

  try {
    await client.post("/api/agent/usb-control/events", { events });
    console.log(`Reported ${events.length} USB Control event(s)`);
  } catch (err) {
    console.error("Failed to report USB Control events", err);
  }
}
