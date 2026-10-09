import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AxiosInstance } from "axios";
import type { AgentUpdateStatusPayload, AgentUpdateTaskWire } from "@em/shared";
import { agentConfig } from "./config";
import { getServerUrl } from "./httpClient";

const execFileAsync = promisify(execFile);

const AGENT_TASK_NAME = "EndpointProAgent";
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
  fs.mkdirSync(downloadsDir, { recursive: true });
  const destPath = path.join(downloadsDir, `agent-update-${task.id}.zip`);

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
// that THIS process (not a dispatched command subprocess) is what's running inside the
// EndpointProAgent task. The helper task has no process-tree relationship to
// EndpointProAgent, so it survives that task (and this very process) being torn down by
// its own first step.
async function registerHelperTask(helperScriptPath: string): Promise<void> {
  const startBoundary = localIsoNoTimezone(new Date(Date.now() + 20_000));
  const taskXml = buildHelperTaskXml(helperScriptPath, startBoundary);
  const taskXmlPath = path.join(process.env.TEMP ?? getInstallDir(), `${HELPER_TASK_NAME}_${Date.now()}.xml`);

  // schtasks requires a BOM to correctly detect UTF-16LE (matching the XML's own
  // <?xml encoding="UTF-16"?> declaration) — Node's "utf16le" encoding alone writes raw
  // UTF-16LE bytes with no BOM, which schtasks misparses entirely. Same fix already proven
  // in watchdogGuard.ts.
  fs.writeFileSync(taskXmlPath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(taskXml, "utf16le")]));
  try {
    await execFileAsync("schtasks", ["/create", "/tn", HELPER_TASK_NAME, "/xml", taskXmlPath, "/f"]);
  } finally {
    fs.unlinkSync(taskXmlPath);
  }
}

// The detached helper's own script — stops both Scheduled Tasks (which kills this very
// process), extracts the already-downloaded, checksum-verified zip directly over the
// install root, restarts both tasks, then self-reports the real terminal result using the
// agent's own state.json credentials (untouched by the extract — see package-installer.ps1,
// config.json/.state are never part of this zip). Mirrors update.ps1's proactive
// takeown/icacls fix for the same ownership-mismatch class of Access Denied error already
// hit twice this session on real customer machines.
function buildHelperScript(params: { installDir: string; zipPath: string; taskId: string; serverUrl: string }): string {
  const { installDir, zipPath, taskId, serverUrl } = params;
  return [
    `$ErrorActionPreference = 'SilentlyContinue'`,
    `$installDir = "${installDir}"`,
    `$zipPath = "${zipPath}"`,
    `$statePath = Join-Path $installDir "app\\.state\\state.json"`,
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
    `      Invoke-RestMethod -Uri "${serverUrl}/api/agent/self-update/tasks/${taskId}/status" -Method Post -TimeoutSec 15 ` +
      `-ContentType "application/json" -Body $body ` +
      `-Headers @{ "X-Agent-Id" = $agentState.agentId; "X-Agent-Key" = $agentState.apiKey } | Out-Null`,
    `      break`,
    `    } catch {`,
    `      if ($i -lt 3) { Start-Sleep -Seconds 5 }`,
    `    }`,
    `  }`,
    `}`,
    ``,
    `schtasks /change /tn "${AGENT_TASK_NAME}" /disable 2>$null | Out-Null`,
    `schtasks /end /tn "${AGENT_TASK_NAME}" 2>$null | Out-Null`,
    `schtasks /change /tn "${WATCHDOG_TASK_NAME}" /disable 2>$null | Out-Null`,
    `schtasks /end /tn "${WATCHDOG_TASK_NAME}" 2>$null | Out-Null`,
    `Start-Sleep -Seconds 2`,
    ``,
    `try {`,
    `  $ErrorActionPreference = 'Stop'`,
    `  takeown /F $installDir /R /D Y 2>$null | Out-Null`,
    `  icacls $installDir /reset /T /Q 2>$null | Out-Null`,
    `  Expand-Archive -Path $zipPath -DestinationPath $installDir -Force`,
    `  Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue`,
    `  Report-Status "SUCCESS" $null`,
    `} catch {`,
    `  Report-Status "FAILED" "$_"`,
    `}`,
    ``,
    `schtasks /change /tn "${WATCHDOG_TASK_NAME}" /enable 2>$null | Out-Null`,
    `schtasks /run /tn "${WATCHDOG_TASK_NAME}" 2>$null | Out-Null`,
    `schtasks /change /tn "${AGENT_TASK_NAME}" /enable 2>$null | Out-Null`,
    `schtasks /run /tn "${AGENT_TASK_NAME}" 2>$null | Out-Null`,
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

    const helperScriptPath = path.join(process.env.TEMP ?? installDir, `${HELPER_TASK_NAME}.ps1`);
    const helperScript = buildHelperScript({
      installDir,
      zipPath,
      taskId: task.id,
      serverUrl: getServerUrl(),
    });
    fs.writeFileSync(helperScriptPath, helperScript, "ascii");

    await registerHelperTask(helperScriptPath);

    console.log(
      `Self-update to ${task.targetVersion} scheduled — EndpointProAgent will restart within about 30 seconds.`,
    );
  } catch (err) {
    await reportStatus({ status: "FAILED", message: err instanceof Error ? err.message : String(err) });
  }
}
