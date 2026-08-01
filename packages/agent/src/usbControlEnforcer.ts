import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import type { AssignedUsbControlResponse, UsbControlEventPayload, UsbControlSyncResultPayload } from "@em/shared";

const execFileAsync = promisify(execFile);

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
// enough to make the volume inaccessible; this does not proactively re-enable a
// previously-disabled device once its serial is later whitelisted (it would need to be
// unplugged and reinserted) — a deliberate v1 simplification, same spirit as this
// codebase's other heuristic-not-exhaustive enforcement mechanisms.
function buildScanScript(allowedSerials: string[]): string {
  const allowedLiteral = allowedSerials.map((s) => `'${psEscape(s)}'`).join(", ");

  return `
$ErrorActionPreference = 'SilentlyContinue'
$allowed = @(${allowedLiteral})

$events = @()
$disks = Get-CimInstance Win32_DiskDrive | Where-Object { $_.InterfaceType -eq 'USB' }

foreach ($disk in $disks) {
  $pnp = $disk.PNPDeviceID
  if ([string]::IsNullOrEmpty($pnp)) { continue }
  $parts = $pnp -split '\\\\'
  $serialPart = $parts[$parts.Length - 1]
  $serial = ($serialPart -split '&')[0]

  if ($allowed -notcontains $serial) {
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

  if (assigned.policyIds.length === 0) return;

  let events: UsbControlEventPayload[] = [];
  let syncPayload: UsbControlSyncResultPayload;
  try {
    const script = buildScanScript(assigned.allowedSerials);
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
