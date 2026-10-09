import fs from "node:fs";
import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { StartRemoteInstallRequest } from "@em/shared";
import { config } from "../config";
import { prisma } from "../db";
import { logger } from "../logger";
import { createEnrollmentToken } from "./enrollment.service";
import { getAgentServerUrls } from "./agentConnection.service";

const execFileAsync = promisify(execFile);

const PER_TARGET_TIMEOUT_MS = 5 * 60 * 1000; // WinRM handshake + copy + install, generously
const WINRM_BOOTSTRAP_TIMEOUT_MS = 60 * 1000; // WMI/DCOM call + the target enabling its own WinRM service
const CONCURRENCY_LIMIT = 5; // bounded fan-out of WinRM sessions from this one server process
const MAX_STORED_OUTPUT_CHARS = 20_000;
const PASSWORD_ENV_VAR = "EM_REMOTE_INSTALL_PW";
const WINRM_PORT = 5985;

function psEscape(value: string): string {
  return value.replace(/'/g, "''");
}

// Quick "is anything listening" check - much cheaper than attempting a full WinRM handshake
// just to find out the port's closed. 3s is generous for a LAN target that's actually up.
function isPortOpen(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: timeoutMs });
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

// Bootstraps WinRM on a target that doesn't have it listening yet, over WMI/DCOM (ports
// 135 + 445) instead of WinRM itself - the whole reason this works where a WinRM session
// can't: WMI process creation doesn't require the destination to already be reachable over
// WinRM. This is the same fix as running `Enable-PSRemoting -Force` at the target's own
// console, just triggered remotely with the credential already supplied for the install
// itself. Never throws - a failed bootstrap attempt just means the WinRM connection attempt
// right after this will fail with its own clear error, which is still useful signal.
//
// Uses the legacy Invoke-WmiMethod (DCOM), not Invoke-CimMethod - CIM's -Credential only
// works against an explicit New-CimSession, which defaults to the WSMan/WinRM protocol
// itself (circular: it'd need the very thing we're trying to bootstrap). Invoke-WmiMethod
// accepts -ComputerName + -Credential directly over DCOM (ports 135/445), which is exactly
// why this whole fallback is possible in the first place.
// -SkipNetworkProfileCheck matters a lot here: Enable-PSRemoting refuses to create the
// WinRM firewall exception/listener at all when any active network connection on the
// target is categorized Public - which is the default Windows assigns to a new network
// it can't otherwise confirm as trusted, common on workgroup/non-domain-joined machines.
// Without this flag the command silently no-ops past that point (WinRM service still gets
// set to Auto/Started by the two commands after it - only the listener never gets created,
// so port 5985/5986 never opens even though the bootstrap process itself "ran" fine).
// Confirmed for real against 10.10.6.207 (network profile "NetworkCategory=0"/Public).
function buildWinrmBootstrapScript(target: string, username: string): string {
  return `
$ErrorActionPreference = 'Stop'
$securePw = ConvertTo-SecureString $env:${PASSWORD_ENV_VAR} -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential('${psEscape(username)}', $securePw)
$result = Invoke-WmiMethod -ComputerName '${psEscape(target)}' -Credential $cred -Class Win32_Process -Name Create -ArgumentList 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Enable-PSRemoting -Force -SkipNetworkProfileCheck; Set-Service WinRM -StartupType Automatic; Start-Service WinRM"'
if ($result.ReturnValue -ne 0) { throw "WMI process creation returned code $($result.ReturnValue)" }
Write-Output 'BOOTSTRAP_STARTED'
`;
}

