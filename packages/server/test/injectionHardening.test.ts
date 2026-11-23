// Input handling that ends up in PowerShell, Prisma, regexes or outbound requests.
// Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import AdmZip from "adm-zip";
import {
  isValidRemoteInstallTarget,
  isValidRemoteInstallUsername,
  networkScanTaskResultPayloadSchema,
  startRemoteInstallRequestSchema,
} from "@em/shared";
import { psEscape, psQuote } from "../src/utils/psQuote";
import { buildRemediationScript, buildUninstallScript } from "../src/services/remediationScripts";
import { buildRemoteInstallScript, describeExecFailure, isValidServerUrlList, REMOTE_INSTALL_ENV } from "../src/services/remoteInstall.service";
import { parseRegistryPol, previewGpoBackup, readZipEntryCapped, GpoImportError } from "../src/services/gpoImport.service";
import { evaluateRule, isSafeRegexPattern, safeRegexTest } from "../src/services/securityConfigEvaluate.util";
import { globMatch } from "../src/services/appControlUndefined.service";
import { smtpTargetChanged } from "../src/services/userRisk/notifications";

test("psQuote doubles ASCII and Unicode single quotes and drops NUL", () => {
  assert.equal(psQuote("it's"), "'it''s'");
  assert.equal(psQuote("a\u2018b\u2019c\u201Ad\u201Be"), "'a\u2018\u2018b\u2019\u2019c\u201A\u201Ad\u201B\u201Be'");
  assert.equal(psQuote("x\u2019; calc; \u2019"), "'x\u2019\u2019; calc; \u2019\u2019'");
  assert.equal(psEscape("a\0b"), "ab");
  assert.equal(psQuote(""), "''");
});

test("uninstall only runs machine-wide (HKLM) uninstall entries, never a per-user one", () => {
  const script = buildUninstallScript("Vulnerable App");
  const exec = script.indexOf("Start-Process cmd.exe");
  assert.ok(exec > 0);
  // The per-user lookup is only used to explain why nothing was run, and always exits first.
  const userLookup = script.indexOf("HKEY_USERS");
  const perUserExit = script.indexOf("installed per-user");
  assert.ok(userLookup > 0 && perUserExit > userLookup && perUserExit < exec);
  assert.ok(!/\$entry\s*=\s*\$userEntry/.test(script), "uninstall must not adopt the per-user entry");
  assert.ok(script.includes("HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"));
  assert.ok(script.includes("HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"));
  // The name is a proper literal even with a typographic apostrophe.
  assert.ok(buildUninstallScript("Bob\u2019s App").includes("$targetName = 'Bob\u2019\u2019s App'"));
  // Updaters (fixed vendor path) may still read a per-user entry for its version.
  assert.equal(buildRemediationScript("Google Chrome").action, "update");
});

test("remote install targets and usernames are strictly shaped", () => {
  for (const ok of ["10.0.0.5", "PC-01", "pc01.corp.example.com", "fe80::1", "2001:db8::1"]) assert.ok(isValidRemoteInstallTarget(ok), ok);
  for (const bad of ["-ComputerName x", "pc'; calc", "pc$(calc)", "a b", "", "pc\nx", ".corp"]) assert.ok(!isValidRemoteInstallTarget(bad), bad);
  for (const ok of ["CORP\\installer", ".\\admin", "admin", "installer@corp.example.com", "Local Admin"]) assert.ok(isValidRemoteInstallUsername(ok), ok);
  for (const bad of ["x'); calc; ('", "a\"b", "a$b", "a\\b\\c", " admin"]) assert.ok(!isValidRemoteInstallUsername(bad), bad);
  const base = { serverUrl: "https://srv:4000", targets: ["PC-01"] };
  assert.equal(startRemoteInstallRequestSchema.safeParse({ ...base, targets: ["PC-01'; calc"] }).success, false);
  assert.equal(startRemoteInstallRequestSchema.safeParse({ ...base, username: "x';calc;'", password: "p" }).success, false);
});

test("remote install script takes every value from the environment, not its text", () => {
  const script = buildRemoteInstallScript();
  for (const name of Object.values(REMOTE_INSTALL_ENV)) {
    assert.ok(script.includes(`$env:${name}`), name);
    assert.ok(script.includes(`Remove-Item Env:\\${name}`), `${name} cleared`);
  }
  assert.ok(script.includes("-ArgumentList $serverUrl, $token"));
  assert.ok(isValidServerUrlList("https://a:4000,http://10.0.0.1:4000"));
  assert.ok(!isValidServerUrlList("https://a'; calc; '"));
  assert.ok(!isValidServerUrlList("file:///c:/x"));
});

test("a failed PowerShell run is recorded without the command line or secrets", () => {
  const err = Object.assign(new Error("Command failed: powershell.exe -Command ... 'TOKEN123'"), {
    code: 1,
    cmd: "powershell.exe -Command ... TOKEN123",
    stderr: "Access denied for TOKEN123 / hunter2",
  });
  const text = describeExecFailure(err, ["hunter2", "TOKEN123"]);
  assert.ok(text.includes("exited with code 1"));
  assert.ok(text.includes("Access denied"));
  assert.ok(!text.includes("TOKEN123") && !text.includes("hunter2") && !text.includes("Command failed"));
  assert.ok(describeExecFailure(Object.assign(new Error("x"), { killed: true, signal: "SIGTERM" }), []).includes("timed out"));
});

