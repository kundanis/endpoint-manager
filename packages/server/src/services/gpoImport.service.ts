import crypto from "node:crypto";
import zlib from "node:zlib";
import AdmZip from "adm-zip";
import type { CreateRuleRequest, GpoImportPreview, GpoImportPreviewGpo } from "@em/shared";
import { psQuote } from "../utils/psQuote";

// Turns a Group Policy backup (.zip) into security benchmark rules. Works with Microsoft's
// Security Compliance Toolkit baselines and CIS "Build Kit" GPOs alike - both are standard
// GPO backups:
//
//   <any folder>/{GUID}/bkupInfo.xml                                    GPO display name
//   <any folder>/{GUID}/DomainSysvol/GPO/Machine/registry.pol            Administrative Templates
//   .../Machine/microsoft/windows nt/SecEdit/GptTmpl.inf                 account policy, user rights,
//                                                                        security options
//   .../Machine/microsoft/windows nt/Audit/audit.csv                     advanced audit policy
//
// Only computer settings are converted: the agent runs as SYSTEM, so per-user (User\)
// settings can't be checked from it. Each rule is a self-contained PowerShell check plus a
// remediation, the same shape as hand-written rules. Rule keys are derived from the setting
// itself (not the GPO), so importing the same baseline twice adds nothing new.
//
// The zip is only read in memory - nothing is extracted to disk.

const MAX_ZIP_ENTRIES = 5_000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_EXPECTED_LENGTH = 500;
const MAX_TITLE_LENGTH = 300;

type Rule = CreateRuleRequest;

const NOT_CONFIGURED = "Not configured";

// Every name and value from an imported GPO ends up in PowerShell that runs on endpoints as
// SYSTEM. Values are always single-quoted with psQuote; on top of that, anything with control
// or other non-printable characters (which no real policy setting has) is skipped outright.
const NON_PRINTABLE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

function printable(...values: string[]): boolean {
  return values.every((v) => !NON_PRINTABLE.test(v));
}

// Security policy / user right names (MinimumPasswordAge, SeDebugPrivilege): plain identifiers.
const POLICY_NAME = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;