async function tryBootstrapWinrm(target: string, username: string, password: string): Promise<{ ok: boolean; detail: string }> {
  const script = buildWinrmBootstrapScript(target, username);
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: WINRM_BOOTSTRAP_TIMEOUT_MS, maxBuffer: 1024 * 1024, env: { ...process.env, [PASSWORD_ENV_VAR]: password } },
    );
    if (!stdout.includes("BOOTSTRAP_STARTED")) return { ok: false, detail: `Unexpected bootstrap output: ${stdout.trim()}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: `WMI bootstrap failed: ${message}` };
  }

  // Enable-PSRemoting + starting the service takes a few seconds on the target - poll
  // rather than a single fixed sleep, so a fast target isn't held up unnecessarily.
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    if (await isPortOpen(target, WINRM_PORT)) return { ok: true, detail: "WinRM came up after WMI bootstrap" };
  }
  return { ok: false, detail: "WMI bootstrap command ran but WinRM still isn't listening after 30s" };
}

function truncate(text: string): string {
  return text.length > MAX_STORED_OUTPUT_CHARS ? `${text.slice(0, MAX_STORED_OUTPUT_CHARS)}\n...[truncated]` : text;
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Builds the one-shot PowerShell that reaches a single not-yet-enrolled target over
// WinRM/PowerShell Remoting and runs install.ps1 there directly - deliberately NOT
// EndpointProAgentSetup.exe. That .exe is a WinForms GUI stub (SetupStub.cs) that calls
// MessageBox.Show() unconditionally on both success and failure; a WinRM/Invoke-Command
// session has no interactive desktop for it to draw on, which crashes the process with a
// raw, uncatchable CLR exception (0xE0434352 / -532462766) instead of running the install
// at all. install.ps1 - the same script bundled inside that .exe, but also shipped
// separately as installerZipPath specifically for headless use (already reused as-is for
// agent self-update) - is the actual install logic with zero UI, so it's the right thing
// to run remotely; the .exe's only other job (an admin-elevation prompt) is moot too since
// this WinRM session is already running as an administrator credential by construction.
// The password never appears in this script text (and so never in argv/process listings) -
// it's read from an environment variable set only on this one child process, then
// immediately cleared inside the script itself as a second layer.
function buildRemoteInstallScript(target: string, username: string, installerZipPath: string, serverUrl: string, enrollmentToken: string): string {
  return `
$ErrorActionPreference = 'Stop'
$securePw = ConvertTo-SecureString $env:${PASSWORD_ENV_VAR} -AsPlainText -Force
Remove-Item Env:\\${PASSWORD_ENV_VAR} -ErrorAction SilentlyContinue
$cred = New-Object System.Management.Automation.PSCredential('${psEscape(username)}', $securePw)

$session = New-PSSession -ComputerName '${psEscape(target)}' -Credential $cred -ErrorAction Stop
try {
  Copy-Item -Path '${psEscape(installerZipPath)}' -Destination 'C:\\Windows\\Temp\\EndpointProAgentInstaller.zip' -ToSession $session -Force

  Invoke-Command -Session $session -ScriptBlock {
    param($ServerUrl, $Token)
    $ErrorActionPreference = 'Stop'
    $installDir = "$env:ProgramData\\EndpointPro\\Agent"

    # Clear out any stale identity from a prior enrollment this server no longer recognizes,
    # before doing anything else. A host only ever reaches this flow because it's NOT
    # currently matched to a working agent (that's what makes it an install candidate at
    # all) - so any .state left over here is by definition orphaned: it references an
    # agentId this server has no row for. ensureEnrolled() (enrollment.ts) trusts local
    # state blindly and skips re-enrolling if it finds one, so the agent just spins forever
    # hitting checkin with an apiKey the server rejects, 401ing silently and consuming
    # nothing - confirmed the hard way debugging SSSIL-DSK-244 (five reinstalls in a row,
    # zero of the five freshly-minted tokens ever got used, because none of them ever made
    # it past this exact check). Reset the tamper-protection ACL first - the same
    # takeown/icacls dance install.ps1 itself already does when reinstalling over an
    # existing task (see its own comment) - since a prior install's lockdown blocks even an
    # administrator from touching this folder otherwise. No-op (Test-Path guarded) on a
    # machine that's never had the agent before.
    if (Test-Path $installDir) {
      Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$installDir*" } | Stop-Process -Force -ErrorAction SilentlyContinue
      takeown /F $installDir /R /D Y | Out-Null
      icacls $installDir /reset /T /Q | Out-Null
      Remove-Item -Path (Join-Path $installDir 'app\\.state') -Recurse -Force -ErrorAction SilentlyContinue
    }

    $extractDir = Join-Path $env:TEMP ('EndpointProAgentInstall_' + [guid]::NewGuid().ToString('N'))
    try {
      Expand-Archive -Path 'C:\\Windows\\Temp\\EndpointProAgentInstaller.zip' -DestinationPath $extractDir -Force
      # Process-scoped only - affects just this one WinRM-remoted process, not the target's
      # machine-wide policy, and needs no cleanup since it dies with the session. install.ps1
      # is unsigned (built fresh per release, not code-signed), so the target's default
      # execution policy (commonly Restricted on client Windows editions) blocks it outright
      # otherwise - same reason every other script this app pushes to an agent already runs
      # via 'powershell.exe -ExecutionPolicy Bypass', just expressed differently here since
      # this runs inside an existing remote session rather than launching a new process.
      Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
      & (Join-Path $extractDir 'install.ps1') -ServerUrl $ServerUrl -EnrollmentToken $Token
    } finally {
      Remove-Item -Path $extractDir -Recurse -Force -ErrorAction SilentlyContinue
      Remove-Item -Path 'C:\\Windows\\Temp\\EndpointProAgentInstaller.zip' -Force -ErrorAction SilentlyContinue
    }
  } -ArgumentList '${psEscape(serverUrl)}', '${psEscape(enrollmentToken)}'

  Write-Output 'INSTALLED'
} finally {
  Remove-PSSession $session -ErrorAction SilentlyContinue
}
`;
}

async function runOneTarget(taskId: string, target: string, username: string, password: string, serverUrl: string, enrollmentToken: string): Promise<void> {
  await prisma.remoteInstallTask.update({ where: { id: taskId }, data: { status: "RUNNING", startedAt: new Date() } });

  // WinRM is off by default on most non-server Windows editions until something turns it
  // on - rather than fail outright the first time that's true, try to turn it on ourselves
  // via WMI (see tryBootstrapWinrm's own comment) and only give up if that doesn't work
  // either. Skipped entirely when the port's already open - the common case once a fleet's
  // been bootstrapped once (manually, via GPO, or via this same fallback on an earlier run).
  if (!(await isPortOpen(target, WINRM_PORT))) {
    const bootstrap = await tryBootstrapWinrm(target, username, password);
    if (!bootstrap.ok) {
      await prisma.remoteInstallTask.update({
        where: { id: taskId },
        data: {
          status: "FAILED",
          errorMessage: truncate(
            `WinRM isn't reachable on ${target} and the automatic WMI-based bootstrap couldn't enable it: ${bootstrap.detail}\n` +
              `Fix options: run 'Enable-PSRemoting -Force' at that machine's own console, or enable WinRM fleet-wide via GPO ` +
              `(Computer Configuration -> Administrative Templates -> Windows Components -> Windows Remote Management (WinRM) -> ` +
              `WinRM Service -> "Allow remote server management through WinRM").`,
          ),
          completedAt: new Date(),
        },
      });
      return;
    }
    logger.info({ target }, "WinRM auto-bootstrapped via WMI for remote install");
  }

  const script = buildRemoteInstallScript(target, username, config.agentInstallerZipPath, serverUrl, enrollmentToken);

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        timeout: PER_TARGET_TIMEOUT_MS,
        maxBuffer: 5 * 1024 * 1024,
        env: { ...process.env, [PASSWORD_ENV_VAR]: password },
      },
    );
    if (!stdout.includes("INSTALLED")) throw new Error(`Unexpected output: ${stdout.trim()}`);

    await prisma.remoteInstallTask.update({
      where: { id: taskId },
      data: { status: "SUCCESS", output: truncate(stdout), completedAt: new Date() },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // execFile's error on a non-zero exit / timeout carries partial stdout/stderr on the
    // error object itself (Node's ExecFileException) - surface it, it's usually the only
    // clue to what actually failed on the remote end (bad credential, WinRM unreachable,
    // AV blocking the installer, etc).
    const stderrText = (err as { stderr?: string })?.stderr ?? "";
    logger.error({ err, target }, "Remote install failed for target");
    await prisma.remoteInstallTask.update({
      where: { id: taskId },
      data: { status: "FAILED", errorMessage: truncate(`${message}\n${stderrText}`.trim()), completedAt: new Date() },
    });
  }
}

