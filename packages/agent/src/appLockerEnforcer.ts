import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { AllowlistWire, AppControlRuleWire } from "@em/shared";
import { APPLOCKER_MSI_EXTENSIONS, APPLOCKER_SCRIPT_EXTENSIONS, MICROSOFT_PUBLISHER, appControlRuleProblem } from "@em/shared";
import { APPLOCKER_MARKER, appLockerStateFile, REMOVE_APPLOCKER_RULES_PS } from "./appControlPaths";
import type { RawEvent } from "./appControlEnforcer";
import { AGENT_INSTALL_DIR, ENDPOINTPRO_DIR, ensureSecureDir, psEscape } from "./secureFs";

const execFileAsync = promisify(execFile);

// Advanced application control: Windows AppLocker, for what the process watcher can't see -
// DLLs loaded into a program, and scripts (.ps1, .bat, .cmd, .vbs, .js) or installers run from an
// already-open PowerShell or Command Prompt or by a scheduled task. Switched on per server
// (ADVANCED_APP_CONTROL); the server then sends AssignedAppControlResponse.advanced.
//
// How the rules are laid out, so nothing else on the device changes:
//  - Only the Script, Windows Installer (Msi) and Dll collections are used; programs (.exe)
//    stay with the process watcher.
//  - A collection the device wasn't using gets one "allow everything" rule, so only what a
//    rule names is blocked. A collection that already has someone else's rules (a company
//    AppLocker policy) is left as it is - our block rules are just added to it.
//  - Each block is a Deny rule for Everyone, with exceptions for the agent's own folder and every
//    Allow rule. AppLocker applies only to programs users start (unless "services enforcement"
//    is switched on, which this never does), so the agent, running as SYSTEM, is unaffected.
//  - Every rule we add carries APPLOCKER_MARKER, so it can be removed exactly (sync, desktop
//    safety net, uninstall) without touching anyone else's.
//
// Allowlist (an allowlist policy): the Exe (program) collection gets only allow rules - Windows and
// what it needs, the agent, the options and the policy's rules - so Windows blocks every other
// program a user starts. The Msi (Windows Installer) collection likewise allows only Windows' own
// installer cache (and administrators), so no new setup can be run by a user. The Appx (packaged
// app) collection allows Windows' and Microsoft's own packaged apps and the computer and chip
// makers' (once program rules are enforced, Windows blocks packaged apps no rule allows -
// Calculator, Photos, the new Notepad, Paint and Snipping Tool, Terminal, the Store...); every
// other Store app is blocked like any other program. A device whose collections already have
// someone else's rules keeps them and their mode.
//
// Needs the Application Identity service (AppIDSvc), which the agent starts. Windows 10/11 Pro,
// Enterprise and Education all enforce AppLocker (edition checks were removed in 2022, KB5024351).

// Only the locked install folder (SYSTEM and administrators can change it) is exempt: any other
// folder under ProgramData\EndpointPro could be one a user made, and whatever they put in an
// allowed folder would run.
const AGENT_FOLDER = AGENT_INSTALL_DIR;
// Probe files are made in a folder only SYSTEM and administrators can write to (not Windows\Temp,
// where a user could put a link in its place), and outside AGENT_FOLDER, which every block exempts.
const PROBE_DIR = path.join(ENDPOINTPRO_DIR, "AppLockerProbe");
const REAPPLY_EVERY_MS = 30 * 60_000; // repair the policy if something else rewrote it
const ALLOW_ALL_IDS: Record<Collection, string> = {
  Script: "e1d0a11c-0000-4000-8000-000000000001",
  Msi: "e1d0a11c-0000-4000-8000-000000000002",
  Dll: "e1d0a11c-0000-4000-8000-000000000003",
};
// AppLocker understands only these variables; any other %VAR% is expanded on the device.
const APPLOCKER_VARIABLES = ["%WINDIR%", "%SYSTEM32%", "%OSDRIVE%", "%PROGRAMFILES%", "%REMOVABLE%", "%HOT%"];

type Collection = "Script" | "Msi" | "Dll";

