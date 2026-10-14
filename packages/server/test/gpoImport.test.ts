// Builds a Group Policy backup in the same layout Backup-GPO / the Microsoft Security
// Compliance Toolkit produce, and checks what the importer makes of it.
// Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import AdmZip from "adm-zip";
import { parseRegistryPol, previewGpoBackup, GpoImportError } from "../src/services/gpoImport.service";
import { evaluateRule } from "../src/services/securityConfigEvaluate.util";

const GUID = "{6B6B7A26-3C1B-4C1E-9D3B-0F3A1C2B4D5E}";
const BASE = `GPOs/${GUID}`;

function polEntry(key: string, valueName: string, type: number, data: Buffer): Buffer {
  const u = (s: string) => Buffer.from(`${s}\0`, "utf16le");
  const ch = (c: string) => Buffer.from(c, "utf16le");
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  return Buffer.concat([ch("["), u(key), ch(";"), u(valueName), ch(";"), u32(type), ch(";"), u32(data.length), ch(";"), data, ch("]")]);
}

function dword(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}

function registryPol(): Buffer {
  return Buffer.concat([
    Buffer.from("PReg"),
    dword(1),
    polEntry("Software\\Policies\\Microsoft\\Windows\\WinRM\\Service", "AllowBasic", 4, dword(0)),
    polEntry("Software\\Policies\\Microsoft\\Windows NT\\Terminal Services", "MaxIdleTime", 4, dword(0xffffffff)),
    polEntry("Software\\Policies\\Microsoft\\Edge", "AuthSchemes", 1, Buffer.from("ntlm,negotiate\0", "utf16le")),
    polEntry("Software\\Policies\\Microsoft\\Windows\\Old", "**del.Legacy", 1, Buffer.from(" \0", "utf16le")),
    polEntry("Software\\Policies\\Microsoft\\Windows\\Whole", "**delvals.", 1, Buffer.from(" \0", "utf16le")),
  ]);
}

const GPT_TMPL = [
  "[Unicode]",
  "Unicode=yes",
  "[System Access]",
  "MinimumPasswordLength = 14",
  "PasswordComplexity = 1",
  'NewGuestName = "Visitor"',
  "[Privilege Rights]",
  "SeNetworkLogonRight = *S-1-5-32-555,*S-1-5-32-544",
  "SeDebugPrivilege = *S-1-5-32-544",
  "[Registry Values]",
  "MACHINE\\System\\CurrentControlSet\\Control\\Lsa\\LimitBlankPasswordUse=4,1",
  'MACHINE\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon\\ScRemoveOption=1,"1"',
  "[Version]",
  'signature="$CHICAGO$"',
].join("\r\n");

const AUDIT_CSV = [
  "Machine Name,Policy Target,Subcategory,Subcategory GUID,Inclusion Setting,Exclusion Setting,Setting Value",
  ",System,Audit Credential Validation,{0cce923f-69ae-11d9-bed3-505054503030},Success and Failure,,3",
  ",System,Audit Security Group Management,{0cce9237-69ae-11d9-bed3-505054503030},Success,,1",
  ",System,Option:CrashOnAuditFail,,Disabled,,0",
].join("\r\n");

function backupZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile(`${BASE}/bkupInfo.xml`, Buffer.from(`<BackupInst><GPODisplayName><![CDATA[MSFT Windows 11 - Computer]]></GPODisplayName></BackupInst>`));
  zip.addFile(`${BASE}/DomainSysvol/GPO/Machine/registry.pol`, registryPol());
  zip.addFile(
    `${BASE}/DomainSysvol/GPO/Machine/microsoft/windows nt/SecEdit/GptTmpl.inf`,
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(GPT_TMPL, "utf16le")]),
  );
  zip.addFile(`${BASE}/DomainSysvol/GPO/Machine/microsoft/windows nt/Audit/audit.csv`, Buffer.from(AUDIT_CSV));
  zip.addFile(`${BASE}/DomainSysvol/GPO/User/registry.pol`, Buffer.concat([Buffer.from("PReg"), dword(1)]));
  return zip.toBuffer();
}