function ruleKey(kind: string, identity: string): string {
  return `gpo-${kind}-${crypto.createHash("sha1").update(identity.toLowerCase()).digest("hex").slice(0, 16)}`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

// ---- registry values (registry.pol and GptTmpl.inf [Registry Values]) -------------------

type RegType = "String" | "ExpandString" | "Binary" | "DWord" | "MultiString" | "QWord";

interface RegSetting {
  key: string; // without hive, e.g. SOFTWARE\Policies\Microsoft\Windows\WinRM\Service
  valueName: string;
  type: RegType;
  // As PowerShell prints the raw value: DWORD as signed Int32, multi-string / binary
  // joined with commas.
  display: string;
  // PowerShell expression for New-ItemProperty -Value
  psValue: string;
}

// Output of every registry check: the raw (unexpanded) value, or "Not configured".
function registryCheck(key: string, valueName: string): string {
  return [
    `$k = Get-Item -LiteralPath ${psQuote(`Registry::HKEY_LOCAL_MACHINE\\${key}`)} -ErrorAction SilentlyContinue`,
    `$v = if ($k) { $k.GetValue(${psQuote(valueName)}, $null, 'DoNotExpandEnvironmentNames') } else { $null }`,
    `if ($null -eq $v) { '${NOT_CONFIGURED}' } elseif ($v -is [array]) { $v -join ',' } else { [string]$v }`,
  ].join("; ");
}

function registryRule(s: RegSetting, gpoName: string): Rule | null {
  if (!s.valueName || s.display.length > MAX_EXPECTED_LENGTH) return null;
  if (!printable(s.key, s.valueName, s.display, s.psValue)) return null;
  const path = `Registry::HKEY_LOCAL_MACHINE\\${s.key}`;
  const shortKey = s.key.split("\\").slice(-2).join("\\");
  return {
    ruleKey: ruleKey("reg", `${s.key}\\${s.valueName}`),
    title: truncate(`${s.valueName} = ${s.display === "" ? "(empty)" : s.display} (${shortKey})`, MAX_TITLE_LENGTH),
    description: `HKLM\\${s.key}\\${s.valueName} must be ${s.type} ${s.display === "" ? "(empty)" : s.display}. From GPO "${gpoName}".`,
    severity: "MEDIUM",
    checkPowerShell: registryCheck(s.key, s.valueName),
    operator: "EQUALS",
    expectedValue: s.display,
    remediationPowerShell: [
      `$p = ${psQuote(path)}`,
      `if (-not (Test-Path -LiteralPath $p)) { New-Item -Path $p -Force | Out-Null }`,
      `New-ItemProperty -LiteralPath $p -Name ${psQuote(s.valueName)} -PropertyType ${s.type} -Value ${s.psValue} -Force | Out-Null`,
    ].join("; "),
  };
}

function registryDeleteRule(key: string, valueName: string, gpoName: string): Rule | null {
  if (!valueName || !printable(key, valueName)) return null;
  const path = `Registry::HKEY_LOCAL_MACHINE\\${key}`;
  return {
    ruleKey: ruleKey("reg", `${key}\\${valueName}`),
    title: truncate(`${valueName} must not be set (${key.split("\\").slice(-2).join("\\")})`, MAX_TITLE_LENGTH),
    description: `HKLM\\${key}\\${valueName} must not exist. From GPO "${gpoName}".`,
    severity: "MEDIUM",
    checkPowerShell: registryCheck(key, valueName),
    operator: "EQUALS",
    expectedValue: NOT_CONFIGURED,
    remediationPowerShell: `Remove-ItemProperty -LiteralPath ${psQuote(path)} -Name ${psQuote(valueName)} -ErrorAction SilentlyContinue`,
  };
}

function psStringArray(items: string[]): string {
  return `@(${items.map(psQuote).join(",")})`;
}

const REG_SZ = 1;
const REG_EXPAND_SZ = 2;
const REG_BINARY = 3;
const REG_DWORD = 4;
const REG_MULTI_SZ = 7;
const REG_QWORD = 11;

function settingFromPolData(key: string, valueName: string, type: number, data: Buffer): RegSetting | null {
  const utf16 = () => data.toString("utf16le").replace(/\0+$/, "");
  switch (type) {
    case REG_SZ:
    case REG_EXPAND_SZ: {
      const s = utf16();
      return { key, valueName, type: type === REG_SZ ? "String" : "ExpandString", display: s, psValue: psQuote(s) };
    }
    case REG_DWORD: {
      if (data.length < 4) return null;
      const n = data.readInt32LE(0); // PowerShell reports DWORDs as signed Int32
      return { key, valueName, type: "DWord", display: String(n), psValue: String(n) };
    }
    case REG_QWORD: {
      if (data.length < 8) return null;
      const n = data.readBigInt64LE(0);
      return { key, valueName, type: "QWord", display: n.toString(), psValue: n.toString() };
    }
    case REG_MULTI_SZ: {
      const items = utf16().split("\0").filter(Boolean);
      return { key, valueName, type: "MultiString", display: items.join(","), psValue: psStringArray(items) };
    }
    case REG_BINARY: {
      const bytes = [...data];
      return { key, valueName, type: "Binary", display: bytes.join(","), psValue: `([byte[]](${bytes.join(",") || ""}))` };
    }
    default:
      return null;
  }
}

// registry.pol ("PReg" v1): a header, then entries of the form
//   [key;value;type;size;data]   - delimiters and strings are UTF-16LE, type/size uint32 LE
// Exported for tests.
export function parseRegistryPol(buf: Buffer): { key: string; valueName: string; type: number; data: Buffer }[] {
  if (buf.length < 8 || buf.toString("ascii", 0, 4) !== "PReg") throw new Error("Not a registry.pol file");
  const entries: { key: string; valueName: string; type: number; data: Buffer }[] = [];
  let pos = 8;
  const readChar = () => {
    const c = buf.readUInt16LE(pos);
    pos += 2;
    return c;
  };
  const readString = () => {
    const start = pos;
    while (pos + 1 < buf.length && buf.readUInt16LE(pos) !== 0) pos += 2;
    const s = buf.toString("utf16le", start, pos);
    pos += 2; // terminating null
    return s;
  };
  const SEMI = 0x3b;
  while (pos + 2 <= buf.length) {
    if (readChar() !== 0x5b) break; // '['
    const key = readString();
    if (readChar() !== SEMI) break;
    const valueName = readString();
    if (readChar() !== SEMI) break;
    const type = buf.readUInt32LE(pos);
    pos += 4;
    if (readChar() !== SEMI) break;
    const size = buf.readUInt32LE(pos);
    pos += 4;
    if (readChar() !== SEMI) break;
    const data = buf.subarray(pos, pos + size);
    pos += size;
    if (readChar() !== 0x5d) break; // ']'
    entries.push({ key, valueName, type, data });
  }
  return entries;
}

function rulesFromRegistryPol(buf: Buffer, gpoName: string, skipped: string[]): Rule[] {
  const rules: Rule[] = [];
  for (const e of parseRegistryPol(buf)) {
    const lower = e.valueName.toLowerCase();
    if (lower.startsWith("**del.")) {
      const rule = registryDeleteRule(e.key, e.valueName.slice(6), gpoName);
      if (rule) rules.push(rule);
      else skipped.push(`${e.key}\\${e.valueName}`);
      continue;
    }
    if (lower.startsWith("**")) {
      // **delvals / **DeleteValues / **DeleteKeys / **SecureKey / **soft. - key-level
      // operations with no single value to check.
      skipped.push(`${e.key}: ${e.valueName}`);
      continue;
    }
    const setting = settingFromPolData(e.key, e.valueName, e.type, e.data);
    const rule = setting ? registryRule(setting, gpoName) : null;
    if (rule) rules.push(rule);
    else skipped.push(`${e.key}\\${e.valueName}`);
  }
  return rules;
}

// ---- GptTmpl.inf -------------------------------------------------------------------------

function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString("utf16le", 2);
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString("utf8", 3);
  return buf.toString("utf8");
}