// Folders inside Windows that standard users can write to: a program copied there must not run
// under the Windows allowance.
const WINDOWS_USER_WRITABLE = [
  "%WINDIR%\\Tasks\\*",
  "%WINDIR%\\Temp\\*",
  "%WINDIR%\\tracing\\*",
  "%WINDIR%\\Registration\\CRMLog\\*",
  "%WINDIR%\\debug\\WIA\\*",
  "%WINDIR%\\PLA\\Reports\\*",
  "%WINDIR%\\PLA\\Rules\\*",
  "%WINDIR%\\PLA\\Templates\\*",
  "%WINDIR%\\System32\\FxsTmp\\*",
  "%WINDIR%\\System32\\com\\dmp\\*",
  "%WINDIR%\\System32\\Microsoft\\Crypto\\RSA\\MachineKeys\\*",
  "%WINDIR%\\System32\\spool\\PRINTERS\\*",
  "%WINDIR%\\System32\\spool\\SERVERS\\*",
  "%WINDIR%\\System32\\spool\\drivers\\color\\*",
  "%WINDIR%\\System32\\Tasks\\*",
  "%WINDIR%\\SysWOW64\\FxsTmp\\*",
  "%WINDIR%\\SysWOW64\\com\\dmp\\*",
  "%WINDIR%\\SysWOW64\\Tasks\\*",
];
const BASELINE_IDS = {
  windowsComponents: "e1d0a11c-0000-4000-8000-000000000106",
  edge: "e1d0a11c-0000-4000-8000-000000000107",
  webView2: "e1d0a11c-0000-4000-8000-000000000108",
  edgeUpdate: "e1d0a11c-0000-4000-8000-000000000109",
  dotnet: "e1d0a11c-0000-4000-8000-000000000110",
  dotnetFolder: "e1d0a11c-0000-4000-8000-000000000111",
  msiCache: "e1d0a11c-0000-4000-8000-000000000112",
  msiAdministrators: "e1d0a11c-0000-4000-8000-000000000113",
  signedPackagedApps: "e1d0a11c-0000-4000-8000-000000000114",
  internetExplorer: "e1d0a11c-0000-4000-8000-000000000115",
  windows: "e1d0a11c-0000-4000-8000-000000000101",
  programFiles: "e1d0a11c-0000-4000-8000-000000000102",
  administrators: "e1d0a11c-0000-4000-8000-000000000103",
  agent: "e1d0a11c-0000-4000-8000-000000000104",
  microsoftAll: "e1d0a11c-0000-4000-8000-000000000105",
};
const EVERYONE = "S-1-1-0";
// Hardware makers whose tools live under Program Files (only administrators can write there, so a
// folder rule can't be used to slip a program in): chip and driver makers, and computer makers'
// own utilities (support, updates, power, audio, keyboard and display settings). Both Program
// Files folders are covered (%PROGRAMFILES% means both in AppLocker).
const DRIVER_VENDOR_FOLDERS = ["Intel", "Realtek", "NVIDIA Corporation", "AMD", "Synaptics", "Elantech", "Conexant", "Waves", "Dolby", "DTS", "Qualcomm", "MediaTek", "Broadcom"];
const HARDWARE_MAKER_FOLDERS = [
  "Dell", "HP", "Hewlett-Packard", "HP Inc", "Lenovo", "ASUS", "ASUSTeK Computer Inc", "Acer", "MSI", "Toshiba", "Dynabook",
  "Fujitsu", "Samsung", "Panasonic", "LG Electronics", "Huawei", "GIGABYTE", "Microsoft Surface",
  "ELAN", "Alps", "Cirrus Logic", "Goodix", "Rivet Networks", "Killer Networking", "Thunderbolt", "Wacom",
];
// Microsoft's packaged apps: Windows' own (Start, Settings, Photos...) and Microsoft's Store apps
// (Calculator, Notepad, Paint, Terminal, Store, Teams, Outlook...).
const MICROSOFT_PACKAGE_PUBLISHERS = [
  "CN=MICROSOFT WINDOWS, O=MICROSOFT CORPORATION, L=REDMOND, S=WASHINGTON, C=US",
  "CN=MICROSOFT CORPORATION, O=MICROSOFT CORPORATION, L=REDMOND, S=WASHINGTON, C=US",
];
// Computer and chip makers' Microsoft Store apps (their Store publisher ids).
const HARDWARE_PACKAGE_PUBLISHERS: { name: string; publisher: string }[] = [
  { name: "Dell", publisher: "CN=F005DA31-7CE1-4D3E-ABEE-08A4AFF4F592" },
  { name: "Intel", publisher: "CN=EB51A5DA-0E72-4863-82E4-EA21C1F8DFE3" },
];
// The product name on Windows' own files (as Windows reads it, in upper case).
const WINDOWS_PRODUCT = "MICROSOFT\u00ae WINDOWS\u00ae OPERATING SYSTEM";
const ADMINISTRATORS = "S-1-5-32-544";
// Windows records a program no rule allowed (an allowlist's default) with this rule id.
const NO_RULE_ID = "00000000-0000-0000-0000-000000000000";

interface DenyRule {
  id: string;
  collection: Collection;
  name: string;
  path: string;
}

interface Desired {
  denies: DenyRule[];
  allows: string[];
  // Allowlist: the Exe, Msi and Appx collections' allow rules (XML) and the mode; null without an allowlist.
  exe: { rules: string[]; msiRules: string[]; appxRules: string[]; mode: "Enabled" | "AuditOnly" } | null;
}

interface SavedState {
  hash: string;
  appliedAt: number;
  ruleCount: number;
  eventsSince: string;
}

export interface AppLockerResult {
  problem: string | null; // shown on the Sync status tab; null while everything is in force
  events: RawEvent[];
}

function expandVariables(value: string): string {
  return value.replace(/%([^%\\]+)%/g, (whole, name: string) => {
    if (APPLOCKER_VARIABLES.includes(whole.toUpperCase())) return whole.toUpperCase();
    const hit = Object.keys(process.env).find((k) => k.toLowerCase() === name.toLowerCase());
    return hit ? (process.env[hit] ?? whole) : whole;
  });
}