// Fire-and-forget from the route handler - a bulk WinRM rollout across many targets can
// take minutes, far longer than an HTTP request should hang open. The console polls
// getRemoteInstallJob for progress instead (same "create job, poll status" shape as
// CommandJob/DeploymentJob elsewhere in this app).
async function runRemoteInstallJob(jobId: string, tasks: { id: string; target: string }[], username: string, password: string, serverUrl: string, enrollmentToken: string): Promise<void> {
  await runWithConcurrency(tasks, CONCURRENCY_LIMIT, (task) =>
    runOneTarget(task.id, task.target, username, password, serverUrl, enrollmentToken),
  );
}

export async function startRemoteInstall(
  payload: StartRemoteInstallRequest,
  createdByAdminId: string,
): Promise<{ jobId: string }> {
  if (!fs.existsSync(config.agentInstallerZipPath)) {
    throw new Error(
      "No agent installer has been published on this server yet - build one with " +
        "'npm run package -w @em/agent' and place EndpointProAgentInstaller.zip in the configured AGENT_INSTALLER_DIR.",
    );
  }

  // Dedupe targets a careless paste might repeat - each still only needs one install attempt.
  const targets = Array.from(new Set(payload.targets.map((t) => t.trim()).filter(Boolean)));

  // Callers that already have a token in hand (Enrollment Tokens page, right after creating
  // one) pass its plaintext directly. A caller with no token at all (Network Scan's per-host
  // "Install agent" button) gets one minted here instead - single-use per target, short-lived,
  // and never surfaced back to the browser; it only ever exists to get this one install done.
  let tokenId = payload.tokenId;
  let enrollmentToken = payload.enrollmentToken;
  if (!enrollmentToken) {
    const created = await createEnrollmentToken({
      label: `Remote install ${new Date().toISOString().slice(0, 10)} (${targets.length} host${targets.length === 1 ? "" : "s"})`,
      expiresInDays: 1,
      usesRemaining: targets.length,
    });
    tokenId = created.id;
    enrollmentToken = created.token;
  }

  // Every configured address (LAN, web URL, public IP), comma-separated - install.ps1 writes
  // them all to config.json so the agent can fail over between them. The browser-supplied
  // URL is only a fallback for a server with no address configured or detectable.
  const serverUrl = (await getAgentServerUrls()).join(",") || payload.serverUrl;

  const job = await prisma.remoteInstallJob.create({
    data: {
      tokenId,
      serverUrl,
      createdByAdminId,
      tasks: { create: targets.map((target) => ({ target })) },
    },
    include: { tasks: true },
  });

  // Deliberately not awaited - see runRemoteInstallJob's own comment. Errors inside it are
  // per-task (already caught and recorded in runOneTarget); nothing here can throw once the
  // job/tasks are created, but log defensively anyway so a truly unexpected failure isn't silent.
  void runRemoteInstallJob(job.id, job.tasks, payload.username, payload.password, serverUrl, enrollmentToken).catch(
    (err) => logger.error({ err, jobId: job.id }, "Remote install job crashed unexpectedly"),
  );

  return { jobId: job.id };
}

export async function getRemoteInstallJob(jobId: string) {
  const job = await prisma.remoteInstallJob.findUnique({
    where: { id: jobId },
    include: { tasks: { orderBy: { id: "asc" } } },
  });
  if (!job) return null;

  return {
    id: job.id,
    serverUrl: job.serverUrl,
    createdAt: job.createdAt.toISOString(),
    tasks: job.tasks.map((t) => ({
      id: t.id,
      target: t.target,
      status: t.status,
      output: t.output,
      errorMessage: t.errorMessage,
      startedAt: t.startedAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
    })),
  };
}
