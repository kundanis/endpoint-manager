import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import type { AgentUpdateStatusPayload, AgentUpdateTaskWire } from "@em/shared";
import { agentConfig } from "./config";
import { getServerUrl } from "./httpClient";
import { ensureSecureDir, psEscape, writeWorkFile } from "./secureFs";

const execFileAsync = promisify(execFile);

const SERVICE_NAME = "EndpointIQAgent";
const LEGACY_AGENT_TASK_NAME = "EndpointProAgent"; // agents before 0.2.23 ran as this scheduled task
const WATCHDOG_TASK_NAME = "EndpointProWatchdog";
const HELPER_TASK_NAME = "EndpointProSelfUpdateHelper";

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

// __dirname/../.. from the compiled dist/ location (app/dist/../.. = the install root,
// sibling of node/) — same derivation watchdogGuard.ts already uses for the same reason.
function getInstallDir(): string {
  return path.join(__dirname, "..", "..");
}

async function downloadUpdatePackage(client: AxiosInstance, task: AgentUpdateTaskWire): Promise<string> {
  const downloadsDir = path.join(agentConfig.stateDir, "downloads");
  await ensureSecureDir(downloadsDir, { resetChildren: true });
  const destPath = path.join(downloadsDir, `agent-update-${path.basename(String(task.id))}.zip`);

  const response = await client.get("/api/agent/self-update/package", { responseType: "stream" });
  await new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);
    writer.on("finish", () => resolve());
    writer.on("error", reject);
  });
  return destPath;
}

// Plain numeric Date getters (getFullYear/getHours/...) are never locale-sensitive in JS —
// unlike PowerShell's Get-Date/ToString overloads (see buildUninstallAgentScript's
// InvariantCulture comment for the real DD/MM-vs-MM/DD bug that forced that workaround
// there), so no CultureInfo-style fix is needed here to get the same result: a bare
// "yyyy-MM-ddTHH:mm:ss" with no timezone suffix, which Task Scheduler reads as LOCAL time —
// matching what Get-Date's default (unformatted) local-time semantics would produce too.
function localIsoNoTimezone(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildHelperTaskXml(helperScriptPath: string, startBoundary: string): string {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <TimeTrigger>
      <StartBoundary>${startBoundary}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <StartWhenAvailable>true</StartWhenAvailable>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-NoProfile -ExecutionPolicy Bypass -File "${helperScriptPath}"</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

// Registers a completely independent one-time Scheduled Task ~20s in the future — same
// self-survival trick as agent.service.ts's buildUninstallAgentScript, adapted for the fact
// that THIS process (not a dispatched command subprocess) is what the agent service runs.
// The helper task has no process-tree relationship to the service, so it survives the
// service (and this very process) being stopped by its own first step.
export async function registerOneTimeTask(taskName: string, helperScriptPath: string, delayMs = 20_000): Promise<void> {
  const startBoundary = localIsoNoTimezone(new Date(Date.now() + delayMs));
  const taskXml = buildHelperTaskXml(helperScriptPath, startBoundary);

  // schtasks requires a BOM to correctly detect UTF-16LE (matching the XML's own
  // <?xml encoding="UTF-16"?> declaration) — Node's "utf16le" encoding alone writes raw
  // UTF-16LE bytes with no BOM, which schtasks misparses entirely. Same fix already proven
  // in watchdogGuard.ts. In the locked work folder, never %TEMP% (C:\Windows\Temp for SYSTEM,
  // where a user could swap the definition of a task that runs as SYSTEM).
  const taskXmlPath = await writeWorkFile(taskName, ".xml", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(taskXml, "utf16le")]));
  try {
    await execFileAsync("schtasks", ["/create", "/tn", taskName, "/xml", taskXmlPath, "/f"]);
  } finally {
    fs.unlinkSync(taskXmlPath);
  }
}