// "C:\Tools" and "C:\Tools\" mean everything in that folder; "C:\Tools\app.exe" one file.
export function allowPattern(value: string): string {
  let v = expandVariables(value.trim().replace(/\//g, "\\"));
  if (v.endsWith("\\")) return `${v}*`;
  const last = v.slice(v.lastIndexOf("\\") + 1);
  if (!last.includes(".") && !last.includes("*") && !last.includes("?")) v = `${v}\\*`;
  return v;
}

// A DLL named without a folder is blocked wherever it is.
export function dllPattern(value: string): string {
  const v = expandVariables(value.trim().replace(/\//g, "\\"));
  return v.includes("\\") ? v : `*\\${v}`;
}

// A GUID that stays the same for the same text (AppLocker rule ids must be GUIDs).
function stableGuid(text: string): string {
  const h = createHash("sha256").update(text).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// AppLocker wants four-part versions.
const fourPart = (v: string) => {
  const parts = v.trim().split(".").filter(Boolean);
  while (parts.length < 4) parts.push("0");
  return parts.slice(0, 4).join(".");
};

function pathRule(id: string, name: string, sid: string, pathValue: string, exceptions: string[] = []): string {
  const ex = exceptions.length ? `<Exceptions>${exceptions.map((e) => `<FilePathCondition Path="${xmlAttr(e)}" />`).join("")}</Exceptions>` : "";
  return (
    `<FilePathRule Id="${xmlAttr(id)}" Name="${xmlAttr(`Endpoint IQ: ${name}`.slice(0, 200))}" Description="${APPLOCKER_MARKER}" UserOrGroupSid="${sid}" Action="Allow">` +
    `<Conditions><FilePathCondition Path="${xmlAttr(pathValue)}" /></Conditions>${ex}</FilePathRule>`
  );
}

function publisherRule(id: string, name: string, publisher: string, product: string, binary: string, low: string, high: string): string {
  return (
    `<FilePublisherRule Id="${xmlAttr(id)}" Name="${xmlAttr(`Endpoint IQ: ${name}`.slice(0, 200))}" Description="${APPLOCKER_MARKER}" UserOrGroupSid="${EVERYONE}" Action="Allow">` +
    `<Conditions><FilePublisherCondition PublisherName="${xmlAttr(publisher)}" ProductName="${xmlAttr(product)}" BinaryName="${xmlAttr(binary)}">` +
    `<BinaryVersionRange LowSection="${xmlAttr(low)}" HighSection="${xmlAttr(high)}" /></FilePublisherCondition></Conditions></FilePublisherRule>`
  );
}

// The allowlist's program (Exe) rules: the baseline, then the policy's own allow rules.
export function allowlistExeRules(a: AllowlistWire): string[] {
  // Windows and what it needs: the Windows folder, Windows' own signed components wherever they
  // are (Defender's platform, for example), Edge and WebView2 (part of Windows; many apps need
  // WebView2), .NET, and the agent.
  const out = [
    pathRule(BASELINE_IDS.windows, "Windows", EVERYONE, "%WINDIR%\\*", WINDOWS_USER_WRITABLE),
    publisherRule(BASELINE_IDS.windowsComponents, "Windows components", MICROSOFT_PUBLISHER, WINDOWS_PRODUCT, "*", "*", "*"),
    publisherRule(BASELINE_IDS.edge, "Microsoft Edge", MICROSOFT_PUBLISHER, "MICROSOFT EDGE", "*", "*", "*"),
    publisherRule(BASELINE_IDS.webView2, "Microsoft Edge WebView2", MICROSOFT_PUBLISHER, "MICROSOFT EDGE WEBVIEW2", "*", "*", "*"),
    publisherRule(BASELINE_IDS.edgeUpdate, "Microsoft Edge Update", MICROSOFT_PUBLISHER, "MICROSOFT EDGE UPDATE", "*", "*", "*"),
    publisherRule(BASELINE_IDS.dotnet, ".NET", MICROSOFT_PUBLISHER, ".NET", "*", "*", "*"),
    // Part of Windows, signed under its own product name (opens Edge, or IE mode for old sites).
    publisherRule(BASELINE_IDS.internetExplorer, "Internet Explorer", MICROSOFT_PUBLISHER, "INTERNET EXPLORER", "*", "*", "*"),
    pathRule(BASELINE_IDS.dotnetFolder, ".NET", EVERYONE, "%PROGRAMFILES%\\dotnet\\*"),
    pathRule(BASELINE_IDS.agent, "Endpoint IQ agent", EVERYONE, `${AGENT_FOLDER}\\*`),
    // Drivers' own tools (audio, graphics, touchpad, chipset), installed under Program Files.
    ...DRIVER_VENDOR_FOLDERS.map((f) => pathRule(stableGuid(`baseline:driver:${f.toLowerCase()}`), `Drivers: ${f}`, EVERYONE, `%PROGRAMFILES%\\${f}\\*`)),
    // Computer makers' utilities (Dell, HP, Lenovo...), installed under Program Files.
    ...HARDWARE_MAKER_FOLDERS.map((f) => pathRule(stableGuid(`baseline:hardware:${f.toLowerCase()}`), `Hardware: ${f}`, EVERYONE, `%PROGRAMFILES%\\${f}\\*`)),
  ];
  if (a.allowProgramFiles) out.push(pathRule(BASELINE_IDS.programFiles, "Program Files", EVERYONE, "%PROGRAMFILES%\\*"));
  if (a.exemptAdministrators) out.push(pathRule(BASELINE_IDS.administrators, "Administrators", ADMINISTRATORS, "*"));
  if (a.microsoftSigned === "ALL") {
    out.push(publisherRule(BASELINE_IDS.microsoftAll, "Microsoft-signed programs", MICROSOFT_PUBLISHER, "*", "*", "*", "*"));
  } else if (a.microsoftSigned === "SELECTED") {
    for (const product of a.microsoftProducts) {
      out.push(publisherRule(stableGuid(`ms-product:${product.toLowerCase()}`), `Microsoft: ${product}`, MICROSOFT_PUBLISHER, product, "*", "*", "*"));
    }
  }
  for (const r of a.rules) {
    if (appControlRuleProblem(r.ruleType, r.value)) {
      console.warn(`App Control: not applying allow rule ${r.ruleId} (${r.value}): ${appControlRuleProblem(r.ruleType, r.value)}`);
      continue;
    }
    if (r.ruleType === "ALLOW_PATH") {
      out.push(pathRule(r.ruleId, `Allow ${r.value.trim()}`, EVERYONE, allowPattern(r.value)));
    } else if (r.ruleType === "ALLOW_PUBLISHER") {
      const v = r.version?.trim();
      const low = r.versionMatch !== "ANY" && v ? fourPart(v) : "*";
      const high = r.versionMatch === "EXACT" && v ? fourPart(v) : "*";
      const label = [r.value.match(/O=("[^"]*"|[^,]*)/i)?.[1] ?? r.value, r.productName].filter(Boolean).join(" - ");
      out.push(publisherRule(r.ruleId, `Allow ${label}`, r.value.toUpperCase(), r.productName?.trim() || "*", r.fileName?.trim().toUpperCase() || "*", low, high));
    } else if (r.ruleType === "ALLOW_HASH") {
      const hash = r.value.replace(/^0x/i, "").toUpperCase();
      const file = r.fileName?.trim() || "program.exe";
      out.push(
        `<FileHashRule Id="${xmlAttr(r.ruleId)}" Name="${xmlAttr(`Endpoint IQ: Allow ${file}`.slice(0, 200))}" Description="${APPLOCKER_MARKER}" UserOrGroupSid="${EVERYONE}" Action="Allow">` +
          `<Conditions><FileHashCondition><FileHash Type="SHA256" Data="0x${hash}" SourceFileName="${xmlAttr(file)}" SourceFileLength="${Math.max(0, Math.trunc(r.fileSize ?? 0))}" /></FileHashCondition></Conditions></FileHashRule>`,
      );
    }
  }
  return out;
}

function packageRule(id: string, name: string, publisher: string): string {
  return (
    `<FilePublisherRule Id="${xmlAttr(id)}" Name="${xmlAttr(`Endpoint IQ: ${name}`.slice(0, 200))}" Description="${APPLOCKER_MARKER}" UserOrGroupSid="${EVERYONE}" Action="Allow">` +
    `<Conditions><FilePublisherCondition PublisherName="${xmlAttr(publisher)}" ProductName="*" BinaryName="*"><BinaryVersionRange LowSection="0.0.0.0" HighSection="*" /></FilePublisherCondition></Conditions></FilePublisherRule>`
  );
}

// Packaged apps (Microsoft Store / MSIX): Windows' and Microsoft's own, and the computer and chip
// makers'. Without these, enforcing program rules also stops Calculator, Photos, the Store and
// every other packaged app; any other Store app (WhatsApp, games...) stays blocked.
export function allowlistAppxRules(): string[] {
  return [
    ...MICROSOFT_PACKAGE_PUBLISHERS.map((p, i) => packageRule(i === 0 ? BASELINE_IDS.signedPackagedApps : stableGuid(`baseline:appx:${p.toLowerCase()}`), i === 0 ? "Windows apps" : "Microsoft apps", p)),
    ...HARDWARE_PACKAGE_PUBLISHERS.map((h) => packageRule(stableGuid(`baseline:appx:${h.publisher.toLowerCase()}`), `Hardware apps: ${h.name}`, h.publisher)),
  ];
}

// Installers: Windows' own installer cache (repairs and updates of installed software), and
// administrators when they choose to. Any other .msi a user starts is blocked.
export function allowlistMsiRules(a: AllowlistWire): string[] {
  const out = [pathRule(BASELINE_IDS.msiCache, "Windows Installer cache", EVERYONE, "%WINDIR%\\Installer\\*")];
  if (a.exemptAdministrators) out.push(pathRule(BASELINE_IDS.msiAdministrators, "Administrators", ADMINISTRATORS, "*"));
  return out;
}

export function desiredAppLocker(advancedRules: AppControlRuleWire[], rules: AppControlRuleWire[], allowlist?: AllowlistWire): Desired {
  const denies: DenyRule[] = [];
  for (const r of rules) {
    if (r.ruleType !== "EXTENSION") continue;
    const ext = (r.value.trim().startsWith(".") ? r.value.trim() : `.${r.value.trim()}`).toLowerCase();
    const collection: Collection | null = APPLOCKER_SCRIPT_EXTENSIONS.includes(ext) ? "Script" : APPLOCKER_MSI_EXTENSIONS.includes(ext) ? "Msi" : null;
    if (collection) denies.push({ id: r.ruleId, collection, name: `Block ${ext} files`, path: `*${ext}` });
  }
  const allows = [`${AGENT_FOLDER}\\*`];
  for (const r of advancedRules) {
    if (appControlRuleProblem(r.ruleType, r.value)) {
      console.warn(`App Control: not applying rule ${r.ruleId} (${r.value}): ${appControlRuleProblem(r.ruleType, r.value)}`);
      continue;
    }
    if (r.ruleType === "DLL") denies.push({ id: r.ruleId, collection: "Dll", name: `Block ${r.value.trim()}`, path: dllPattern(r.value) });
    else if (r.ruleType === "ALLOW_PATH") allows.push(allowPattern(r.value));
  }
  const exe = allowlist
    ? {
        rules: allowlistExeRules(allowlist),
        msiRules: allowlistMsiRules(allowlist),
        appxRules: allowlistAppxRules(),
        mode: allowlist.enforce ? ("Enabled" as const) : ("AuditOnly" as const),
      }
    : null;
  return { denies, allows: [...new Set(allows)], exe };
}

// Where a probe file for a rule can be made, to ask AppLocker whether the rule really blocks:
// only for rules that match anywhere ("*.ps1", "*\evil.dll") - a probe never goes outside PROBE_DIR.
function probeFor(rule: DenyRule): string | null {
  if (!rule.path.startsWith("*")) return null;
  const rest = rule.path.slice(1).replace(/[*?]/g, "x");
  return rest.startsWith("\\") ? path.join(PROBE_DIR, "probe", rest.slice(1)) : path.join(PROBE_DIR, `probe${rest}`);
}

export function xmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// The rules to add, as XML fragments per collection (inserted by the PowerShell below).
function ruleFragments(d: Desired): Record<Collection, string[]> {
  const out: Record<Collection, string[]> = { Script: [], Msi: [], Dll: [] };
  const exceptions = d.allows.map((a) => `<FilePathCondition Path="${xmlAttr(a)}" />`).join("");
  for (const r of d.denies) {
    out[r.collection].push(
      `<FilePathRule Id="${xmlAttr(r.id)}" Name="${xmlAttr(`Endpoint IQ: ${r.name}`.slice(0, 200))}" Description="${APPLOCKER_MARKER}" UserOrGroupSid="S-1-1-0" Action="Deny">` +
        `<Conditions><FilePathCondition Path="${xmlAttr(r.path)}" /></Conditions><Exceptions>${exceptions}</Exceptions></FilePathRule>`,
    );
  }
  return out;
}

export function buildApplyScript(d: Desired, probes: { id: string; path: string }[]): string {
  const fragments = ruleFragments(d);
  const collections = (Object.keys(fragments) as Collection[]).filter((c) => fragments[c].length > 0);
  const perCollection = collections
    .map((c) => {
      const allowAll =
        `<FilePathRule Id="${ALLOW_ALL_IDS[c]}" Name="Endpoint IQ: allow everything not blocked" Description="${APPLOCKER_MARKER}" UserOrGroupSid="S-1-1-0" Action="Allow">` +
        `<Conditions><FilePathCondition Path="*" /></Conditions></FilePathRule>`;
      return `Add-Rules '${c}' '${psEscape(allowAll)}' '${psEscape(`<r>${fragments[c].join("")}</r>`)}'`;
    })
    .join("\n");
  const exeCall = d.exe
    ? [
        `Add-Allowlist 'Exe' '${d.exe.mode}' '${psEscape(`<r>${d.exe.rules.join("")}</r>`)}'`,
        `Add-Allowlist 'Msi' '${d.exe.mode}' '${psEscape(`<r>${d.exe.msiRules.join("")}</r>`)}'`,
        `Add-Allowlist 'Appx' '${d.exe.mode}' '${psEscape(`<r>${d.exe.appxRules.join("")}</r>`)}'`,
      ].join("\n")
    : "";
  const probeList = probes.map((p) => `@{ id = '${psEscape(p.id)}'; path = '${psEscape(p.path)}' }`).join(", ");
  return `
$ErrorActionPreference = 'Stop'
$result = @{ applied = $false; service = ''; notDenied = @(); testError = $null; foreignAudit = @(); home = $false; exeMode = '' }

# Windows Home has no AppLocker enforcement.
try { $result.home = @(98, 99, 100, 101) -contains [int](Get-CimInstance Win32_OperatingSystem).OperatingSystemSKU } catch {}

# The Application Identity service enforces AppLocker.
try {
  $svc = Get-Service -Name AppIDSvc
  if ($svc.Status -ne 'Running') {
    & sc.exe config AppIDSvc start= auto 2>$null | Out-Null
    try { Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\AppIDSvc' -Name Start -Value 2 -Type DWord } catch {}
    Start-Service -Name AppIDSvc
    $svc.WaitForStatus('Running', [TimeSpan]::FromSeconds(15))
  }
  $result.service = [string](Get-Service -Name AppIDSvc).Status
} catch { $result.service = 'NotRunning: ' + $_.Exception.Message }

$xml = [xml](Get-AppLockerPolicy -Local -Xml)
$root = $xml.AppLockerPolicy
# Our earlier rules come out first; everything else stays.
foreach ($c in @($root.RuleCollection)) {
  if (-not $c) { continue }
  $ours = @($c.ChildNodes | Where-Object { $_.Description -eq '${APPLOCKER_MARKER}' })
  foreach ($r in $ours) { [void]$c.RemoveChild($r) }
  if ($ours.Count -gt 0 -and @($c.ChildNodes | Where-Object { $_.LocalName -like '*Rule' }).Count -eq 0) { $c.SetAttribute('EnforcementMode', 'NotConfigured') }
}

function Add-Rules($type, $allowAll, $denies) {
  $c = @($root.RuleCollection) | Where-Object { $_ -and $_.Type -eq $type } | Select-Object -First 1
  if (-not $c) {
    $c = $xml.CreateElement('RuleCollection')
    $c.SetAttribute('Type', $type)
    $c.SetAttribute('EnforcementMode', 'NotConfigured')
    [void]$root.AppendChild($c)
  }
  $foreign = @($c.ChildNodes | Where-Object { $_.LocalName -like '*Rule' }).Count
  if ($foreign -eq 0) {
    # A collection only we use: allow everything, block only what our rules name.
    $frag = $xml.CreateDocumentFragment(); $frag.InnerXml = $allowAll
    [void]$c.PrependChild($frag)
    $c.SetAttribute('EnforcementMode', 'Enabled')
  } elseif ($c.EnforcementMode -ne 'Enabled') {
    $script:result.foreignAudit += $type
  }
  $doc = [xml]$denies
  foreach ($n in @($doc.r.ChildNodes)) { [void]$c.AppendChild($xml.ImportNode($n, $true)) }
}

# Allowlist: allow rules only in the Exe, Msi and Appx collections; anything else a user starts is
# blocked (Appx: every signed packaged app is allowed). Someone else's rules there stay, with their own mode. Runs before the block rules, so a
# collection the allowlist uses never gets the "allow everything" rule.
function Add-Allowlist($type, $mode, $allows) {
  $c = @($root.RuleCollection) | Where-Object { $_ -and $_.Type -eq $type } | Select-Object -First 1
  if (-not $c) {
    $c = $xml.CreateElement('RuleCollection')
    $c.SetAttribute('Type', $type)
    $c.SetAttribute('EnforcementMode', 'NotConfigured')
    [void]$root.AppendChild($c)
  }
  $foreign = @($c.ChildNodes | Where-Object { $_.LocalName -like '*Rule' }).Count
  if ($foreign -eq 0) { $c.SetAttribute('EnforcementMode', $mode) }
  if ($type -eq 'Exe') { $script:result.exeMode = [string]$c.EnforcementMode }
  $doc = [xml]$allows
  foreach ($n in @($doc.r.ChildNodes)) { [void]$c.AppendChild($xml.ImportNode($n, $true)) }
}

${exeCall}
${perCollection}

$file = Join-Path $env:TEMP ('eiq-applocker-' + [guid]::NewGuid().ToString('N') + '.xml')
$xml.Save($file)
try {
  Set-AppLockerPolicy -XmlPolicy $file
  $result.applied = $true

  # Ask AppLocker whether each wildcard rule really blocks a matching file.
  $probes = @(${probeList})
  if ($probes.Count -gt 0) {
    try {
      foreach ($p in $probes) {
        New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($p.path)) -Force | Out-Null
        # Not empty: AppLocker can't evaluate a zero-byte file.
        [IO.File]::WriteAllText($p.path, "rem Endpoint IQ AppLocker probe")
      }
      $tests = @(Test-AppLockerPolicy -XmlPolicy $file -Path @($probes | ForEach-Object { $_.path }) -User Everyone)
      foreach ($p in $probes) {
        $t = $tests | Where-Object { $_.FilePath -eq $p.path } | Select-Object -First 1
        if (-not $t -or [string]$t.PolicyDecision -notlike 'Denied*') { $result.notDenied += $p.id }
      }
    } catch { $result.testError = $_.Exception.Message }
    Remove-Item -LiteralPath '${psEscape(PROBE_DIR)}' -Recurse -Force -ErrorAction SilentlyContinue
  }
} finally {
  Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
}
[Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
`;
}

// AppLocker's own record of what it blocked (8004: program or DLL, 8007: script or installer) and,
// with an allowlist in audit mode, what it would have blocked (8003) - with the program's signer
// (Fqbn), hash and user, so the console can turn it into an allow rule.
function buildEventsScript(since: string, withAudit: boolean): string {
  return `
$ErrorActionPreference = 'SilentlyContinue'
$since = [datetime]::Parse('${psEscape(since)}').ToUniversalTime().ToLocalTime()
$names = @{}
$out = @(Get-WinEvent -FilterHashtable @{ LogName = @('Microsoft-Windows-AppLocker/EXE and DLL', 'Microsoft-Windows-AppLocker/MSI and Script'); Id = @(${withAudit ? "8003, " : ""}8004, 8007); StartTime = $since } -MaxEvents 500 | ForEach-Object {
  $d = ([xml]$_.ToXml()).Event.UserData.RuleAndFileData
  $p = if ($d.FullFilePath) { [string]$d.FullFilePath } else { [string]$d.FilePath }
  $p = $p.Replace('%OSDRIVE%', $env:SystemDrive)
  $sid = [string]$d.TargetUser
  if ($sid -and -not $names.ContainsKey($sid)) {
    try { $names[$sid] = (New-Object System.Security.Principal.SecurityIdentifier($sid)).Translate([System.Security.Principal.NTAccount]).Value } catch { $names[$sid] = $sid }
  }
  $size = $null
  if ($_.Id -ne 8007) { try { $size = (Get-Item -LiteralPath $p -ErrorAction Stop).Length } catch {} }
  [pscustomobject]@{
    ruleId = ([string]$d.RuleId).Trim('{', '}').ToLowerInvariant(); path = $p; at = $_.TimeCreated.ToUniversalTime().ToString('o')
    id = $_.Id; fqbn = [string]$d.Fqbn; hash = [string]$d.FileHash; user = $(if ($sid) { $names[$sid] } else { $null }); size = $size
  }
})
[Console]::Out.WriteLine((ConvertTo-Json -InputObject $out -Compress))
`;
}

// "O=GOOGLE LLC, L=..., C=US\\GOOGLE CHROME\\CHROME.EXE\\131.0.6778.86" (or "-" when unsigned).
export function parseFqbn(fqbn: string): { publisher: string; productName: string | null; fileVersion: string | null } | null {
  const parts = (fqbn ?? "").trim().split("\\");
  if (parts.length < 4 || !/(^|,\s*)O=/i.test(parts[0])) return null;
  const version = parts[parts.length - 1];
  const product = parts[parts.length - 3];
  return {
    publisher: parts.slice(0, parts.length - 3).join("\\").trim(),
    productName: product && product !== "*" ? product : null,
    fileVersion: version && version !== "*" ? version : null,
  };
}

const AUDIT_REPORT_EVERY_MS = 60 * 60_000; // one "would have blocked" per program per hour
const auditReported = new Map<string, number>();

async function runPs(script: string, timeout = 120_000): Promise<string> {
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    maxBuffer: 4 * 1024 * 1024,
    timeout,
  });
  return stdout;
}

async function readState(): Promise<SavedState | null> {
  try {
    return JSON.parse(await fsp.readFile(appLockerStateFile(), "utf8")) as SavedState;
  } catch {
    return null;
  }
}

async function writeState(s: SavedState): Promise<void> {
  await fsp.mkdir(path.dirname(appLockerStateFile()), { recursive: true });
  await fsp.writeFile(appLockerStateFile(), JSON.stringify(s), "utf8");
}

let lastProblem: string | null = null;

// advanced: undefined while the server doesn't offer advanced application control (or the agent
// is paused / suspended by the desktop safety net) - every AppLocker rule we added comes out.
export async function syncAppLocker(
  advanced: AppControlRuleWire[] | undefined,
  rules: AppControlRuleWire[],
  allowlist?: AllowlistWire,
): Promise<AppLockerResult> {
  const state = await readState();
  const desired: Desired = advanced ? desiredAppLocker(advanced, rules, allowlist) : { denies: [], allows: [], exe: null };

  if (desired.denies.length === 0 && !desired.exe) {
    if (state) {
      await runPs(`$ErrorActionPreference = 'SilentlyContinue'\n${REMOVE_APPLOCKER_RULES_PS}`, 60_000).catch((err) => console.error("App Control: removing AppLocker rules failed", err));
      await fsp.rm(appLockerStateFile(), { force: true });
      console.log("App Control: AppLocker rules removed");
    }
    lastProblem = null;
    return { problem: null, events: [] };
  }

  const hash = createHash("sha256").update(JSON.stringify(desired)).digest("hex");
  const now = Date.now();
  let eventsSince = state?.eventsSince ?? new Date(now).toISOString();

  if (!state || state.hash !== hash || now - state.appliedAt > REAPPLY_EVERY_MS) {
    const probes = desired.denies.map((r) => ({ id: r.id, path: probeFor(r) })).filter((p): p is { id: string; path: string } => Boolean(p.path));
    try {
      if (probes.length) await ensureSecureDir(PROBE_DIR);
      const out = await runPs(buildApplyScript(desired, probes));
      const line = out.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{")).pop();
      const res = JSON.parse(line ?? "{}") as {
        applied?: boolean;
        service?: string;
        notDenied?: string[] | string;
        testError?: string | null;
        foreignAudit?: string[] | string;
        home?: boolean;
        exeMode?: string;
      };
      if (!res.applied) throw new Error(`AppLocker policy wasn't applied: ${out.trim().slice(0, 300)}`);
      const notDenied = ([] as string[]).concat(res.notDenied ?? []);
      const audit = ([] as string[]).concat(res.foreignAudit ?? []);
      const problems: string[] = [];
      if (res.home) problems.push("Windows Home doesn't enforce AppLocker, so DLL, script and allowlist rules aren't in force on this PC");
      if (res.service !== "Running") problems.push(`The Application Identity service (AppIDSvc) isn't running (${res.service}), so Windows isn't enforcing AppLocker rules`);
      if (desired.exe && res.exeMode && res.exeMode !== desired.exe.mode) {
        problems.push(
          `This device's own AppLocker policy sets program rules to ${res.exeMode === "AuditOnly" ? "audit only" : res.exeMode}, so the allowlist ${desired.exe.mode === "Enabled" ? "only records programs instead of blocking them" : "blocks programs instead of only recording them"}`,
        );
      }
      if (notDenied.length) {
        const names = desired.denies.filter((r) => notDenied.includes(r.id)).map((r) => r.path);
        problems.push(`Windows didn't confirm these AppLocker rules block anything: ${names.join(", ")}`);
      }
      if (audit.length) problems.push(`This device's own AppLocker policy has ${audit.join(", ")} rules in audit-only mode, so blocks there are only logged`);
      if (res.testError) console.warn(`App Control: couldn't test the AppLocker rules: ${res.testError}`);
      lastProblem = problems.length ? problems.join(". ") : null;
      if (!state) eventsSince = new Date(now - 5_000).toISOString();
      await writeState({ hash, appliedAt: now, ruleCount: desired.denies.length + (desired.exe?.rules.length ?? 0), eventsSince });
      console.log(
        `App Control: AppLocker rules applied (${desired.denies.length} block, ${desired.allows.length} allow` +
          `${desired.exe ? `, allowlist ${desired.exe.mode === "Enabled" ? "enforced" : "audit only"} with ${desired.exe.rules.length} rules` : ""})`,
      );
    } catch (err) {
      lastProblem = `AppLocker rules couldn't be applied: ${err instanceof Error ? err.message : String(err)}`.slice(0, 600);
      console.error(`App Control: ${lastProblem}`);
      return { problem: lastProblem, events: [] };
    }
  }

  // Blocks AppLocker recorded since the last sync, matched to our rules by rule id.
  const ours = new Set(desired.denies.map((r) => r.id.toLowerCase()));
  const events: RawEvent[] = [];
  let newest = eventsSince;
  try {
    type LogEvent = { ruleId: string; path: string; at: string; id?: number; fqbn?: string; hash?: string; user?: string | null; size?: number | null };
    const out = await runPs(buildEventsScript(eventsSince, desired.exe?.mode === "AuditOnly" || false), 60_000);
    const line = out.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("[") || l.startsWith("{")).pop();
    const parsed = line ? (JSON.parse(line) as LogEvent[] | LogEvent) : [];
    for (const e of ([] as LogEvent[]).concat(parsed)) {
      if (e.at > newest) newest = e.at;
      if (!e.path) continue;
      if (ours.has(e.ruleId)) {
        events.push({ kind: "app", ruleId: e.ruleId, path: e.path, at: e.at, closed: true, sessionId: 0 });
        continue;
      }
      // A program or installer no rule allowed: the allowlist's doing (8004 program blocked, 8007
      // installer blocked, 8003 would have been).
      const isProgram = (e.id === 8003 || e.id === 8004) && /\.(exe|com)$/i.test(e.path);
      const isInstaller = e.id === 8007 && /\.(msi|msp|mst)$/i.test(e.path);
      if (!desired.exe || e.ruleId !== NO_RULE_ID || (!isProgram && !isInstaller)) continue;
      const outcome = e.id === 8003 ? "AUDIT" : "BLOCKED";
      const key = `${outcome}|${e.path.toLowerCase()}`;
      if (outcome === "AUDIT" && now - (auditReported.get(key) ?? 0) < AUDIT_REPORT_EVERY_MS) continue;
      auditReported.set(key, now);
      const signer = parseFqbn(e.fqbn ?? "");
      const hash = (e.hash ?? "").replace(/^0x/i, "").toUpperCase();
      events.push({
        kind: "app",
        ruleId: null,
        path: e.path,
        at: e.at,
        closed: false,
        sessionId: 0,
        allowlist: {
          outcome,
          publisher: signer?.publisher ?? null,
          productName: signer?.productName ?? null,
          fileVersion: signer?.fileVersion ?? null,
          fileHash: /^[0-9A-F]{64}$/.test(hash) ? hash : null,
          fileSize: typeof e.size === "number" ? e.size : null,
          userName: e.user ?? null,
        },
      });
    }
    if (auditReported.size > 5000) auditReported.clear();
  } catch (err) {
    console.warn("App Control: reading AppLocker events failed", err);
  }
  if (newest !== eventsSince) {
    const s = await readState();
    // One millisecond on, so the newest event isn't read twice.
    if (s) await writeState({ ...s, eventsSince: new Date(new Date(newest).getTime() + 1).toISOString() });
  }
  return { problem: lastProblem, events };
}
