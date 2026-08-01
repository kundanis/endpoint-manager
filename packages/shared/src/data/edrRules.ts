// EDR-lite detection content — a fixed, built-in catalog (like piiPatterns.ts), not
// admin-authored. Patterns are plain strings compiled with `new RegExp(pattern, "i")`
// in Node.js (never inside the PowerShell dump script itself — the agent's PowerShell
// side only collects raw process/persistence data; all rule matching happens in
// TypeScript, avoiding fragile regex-escaping through a PowerShell string literal).
export type EdrDetectionSeverity = "HIGH" | "MEDIUM";

export interface EdrProcessTreeRule {
  key: string;
  label: string;
  severity: EdrDetectionSeverity;
  // Lowercase image names, no path — matched against Win32_Process.Name.
  parentNames: string[];
  childNames: string[];
}

// Classic macro-malware / phishing-payload spawn chains: a document viewer or script
// host launching a command/script interpreter is almost never legitimate end-user
// behavior. HIGH severity here means "kill it" (see edrScanner.ts) — these pairings
// are specific enough that a false positive is unlikely (unlike a bare "powershell.exe
// was launched", which is far too common to auto-kill on its own).
export const EDR_PROCESS_TREE_RULES: EdrProcessTreeRule[] = [
  {
    key: "OFFICE_SPAWNS_SCRIPT",
    label: "Office application spawned a script/command interpreter",
    severity: "HIGH",
    parentNames: ["winword.exe", "excel.exe", "powerpnt.exe", "outlook.exe", "msaccess.exe", "mspub.exe"],
    childNames: ["powershell.exe", "pwsh.exe", "cmd.exe", "wscript.exe", "cscript.exe", "mshta.exe", "certutil.exe", "rundll32.exe", "regsvr32.exe"],
  },
  {
    key: "PDF_SPAWNS_SCRIPT",
    label: "PDF reader spawned a script/command interpreter",
    severity: "HIGH",
    parentNames: ["acrord32.exe", "acrobat.exe", "foxitreader.exe"],
    childNames: ["powershell.exe", "pwsh.exe", "cmd.exe", "wscript.exe", "cscript.exe", "mshta.exe"],
  },
  {
    key: "SCRIPT_SPAWNS_SCRIPT",
    label: "Script interpreter spawned another script/command interpreter",
    severity: "MEDIUM",
    parentNames: ["wscript.exe", "cscript.exe", "mshta.exe"],
    childNames: ["powershell.exe", "pwsh.exe", "cmd.exe"],
  },
];

export interface EdrCommandLineRule {
  key: string;
  label: string;
  severity: EdrDetectionSeverity;
  // Lowercase image names this rule applies to — matched against Win32_Process.Name.
  processNames: string[];
  pattern: string;
}

// LOLBin (living-off-the-land binary) abuse patterns — legitimate Windows tools used
// in ways that only ever show up in real attack tooling or admin scripting. Kept
// MEDIUM rather than HIGH by default (alert, don't auto-kill) since a handful of
// these can appear in legitimate IT automation; only the process-tree rules above
// auto-kill for v1.
export const EDR_COMMAND_LINE_RULES: EdrCommandLineRule[] = [
  {
    key: "POWERSHELL_ENCODED",
    label: "PowerShell executing an encoded or download-cradle command",
    severity: "MEDIUM",
    processNames: ["powershell.exe", "pwsh.exe"],
    pattern: "-enc(odedcommand)?\\s|iex\\s*\\(|invoke-expression|downloadstring|downloadfile",
  },
  {
    key: "CERTUTIL_DECODE",
    label: "certutil used to decode or download a file (LOLBin abuse)",
    severity: "MEDIUM",
    processNames: ["certutil.exe"],
    pattern: "-decode|-urlcache",
  },
  {
    key: "MSHTA_REMOTE",
    label: "mshta executing a remote or script payload",
    severity: "MEDIUM",
    processNames: ["mshta.exe"],
    pattern: "https?://|vbscript:|javascript:",
  },
  {
    key: "RUNDLL32_SUSPICIOUS",
    label: "rundll32 invoked with a suspicious argument",
    severity: "MEDIUM",
    processNames: ["rundll32.exe"],
    pattern: "javascript:|https?://|\\\\temp\\\\|\\\\appdata\\\\",
  },
  {
    key: "SCRIPT_FROM_TEMP",
    label: "Script interpreter running a script from a Temp/Downloads folder",
    severity: "MEDIUM",
    processNames: ["wscript.exe", "cscript.exe"],
    pattern: "\\\\temp\\\\|\\\\downloads\\\\|\\\\appdata\\\\local\\\\temp\\\\",
  },
];