// The same lock register-service.ps1 (Lock-AgentFolder) applies - keep the two in step. The
// install folder is owned by SYSTEM, SYSTEM has full control and administrators read access,
// nothing is inherited from ProgramData (where users may create files), and everything inside
// inherits only that - so no file or permission a user added survives. A junction or link put in
// place of the folder (or of ProgramData\EndpointPro) is removed, never followed. The tray app's
// and the launch blocker's folders are also readable by users (both run as the signed-in user).
export const LOCK_INSTALL_DIR_PS = String.raw`
function Set-FolderAcl($path, $sddl) {
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetSecurityDescriptorSddlForm($sddl, [System.Security.AccessControl.AccessControlSections]::Access)
  [System.IO.Directory]::SetAccessControl($path, $acl)
}
function Lock-AgentFolder([switch]$AdminWrite) {
  $root = Split-Path $installDir
  foreach ($d in @($root, $installDir)) {
    $item = Get-Item -LiteralPath $d -Force -ErrorAction SilentlyContinue
    if ($item -and (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $item.PSIsContainer)) {
      if ($item.PSIsContainer) { [IO.Directory]::Delete($d, $false) } else { [IO.File]::Delete($d) }
    }
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
  }
  # Owned by Administrators first (only the owner, no permission changes), so the permissions
  # below can be set whatever they were; SYSTEM becomes the owner at the end.
  & takeown.exe /F $root /A 2>$null | Out-Null
  & takeown.exe /F $installDir /R /A /D Y 2>$null | Out-Null
  Set-FolderAcl $root 'D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)'
  # Administrators: full control only while an administrator copies files in (install.ps1).
  Set-FolderAcl $installDir $(if ($AdminWrite) { 'D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)' } else { 'D:PAI(A;OICI;FA;;;SY)(A;OICI;0x1200a9;;;BA)' })
  if (@(Get-ChildItem -LiteralPath $installDir -Force).Count -gt 0) { & icacls.exe (Join-Path $installDir '*') /reset /T /C /Q 2>$null | Out-Null }
  foreach ($sub in @('tray', 'app\blocker')) {
    $p = Join-Path $installDir $sub
    if (Test-Path -LiteralPath $p) { & icacls.exe $p /grant '*S-1-5-32-545:(OI)(CI)RX' /C /Q 2>$null | Out-Null }
  }
  & icacls.exe $root /setowner '*S-1-5-18' /C /Q 2>$null | Out-Null
  & icacls.exe $installDir /setowner '*S-1-5-18' /T /C /Q 2>$null | Out-Null
}
`;

// The detached helper's own script — stops the watchdog and the agent service (which kills
// this very process) and the tray app (its files are in use), extracts the already-downloaded,
// checksum-verified zip directly over the install root, re-registers and starts the service
// (register-service.ps1 also puts the folder permissions back), then self-reports the real terminal result using the
// agent's own state.json credentials (untouched by the extract — see package-installer.ps1,
// config.json/.state are never part of this zip). Lock-AgentFolder takes ownership of
// everything first (the ownership-mismatch class of Access Denied error already hit twice on
// real customer machines) without ever opening the folder to users.
//
// Every value is put in single quotes (psEscape): the server address and task id come from the
// server, and inside double quotes PowerShell would run any $(...) in them as SYSTEM.
//
// The folder is never reset to the permissions it would inherit from ProgramData (which let
// users create files) - LOCK_INSTALL_DIR_PS keeps it locked while the files are swapped.
function buildHelperScript(params: { installDir: string; zipPath: string; taskId: string; serverUrl: string }): string {
  const { installDir, zipPath, taskId, serverUrl } = params;
  const statusUrl = `${serverUrl}/api/agent/self-update/tasks/${encodeURIComponent(taskId)}/status`;
  return [
    `$ErrorActionPreference = 'SilentlyContinue'`,
    `$installDir = '${psEscape(installDir)}'`,
    `$zipPath = '${psEscape(zipPath)}'`,
    `$statePath = Join-Path $installDir 'app\\.state\\state.json'`,
    LOCK_INSTALL_DIR_PS,
    ``,
    // Retried up to 3 times (5s apart) — this is the ONLY place SUCCESS/FAILED ever gets
    // reported (see processAgentUpdate's own comment), so losing it here to one transient
    // network blip leaves the task stuck at APPLYING forever from the server's point of
    // view, even though the swap itself genuinely finished. $ErrorActionPreference is
    // already 'SilentlyContinue' at script scope, so failures inside the loop body don't
    // need their own try/catch to avoid killing the script — only Invoke-RestMethod's own
    // terminating errors do.
    `function Report-Status($status, $message) {`,
    `  $agentState = Get-Content $statePath -Raw | ConvertFrom-Json`,
    `  $body = @{ status = $status; message = $message } | ConvertTo-Json`,
    `  for ($i = 1; $i -le 3; $i++) {`,
    `    try {`,
    `      Invoke-RestMethod -Uri '${psEscape(statusUrl)}' -Method Post -TimeoutSec 15 ` +
      `-ContentType "application/json" -Body $body ` +
      `-Headers @{ "X-Agent-Id" = $agentState.agentId; "X-Agent-Key" = $agentState.apiKey } | Out-Null`,
    `      break`,
    `    } catch {`,
    `      if ($i -lt 3) { Start-Sleep -Seconds 5 }`,
    `    }`,
    `  }`,
    `}`,
    ``,
    `schtasks /change /tn "${WATCHDOG_TASK_NAME}" /disable 2>$null | Out-Null`,
    `schtasks /end /tn "${WATCHDOG_TASK_NAME}" 2>$null | Out-Null`,
    `Stop-Service -Name "${SERVICE_NAME}" -Force -ErrorAction SilentlyContinue`,
    `schtasks /change /tn "${LEGACY_AGENT_TASK_NAME}" /disable 2>$null | Out-Null`,
    `schtasks /end /tn "${LEGACY_AGENT_TASK_NAME}" 2>$null | Out-Null`,
    `taskkill /IM EndpointIQTray.exe /F 2>$null | Out-Null`,
    `Start-Sleep -Seconds 3`,
    ``,
    // SYSTEM already has full control of the locked folder; this only makes sure nothing in it
    // belongs to anyone else before the new files go in.
    `Lock-AgentFolder`,
    `try {`,
    `  $ErrorActionPreference = 'Stop'`,
    `  Expand-Archive -Path $zipPath -DestinationPath $installDir -Force`,
    `  Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue`,
    `  Report-Status "SUCCESS" $null`,
    `} catch {`,
    `  Report-Status "FAILED" "$_"`,
    `}`,
    `$ErrorActionPreference = 'SilentlyContinue'`,
    ``,
    // The service starts the tray app again in every signed-in session.
    `& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installDir 'register-service.ps1')`,
    `schtasks /change /tn "${WATCHDOG_TASK_NAME}" /enable 2>$null | Out-Null`,
    ``,
    `schtasks /delete /tn "${HELPER_TASK_NAME}" /f 2>$null | Out-Null`,
    `Remove-Item -Path "$PSCommandPath" -Force -ErrorAction SilentlyContinue`,
  ].join("\r\n");
}