test("network scan results: bad hostnames become null, bad hosts are dropped", () => {
  const parsed = networkScanTaskResultPayloadSchema.parse({
    status: "SUCCESS",
    hostsScanned: 3,
    completedAt: new Date().toISOString(),
    errorMessage: null,
    hosts: [
      { ipAddress: "10.0.0.1", macAddress: "00:11:22:33:44:55", hostname: "PC-01.corp", openPorts: [445], responseTimeMs: 3 },
      { ipAddress: "10.0.0.2", macAddress: "<script>", hostname: "x'; calc; '", openPorts: [445], responseTimeMs: 3 },
      { ipAddress: "10.0.0.3", macAddress: null, hostname: "a".repeat(5000), openPorts: [], responseTimeMs: null },
      { ipAddress: "not an ip; rm", macAddress: null, hostname: null, openPorts: [], responseTimeMs: null },
    ],
  });
  assert.equal(parsed.hosts.length, 3);
  assert.equal(parsed.hosts[0].hostname, "PC-01.corp");
  assert.equal(parsed.hosts[1].hostname, null);
  assert.equal(parsed.hosts[1].macAddress, null);
  assert.equal(parsed.hosts[2].hostname, null);
});

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

test("GPO import quotes Unicode apostrophes and skips names with control characters", () => {
  const GUID = "{6B6B7A26-3C1B-4C1E-9D3B-0F3A1C2B4D5E}";
  const pol = Buffer.concat([
    Buffer.from("PReg"),
    Buffer.from([1, 0, 0, 0]),
    polEntry("Software\\Policies\\X", "Name\u2019; calc; \u2019", 1, Buffer.from("v\u2019al\0", "utf16le")),
    polEntry("Software\\Policies\\X\nInjected", "Bad", 1, Buffer.from("v\0", "utf16le")),
  ]);
  assert.equal(parseRegistryPol(pol).length, 2);
  const zip = new AdmZip();
  zip.addFile(`GPOs/${GUID}/DomainSysvol/GPO/Machine/registry.pol`, pol);
  const preview = previewGpoBackup(zip.toBuffer());
  const rules = preview.gpos[0].rules;
  assert.equal(rules.length, 1);
  assert.ok(rules[0].remediationPowerShell.includes("-Name 'Name\u2019\u2019; calc; \u2019\u2019'"));
  assert.ok(rules[0].remediationPowerShell.includes("-Value 'v\u2019\u2019al'"));
  assert.ok(preview.gpos[0].skipped.some((s) => s.includes("Injected")));
});

test("GPO zip entries are capped by their actual decompressed size", () => {
  const zip = new AdmZip();
  zip.addFile("big.txt", Buffer.alloc(2 * 1024 * 1024)); // compresses to a few KB
  zip.addFile("small.txt", Buffer.from("hello"));
  const read = new AdmZip(zip.toBuffer());
  const big = read.getEntry("big.txt")!;
  assert.throws(() => readZipEntryCapped(big, 1024 * 1024), GpoImportError);
  assert.equal(readZipEntryCapped(big, 4 * 1024 * 1024).length, 2 * 1024 * 1024);
  assert.equal(readZipEntryCapped(read.getEntry("small.txt")!).toString(), "hello");
  // Sanity: the compressed stream is what the header says it is.
  assert.equal(zlib.inflateRawSync(big.getCompressedData()).length, 2 * 1024 * 1024);
});

test("REGEX_MATCH refuses catastrophic patterns and caps the input", () => {
  assert.ok(!isSafeRegexPattern("(a+)+$"));
  assert.ok(!isSafeRegexPattern("(a|aa*)*b"));
  assert.ok(!isSafeRegexPattern("(.*a){2,}"));
  assert.ok(!isSafeRegexPattern("(a)\\1"));
  assert.ok(!isSafeRegexPattern("a".repeat(501)));
  assert.ok(isSafeRegexPattern("^(\\d{1,3}\\.){3}\\d{1,3}$"));
  const started = Date.now();
  assert.equal(evaluateRule("REGEX_MATCH", "(a+)+$", `${"a".repeat(50)}!`), "FAIL");
  assert.ok(Date.now() - started < 1000);
  assert.equal(evaluateRule("REGEX_MATCH", "^Enabled$", "Enabled"), "PASS");
  assert.equal(safeRegexTest("[", "x"), false);
});

test("glob matching is linear-ish and anchored", () => {
  assert.ok(globMatch("google*", "Google Chrome"));
  assert.ok(globMatch("*chrome", "Google Chrome"));
  assert.ok(globMatch("g?ogle*", "Google Chrome"));
  assert.ok(!globMatch("chrome", "Google Chrome"));
  assert.ok(globMatch("a.b", "A.B") && !globMatch("a.b", "axb"));
  const started = Date.now();
  assert.ok(!globMatch("*a*a*a*a*a*a*a*a*a*b", "a".repeat(5000)));
  assert.ok(Date.now() - started < 1000);
});

test("changing the SMTP server, port or account needs the password again", () => {
  const stored = { host: "smtp.corp.com", port: 587, username: "alerts@corp.com" };
  assert.equal(smtpTargetChanged(stored, { ...stored }), false);
  assert.equal(smtpTargetChanged(stored, { ...stored, host: " SMTP.corp.com " }), false);
  assert.equal(smtpTargetChanged(stored, { ...stored, host: "evil.example" }), true);
  assert.equal(smtpTargetChanged(stored, { ...stored, port: 25 }), true);
  assert.equal(smtpTargetChanged(stored, { ...stored, username: "other@corp.com" }), true);
});