// Exported for tests.
export function parseInf(text: string): Map<string, [string, string][]> {
  const sections = new Map<string, [string, string][]>();
  let current: [string, string][] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";")) continue;
    const section = /^\[(.+)\]$/.exec(line);
    if (section) {
      current = [];
      sections.set(section[1].toLowerCase(), current);
      continue;
    }
    const eq = line.indexOf("=");
    if (current && eq > 0) current.push([line.slice(0, eq).trim(), line.slice(eq + 1).trim()]);
  }
  return sections;
}

// Settings where a stricter value than the baseline's is also compliant.
const AT_LEAST = new Set(["minimumpasswordlength", "passwordhistorysize", "lockoutduration", "resetlockoutcount", "minimumpasswordage"]);
const SYSTEM_ACCESS_TITLES: Record<string, string> = {
  minimumpasswordage: "Minimum password age (days)",
  maximumpasswordage: "Maximum password age (days)",
  minimumpasswordlength: "Minimum password length",
  passwordcomplexity: "Password must meet complexity requirements",
  passwordhistorysize: "Enforce password history",
  lockoutbadcount: "Account lockout threshold",
  resetlockoutcount: "Reset account lockout counter after (minutes)",
  lockoutduration: "Account lockout duration (minutes)",
  cleartextpassword: "Store passwords using reversible encryption",
  lsaanonymousnamelookup: "Allow anonymous SID/Name translation",
  enableadminaccount: "Administrator account status",
  enableguestaccount: "Guest account status",
  forcelogoffwhenhourexpire: "Force logoff when logon hours expire",
};

const SECEDIT_EXPORT = (area: string) =>
  `$f = Join-Path $env:TEMP 'em-secpol-export.inf'; secedit /export /cfg $f /areas ${area} /quiet | Out-Null`;

function seceditConfigure(section: string, line: string, area: string): string {
  return [
    `$inf = Join-Path $env:TEMP 'em-secpol-apply.inf'`,
    `@('[Unicode]', 'Unicode=yes', '[Version]', 'signature="$CHICAGO$"', 'Revision=1', '[${section}]', ${psQuote(line)}) | Set-Content -Path $inf -Encoding Unicode`,
    // A fresh database each time, so only this one setting is applied.
    `$db = Join-Path $env:TEMP 'em-secpol-apply.sdb'; Remove-Item $db -ErrorAction SilentlyContinue`,
    `secedit /configure /db $db /cfg $inf /areas ${area} /quiet | Out-Null`,
  ].join("; ");
}