test("parseRegistryPol reads entries", () => {
  const entries = parseRegistryPol(registryPol());
  assert.equal(entries.length, 5);
  assert.equal(entries[0].key, "Software\\Policies\\Microsoft\\Windows\\WinRM\\Service");
  assert.equal(entries[0].valueName, "AllowBasic");
  assert.equal(entries[0].type, 4);
});

test("previewGpoBackup converts a computer GPO into rules", () => {
  const { gpos } = previewGpoBackup(backupZip());
  assert.equal(gpos.length, 1);
  const gpo = gpos[0];
  assert.equal(gpo.name, "MSFT Windows 11 - Computer");
  const byTitle = (prefix: string) => gpo.rules.find((r) => r.title.startsWith(prefix));

  const allowBasic = byTitle("AllowBasic = 0")!;
  assert.equal(allowBasic.operator, "EQUALS");
  assert.equal(allowBasic.expectedValue, "0");
  assert.match(allowBasic.checkPowerShell, /Registry::HKEY_LOCAL_MACHINE\\Software\\Policies\\Microsoft\\Windows\\WinRM\\Service/);
  assert.match(allowBasic.remediationPowerShell!, /-PropertyType DWord -Value 0/);

  // 0xFFFFFFFF is what PowerShell prints as -1
  assert.equal(byTitle("MaxIdleTime")!.expectedValue, "-1");
  assert.equal(byTitle("AuthSchemes")!.expectedValue, "ntlm,negotiate");
  assert.equal(byTitle("Legacy must not be set")!.expectedValue, "Not configured");

  const minLen = byTitle("Minimum password length")!;
  assert.equal(minLen.operator, "GTE");
  assert.equal(minLen.expectedValue, "14");

  // accounts are sorted so the agent's (sorted) output compares equal
  assert.equal(byTitle("User right SeNetworkLogonRight")!.expectedValue, "*S-1-5-32-544,*S-1-5-32-555");
  assert.equal(byTitle("LimitBlankPasswordUse = 1")!.expectedValue, "1");
  assert.equal(byTitle("ScRemoveOption = 1")!.expectedValue, "1");

  const credVal = byTitle("Audit Audit Credential Validation")!;
  assert.equal(credVal.expectedValue, "Success and Failure");
  const groupMgmt = byTitle("Audit Audit Security Group Management")!;
  assert.equal(groupMgmt.operator, "CONTAINS");
  assert.equal(evaluateRule(groupMgmt.operator, groupMgmt.expectedValue, "Success and Failure"), "PASS");

  assert.ok(gpo.skipped.some((s) => s.includes("**delvals.")));
  assert.ok(gpo.skipped.some((s) => s.includes("NewGuestName")));
  assert.ok(gpo.warnings.some((w) => w.includes("User configuration")));

  for (const r of gpo.rules) {
    assert.ok(r.ruleKey.length <= 50, r.ruleKey);
    assert.ok(r.title.length <= 300);
    assert.ok(r.expectedValue.length <= 500);
  }
  assert.equal(new Set(gpo.rules.map((r) => r.ruleKey)).size, gpo.rules.length);
});

test("rule keys are stable across imports", () => {
  const a = previewGpoBackup(backupZip()).gpos[0].rules.map((r) => r.ruleKey);
  const b = previewGpoBackup(backupZip()).gpos[0].rules.map((r) => r.ruleKey);
  assert.deepEqual(a, b);
});

test("rejects archives that aren't GPO backups", () => {
  const zip = new AdmZip();
  zip.addFile("readme.txt", Buffer.from("hello"));
  assert.throws(() => previewGpoBackup(zip.toBuffer()), GpoImportError);
  assert.throws(() => previewGpoBackup(Buffer.from("not a zip")), GpoImportError);
});
