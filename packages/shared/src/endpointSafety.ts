import { z } from "zod";
import { commandProtection } from "./data/commandProtections";

// Guard rails that keep a blocking policy from taking a Windows device down - checked by the
// server (when a rule is saved), the console (as the admin types) and the agent (before it
// enforces anything), so an old console or a direct API call can't get round them.
//
// Background: one Application control rule for the extension ".exe" disallows every program,
// including userinit.exe and explorer.exe at sign-in - a black screen with only a cursor, for
// administrators too. Command blocking with a broad pattern could likewise kill the desktop.

const norm = (s: string) => s.trim().toLowerCase().replace(/\//g, "\\");

// Processes Windows needs for sign-in, the desktop and recovery, plus the agent itself.
export const CRITICAL_WINDOWS_PROCESSES: readonly string[] = [
  "explorer.exe", "userinit.exe", "winlogon.exe", "logonui.exe", "csrss.exe", "wininit.exe", "services.exe",
  "lsass.exe", "lsaiso.exe", "smss.exe", "svchost.exe", "dwm.exe", "sihost.exe", "ctfmon.exe", "fontdrvhost.exe",
  "shellexperiencehost.exe", "startmenuexperiencehost.exe", "searchhost.exe", "searchapp.exe", "searchui.exe",
  "textinputhost.exe", "runtimebroker.exe", "taskhostw.exe", "dllhost.exe", "conhost.exe", "consent.exe",
  "applicationframehost.exe", "audiodg.exe", "spoolsv.exe", "taskmgr.exe", "cmd.exe", "powershell.exe",
  "pwsh.exe", "regedit.exe", "mmc.exe", "rundll32.exe", "wmiprvse.exe", "msmpeng.exe", "securityhealthservice.exe",
  "node.exe", // the Endpoint IQ agent runs on node.exe
];

// Windows tools that command blocking may still stop by command line even though they live in
// the Windows folder - script hosts and common attack tools. Everything else in the Windows
// folder is never touched by command blocking.
export const COMMAND_BLOCK_KILLABLE_WINDOWS_TOOLS: readonly string[] = [
  "powershell.exe", "powershell_ise.exe", "cmd.exe", "wscript.exe", "cscript.exe", "mshta.exe", "certutil.exe",
  "bitsadmin.exe", "regsvr32.exe", "wmic.exe", "net.exe", "net1.exe", "reg.exe", "sc.exe", "vssadmin.exe",
  "schtasks.exe", "ftp.exe", "curl.exe", "msbuild.exe", "installutil.exe", "cmstp.exe", "forfiles.exe",
  // Used by the command protections (commandProtections.ts) - matched only by their harmful command lines.
  "diskpart.exe", "format.com", "cipher.exe", "wbadmin.exe", "bcdedit.exe", "wevtutil.exe", "reagentc.exe",
  "netsh.exe", "rundll32.exe", "icacls.exe", "vaultcmd.exe", "ntdsutil.exe",
];

// Extensions every program or the desktop depends on - blocking them blocks everything.
export const UNBLOCKABLE_EXTENSIONS: readonly string[] = [".exe", ".com", ".scr", ".dll", ".lnk", ".cpl", ".msc", ".sys", ".ocx", ".drv", ".efi", ".mui"];

// Folders that hold Windows itself, Store apps and the agent.
const PROTECTED_FOLDERS = ["\\windows\\", "%windir%", "%systemroot%", "\\systemapps\\", "\\windowsapps\\", "\\endpointpro\\", "\\program files\\endpointpro"];

const baseName = (v: string) => v.slice(v.lastIndexOf("\\") + 1);

// Why an Application control rule would be unsafe, or null when it is fine.
export function appControlRuleProblem(ruleType: string, rawValue: string): string | null {
  const value = norm(rawValue);
  if (!value) return "Enter a value.";
  if (ruleType === "EXTENSION") {
    const ext = value.startsWith(".") ? value : `.${value}`;
    if (ext.includes("*") || ext.includes("?") || ext === ".") return "Wildcards would block every program on the device.";
    if (UNBLOCKABLE_EXTENSIONS.includes(ext)) {
      return `Blocking ${ext} files would stop Windows itself (the desktop and sign-in) from running. Block specific applications by name instead.`;
    }
    return null;
  }
  if (ruleType === "PRODUCT" || ruleType === "PUBLISHER") {
    const bare = value.replace(/[*?]/g, "").trim();
    if (bare.length < 3) return "Enter at least 3 letters - a shorter name would match many programs.";
    if (/microsoft|windows|endpoint ?(iq|pro|one)/.test(value)) {
      return "Microsoft and Windows programs (and the Endpoint IQ agent) can't be blocked this way: Windows or the agent would stop working.";
    }
    return null;
  }
  // EXECUTABLE: a file name or a path.
  const stripped = value.replace(/[*?\\:.]/g, "");
  if (!stripped) return "Wildcards would block every program on the device.";
  if (/^[a-z]:\\?\*?$/.test(value) || value === "\\" || /^\*\\?\*?(\.\*)?$/.test(value)) return "That would block every program on a whole drive.";
  if (PROTECTED_FOLDERS.some((f) => value.includes(f)) || /^[a-z]:\\windows($|\\)/.test(value)) {
    return "Programs in the Windows folder, Store apps and the Endpoint IQ agent can't be blocked: Windows or the agent would stop working.";
  }
  const name = baseName(value);
  if (CRITICAL_WINDOWS_PROCESSES.includes(name)) return `${name} is part of Windows (or the agent) and can't be blocked.`;
  // A wildcard file name needs a real name part: "*.exe" or "?.com" would match every program.
  if (/[*?]/.test(name) && !name.split(".")[0].replace(/[*?]/g, "")) return "Wildcards would block every program on the device.";
  return null;
}

// Command lines of core Windows processes. A command-blocking pattern that matches any of
// them would kill part of Windows on every device it reaches.
export const CANARY_COMMAND_LINES: readonly string[] = [
  "C:\\Windows\\Explorer.EXE",
  "C:\\Windows\\system32\\userinit.exe",
  "C:\\Windows\\system32\\svchost.exe -k netsvcs -p -s Schedule",
  "C:\\Windows\\system32\\svchost.exe -k DcomLaunch -p",
  "\"C:\\Windows\\system32\\sihost.exe\"",
  "\"C:\\Windows\\SystemApps\\ShellExperienceHost_cw5n1h2txyewy\\ShellExperienceHost.exe\" -ServerName:App.AppXtwbb.mca",
  "\"C:\\Windows\\SystemApps\\Microsoft.Windows.StartMenuExperienceHost_cw5n1h2txyewy\\StartMenuExperienceHost.exe\" -ServerName:App.AppX.mca",
  "\"dwm.exe\"",
  "winlogon.exe",
  "C:\\Windows\\system32\\taskhostw.exe {222A245B-E637-4AE9-A93F-A59CA119A75E}",
  "\"ctfmon.exe\"",
  "C:\\Windows\\System32\\RuntimeBroker.exe -Embedding",
  "\"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\"",
  "\"C:\\ProgramData\\EndpointPro\\Agent\\node\\node.exe\" C:\\ProgramData\\EndpointPro\\Agent\\app\\dist\\index.js",
];

// Why a Command blocking rule would be unsafe, or null when it is fine.
export function commandBlockRuleProblem(ruleType: string, rawValue: string): string | null {
  const value = rawValue.trim();
  if (!value) return "Enter a value.";
  if (ruleType === "PROTECTION") return commandProtection(value) ? null : "Choose a protection from the list.";
  if (ruleType === "PROCESS_NAME") {
    const name = baseName(norm(value));
    if (CRITICAL_WINDOWS_PROCESSES.includes(name) && !COMMAND_BLOCK_KILLABLE_WINDOWS_TOOLS.includes(name)) {
      return `${name} is part of Windows (or the agent) and can't be blocked.`;
    }
    return null;
  }
  if (ruleType === "EXACT_COMMAND_LINE") {
    const canary = CANARY_COMMAND_LINES.find((c) => c.toLowerCase() === value.toLowerCase());
    return canary ? "That is the command line of a core Windows process and can't be blocked." : null;
  }
  // COMMAND_PATTERN (regex)
  let re: RegExp;
  try {
    re = new RegExp(value, "i");
  } catch {
    return "That isn't a valid pattern.";
  }
  if (re.test("")) return "That pattern matches everything (it also matches an empty command line).";
  const hit = CANARY_COMMAND_LINES.find((c) => re.test(c));
  if (hit) return `That pattern also matches core Windows processes (for example: ${hit}). Make it more specific.`;
  return null;
}

// Security benchmark fixes that change how Windows boots or signs in. After the reboot that
// follows, incompatible drivers (graphics, docks, DisplayLink) or sign-in plug-ins can fail
// to load - a black screen or no logon. They are never part of "Remediate all / selected";
// an admin applies them one device at a time, after a warning.
export function remediationRisk(script: string | null | undefined): string | null {
  if (!script) return null;
  if (/HypervisorEnforcedCodeIntegrity|EnableVirtualizationBasedSecurity|LsaCfgFlags|DeviceGuard/i.test(script)) {
    return "Turns on Memory Integrity / virtualization-based security. After the next restart, older graphics, dock or DisplayLink drivers may not load (black screen). Check the device's drivers first and try one device before others.";
  }
  if (/RunAsPPL/i.test(script)) {
    return "Turns on LSA protection. After the next restart, unsigned sign-in or smart-card plug-ins stop loading and users may be unable to sign in. Try one device first.";
  }
  if (/Winlogon|\\Shell\b|Userinit|BootExecute|bcdedit/i.test(script)) {
    return "Changes how Windows starts or signs in. Try one device first.";
  }
  return null;
}

// Commands blocking may kill at most this many processes per scan (per device) - a backstop for
// a pattern nobody foresaw.
export const COMMAND_BLOCK_MAX_KILLS_PER_SCAN = 10;

// Sent by the agent's desktop safety net (agent shellHealthGuard.ts) after it removed its own
// blocking rules because a signed-in user's desktop never started.
export const safetyEventPayloadSchema = z.object({
  kind: z.enum(["DESKTOP_NOT_STARTED"]),
  username: z.string().max(300),
  managedRules: z.number().int().nonnegative(),
  detectedAt: z.string(),
});
export type SafetyEventPayload = z.infer<typeof safetyEventPayloadSchema>;