function systemAccessRule(name: string, value: string, gpoName: string): Rule | null {
  if (!/^-?\d+$/.test(value)) return null; // renames (NewAdministratorName = "...") are site-specific
  if (!POLICY_NAME.test(name)) return null;
  const lower = name.toLowerCase();
  const label = SYSTEM_ACCESS_TITLES[lower] ?? name;
  const atLeast = AT_LEAST.has(lower);
  return {
    ruleKey: ruleKey("sa", name),
    title: truncate(`${label}: ${atLeast ? ">= " : ""}${value}`, MAX_TITLE_LENGTH),
    description: `Security policy ${name} ${atLeast ? "at least" : "equals"} ${value}. From GPO "${gpoName}".`,
    severity: lower.includes("password") || lower.includes("lockout") ? "HIGH" : "MEDIUM",
    checkPowerShell: [
      SECEDIT_EXPORT("SECURITYPOLICY"),
      `$line = Select-String -Path $f -Pattern ${psQuote(`^${name}\\s*=`)} | Select-Object -First 1`,
      `if ($line) { $line.Line.Split('=', 2)[1].Trim() } else { '${NOT_CONFIGURED}' }`,
    ].join("; "),
    operator: atLeast ? "GTE" : "EQUALS",
    expectedValue: value,
    remediationPowerShell: seceditConfigure("System Access", `${name} = ${value}`, "SECURITYPOLICY"),
  };
}

// "*S-1-5-32-544,*S-1-5-32-555" -> ordinal-sorted, so the agent's output (sorted the same
// way) compares equal.
function normalizeAccounts(value: string): string {
  const items = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return items.length ? items.join(",") : "None";
}

function privilegeRule(name: string, value: string, gpoName: string): Rule | null {
  const expected = normalizeAccounts(value);
  if (expected.length > MAX_EXPECTED_LENGTH) return null;
  if (!POLICY_NAME.test(name) || !printable(value)) return null;
  return {
    ruleKey: ruleKey("priv", name),
    title: truncate(`User right ${name}: ${expected === "None" ? "no one" : expected}`, MAX_TITLE_LENGTH),
    description: `User rights assignment ${name} must be exactly: ${expected === "None" ? "no one" : expected}. From GPO "${gpoName}".`,
    severity: "MEDIUM",
    checkPowerShell: [
      SECEDIT_EXPORT("USER_RIGHTS"),
      `$line = Select-String -Path $f -Pattern ${psQuote(`^${name}\\s*=`)} | Select-Object -First 1`,
      `if (-not $line) { 'None' } else { [string[]]$a = $line.Line.Split('=', 2)[1].Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }; if (-not $a) { 'None' } else { [Array]::Sort($a, [StringComparer]::Ordinal); $a -join ',' } }`,
    ].join("; "),
    operator: "EQUALS",
    expectedValue: expected,
    remediationPowerShell: seceditConfigure("Privilege Rights", `${name} = ${value}`, "USER_RIGHTS"),
  };
}

const INF_REG_TYPES: Record<string, number> = { "1": REG_SZ, "2": REG_EXPAND_SZ, "3": REG_BINARY, "4": REG_DWORD, "7": REG_MULTI_SZ };

function infRegistrySetting(path: string, raw: string): RegSetting | null {
  // MACHINE\System\CurrentControlSet\Control\Lsa\LimitBlankPasswordUse = 4,1
  if (!/^machine\\/i.test(path)) return null;
  const parts = path.slice("MACHINE\\".length).split("\\");
  const valueName = parts.pop() ?? "";
  const key = parts.join("\\");
  const comma = raw.indexOf(",");
  const typeCode = comma >= 0 ? raw.slice(0, comma) : raw;
  const value = comma >= 0 ? raw.slice(comma + 1) : "";
  const type = INF_REG_TYPES[typeCode.trim()];
  const unquote = (s: string) => s.trim().replace(/^"(.*)"$/, "$1");
  switch (type) {
    case REG_DWORD: {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      const signed = n | 0;
      return { key, valueName, type: "DWord", display: String(signed), psValue: String(signed) };
    }
    case REG_SZ:
    case REG_EXPAND_SZ: {
      const s = unquote(value);
      return { key, valueName, type: type === REG_SZ ? "String" : "ExpandString", display: s, psValue: psQuote(s) };
    }
    case REG_MULTI_SZ: {
      const items = value.split(",").map(unquote).filter(Boolean);
      return { key, valueName, type: "MultiString", display: items.join(","), psValue: psStringArray(items) };
    }
    default:
      return null;
  }
}