// SUCCESS/FAILED are always reported by the detached helper (see buildHelperScript), never
// from here — this function's own reportStatus calls are just best-effort DOWNLOADING/
// APPLYING progress pings sent by the still-running original process before it hands off.
// If those pings fail (server transiently unreachable) that's swallowed by the checkinLoop
// wrapper, same as every other task type — a lost progress ping is not a reason to abandon
// an update already in flight.
export async function processAgentUpdate(
  client: AxiosInstance,
  task: AgentUpdateTaskWire,
  reportStatus: (payload: AgentUpdateStatusPayload) => Promise<void>,
): Promise<void> {
  if (process.platform !== "win32") {
    await reportStatus({ status: "FAILED", message: "Self-update is only supported on Windows" });
    return;
  }

  const installDir = getInstallDir();
  // Only meaningful for a real packaged install — in local dev (tsx watch src/index.ts)
  // there's no node/node.exe sibling or Scheduled Task to hand off to, so this is a
  // deliberate no-op guard rather than trying to synthesize one (same rule
  // ensureWatchdogTaskRegistered already applies for the same reason).
  if (!fs.existsSync(path.join(installDir, "node", "node.exe"))) {
    await reportStatus({ status: "FAILED", message: "Not a packaged install — self-update is unavailable in this environment" });
    return;
  }

  try {
    await reportStatus({ status: "DOWNLOADING" });
    const zipPath = await downloadUpdatePackage(client, task);

    const actualSha256 = await sha256File(zipPath);
    if (actualSha256 !== task.sha256) {
      fs.unlinkSync(zipPath);
      await reportStatus({ status: "FAILED", message: "SHA-256 mismatch after download — possible corruption or tampering" });
      return;
    }

    await reportStatus({ status: "APPLYING" });

    const helperScript = buildHelperScript({
      installDir,
      zipPath,
      taskId: task.id,
      serverUrl: getServerUrl(),
    });
    // Runs as SYSTEM: written to the locked work folder under a new random name, never %TEMP%.
    const helperScriptPath = await writeWorkFile(HELPER_TASK_NAME, ".ps1", helperScript, "utf8");

    await registerOneTimeTask(HELPER_TASK_NAME, helperScriptPath);

    console.log(`Self-update to ${task.targetVersion} scheduled — the agent service will restart within about 30 seconds.`);
  } catch (err) {
    await reportStatus({ status: "FAILED", message: err instanceof Error ? err.message : String(err) });
  }
}