function rulesFromGptTmpl(buf: Buffer, gpoName: string, skipped: string[]): Rule[] {
  const sections = parseInf(decodeText(buf));
  const rules: Rule[] = [];
  for (const [name, value] of sections.get("system access") ?? []) {
    const rule = systemAccessRule(name, value, gpoName);
    if (rule) rules.push(rule);
    else skipped.push(`System Access: ${name}`);
  }
  for (const [name, value] of sections.get("privilege rights") ?? []) {
    const rule = privilegeRule(name, value, gpoName);
    if (rule) rules.push(rule);
    else skipped.push(`Privilege Rights: ${name}`);
  }
  for (const [path, value] of sections.get("registry values") ?? []) {
    const setting = infRegistrySetting(path, value);
    const rule = setting ? registryRule(setting, gpoName) : null;
    if (rule) rules.push(rule);
    else skipped.push(`Registry Values: ${path}`);
  }
  for (const section of ["event audit", "service general setting", "kerberos policy", "group membership", "file security", "registry keys"]) {
    for (const [name] of sections.get(section) ?? []) skipped.push(`${section}: ${name}`);
  }
  return rules;
}

// ---- audit.csv (advanced audit policy) --------------------------------------------------

const AUDIT_SETTINGS: Record<string, { label: string; operator: "EQUALS" | "CONTAINS"; expected: string; flags: string }> = {
  "0": { label: "No Auditing", operator: "EQUALS", expected: "No Auditing", flags: "/success:disable /failure:disable" },
  "1": { label: "Success", operator: "CONTAINS", expected: "Success", flags: "/success:enable" },
  "2": { label: "Failure", operator: "CONTAINS", expected: "Failure", flags: "/failure:enable" },
  "3": { label: "Success and Failure", operator: "EQUALS", expected: "Success and Failure", flags: "/success:enable /failure:enable" },
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function rulesFromAuditCsv(buf: Buffer, gpoName: string, skipped: string[]): Rule[] {
  const lines = decodeText(buf).split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iSub = col("subcategory");
  const iGuid = col("subcategory guid");
  const iValue = col("setting value");
  if (iSub < 0 || iGuid < 0 || iValue < 0) return [];

  const rules: Rule[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const sub = cells[iSub];
    const guid = cells[iGuid];
    const setting = AUDIT_SETTINGS[cells[iValue]];
    if (!/^\{[0-9a-f-]{36}\}$/i.test(guid ?? "") || !setting) {
      if (sub) skipped.push(`Audit: ${sub}`);
      continue;
    }
    rules.push({
      ruleKey: ruleKey("audit", guid),
      title: truncate(`Audit ${sub}: ${setting.label}`, MAX_TITLE_LENGTH),
      description: `Advanced audit policy "${sub}" ${setting.operator === "CONTAINS" ? "includes" : "is"} ${setting.label}. From GPO "${gpoName}".`,
      severity: "MEDIUM",
      checkPowerShell: `$r = auditpol /get /subcategory:'${guid}' /r | ConvertFrom-Csv | Select-Object -First 1; if ($r) { $r.'Inclusion Setting' } else { 'Unknown' }`,
      operator: setting.operator,
      expectedValue: setting.expected,
      remediationPowerShell: `auditpol /set /subcategory:'${guid}' ${setting.flags} | Out-Null`,
    });
  }
  return rules;
}

// ---- backup zip --------------------------------------------------------------------------

const GPO_DIR = /(?:^|\/)(\{[0-9a-f-]{36}\})\//i;

function gpoDisplayName(xml: string): string | null {
  const m =
    /<GPODisplayName>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/GPODisplayName>/is.exec(xml) ??
    /<DisplayName>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/DisplayName>/is.exec(xml);
  return m ? m[1].trim() : null;
}

export class GpoImportError extends Error {}

// Reads one zip entry, refusing more than MAX_FILE_BYTES of *decompressed* output. The size in
// the entry's header is whatever the archive claims, so a zip bomb can understate it; the
// deflate stream is inflated here with a hard output cap instead of trusting it (and without
// relying on adm-zip's own inflate, whose behaviour differs between versions). Exported for tests.
export function readZipEntryCapped(entry: AdmZip.IZipEntry, maxBytes = MAX_FILE_BYTES): Buffer {
  const { method, encrypted } = entry.header as { method: number; encrypted?: boolean };
  if (encrypted) throw new GpoImportError(`${entry.entryName} is password-protected.`);
  const compressed = entry.getCompressedData();
  if (method === 0) {
    if (compressed.length > maxBytes) throw new GpoImportError(`${entry.entryName} is unexpectedly large.`);
    return compressed;
  }
  if (method !== 8) throw new GpoImportError(`${entry.entryName} uses an unsupported compression method.`);
  try {
    return zlib.inflateRawSync(compressed, { maxOutputLength: maxBytes });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (err instanceof RangeError || code === "ERR_BUFFER_TOO_LARGE") {
      throw new GpoImportError(`${entry.entryName} is unexpectedly large.`);
    }
    throw new GpoImportError(`${entry.entryName} could not be decompressed.`);
  }
}

export function previewGpoBackup(zipBuffer: Buffer): GpoImportPreview {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    throw new GpoImportError("That file isn't a valid .zip archive.");
  }
  const entries = zip.getEntries();
  if (entries.length > MAX_ZIP_ENTRIES) throw new GpoImportError("The archive has too many files to be a GPO backup.");

  // Group the interesting files by GPO folder ({GUID}).
  const gpos = new Map<string, { name: string | null; pol?: Buffer; inf?: Buffer; audit?: Buffer; userSettings: boolean }>();
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const path = entry.entryName.replace(/\\/g, "/");
    const guid = GPO_DIR.exec(path)?.[1]?.toUpperCase();
    if (!guid) continue;
    const lower = path.toLowerCase();
    const isWanted =
      lower.endsWith("/bkupinfo.xml") ||
      lower.endsWith("/backup.xml") ||
      lower.endsWith("/machine/registry.pol") ||
      lower.endsWith("/machine/microsoft/windows nt/secedit/gpttmpl.inf") ||
      lower.endsWith("/machine/microsoft/windows nt/audit/audit.csv") ||
      lower.endsWith("/user/registry.pol");
    if (!isWanted) continue;
    if (entry.header.size > MAX_FILE_BYTES) throw new GpoImportError(`${path} is unexpectedly large.`);

    const gpo = gpos.get(guid) ?? { name: null, userSettings: false };
    gpos.set(guid, gpo);
    const data = readZipEntryCapped(entry);
    if (lower.endsWith("/bkupinfo.xml") || (lower.endsWith("/backup.xml") && !gpo.name)) {
      gpo.name = gpoDisplayName(decodeText(data)) ?? gpo.name;
    } else if (lower.endsWith("/machine/registry.pol")) gpo.pol = data;
    else if (lower.endsWith("/gpttmpl.inf")) gpo.inf = data;
    else if (lower.endsWith("/audit.csv")) gpo.audit = data;
    else if (lower.endsWith("/user/registry.pol")) gpo.userSettings = true;
  }

  const result: GpoImportPreviewGpo[] = [];
  for (const [guid, gpo] of gpos) {
    if (!gpo.pol && !gpo.inf && !gpo.audit && !gpo.userSettings) continue;
    const name = gpo.name ?? guid;
    const skipped: string[] = [];
    const rules: Rule[] = [];
    const warnings: string[] = [];
    try {
      if (gpo.pol) rules.push(...rulesFromRegistryPol(gpo.pol, name, skipped));
    } catch (err) {
      warnings.push(`registry.pol could not be read: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (gpo.inf) rules.push(...rulesFromGptTmpl(gpo.inf, name, skipped));
    if (gpo.audit) rules.push(...rulesFromAuditCsv(gpo.audit, name, skipped));
    if (gpo.userSettings) warnings.push("User configuration settings were ignored - the agent checks computer settings only.");

    // The same setting can appear twice within one GPO (e.g. registry.pol and GptTmpl.inf).
    const seen = new Set<string>();
    const unique = rules.filter((r) => (seen.has(r.ruleKey) ? false : (seen.add(r.ruleKey), true)));
    result.push({ guid, name, rules: unique, skipped, warnings });
  }

  if (result.length === 0) {
    throw new GpoImportError(
      "No Group Policy backups found in the archive. Expected folders named {GUID} containing DomainSysvol\\GPO\\Machine (as produced by Backup-GPO, the Microsoft Security Compliance Toolkit or a CIS Build Kit).",
    );
  }
  return { gpos: result.sort((a, b) => a.name.localeCompare(b.name)) };
}
