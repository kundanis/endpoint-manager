// Allowlist (application control): the AppLocker program rules and Windows' event fields.
// Run with: npm test -w @em/agent
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AllowlistWire } from "@em/shared";
import { allowlistAppxRules, allowlistExeRules, allowlistMsiRules, buildApplyScript, desiredAppLocker, parseFqbn } from "../src/appLockerEnforcer";

const base: AllowlistWire = {
  enforce: false,
  allowProgramFiles: true,
  exemptAdministrators: true,
  microsoftSigned: "SELECTED",
  microsoftProducts: ["Microsoft Edge"],
  rules: [],
};
const joined = (a: AllowlistWire) => allowlistExeRules(a).join("");

test("the baseline always allows Windows (minus user-writable folders) and the agent", () => {
  const xml = joined({ ...base, allowProgramFiles: false, exemptAdministrators: false, microsoftSigned: "OFF" });
  assert.ok(xml.includes('Path="%WINDIR%\\*"'));
  assert.ok(xml.includes('<FilePathCondition Path="%WINDIR%\\Temp\\*" />'));
  // Only the locked install folder, not all of ProgramData\EndpointPro (users could make folders there).
  assert.ok(xml.includes('EndpointPro\\Agent\\*"'));
  assert.ok(!xml.includes('EndpointPro\\*"'));
  // Windows' own signed components anywhere, Edge, WebView2 and .NET.
  assert.ok(xml.includes('ProductName="MICROSOFT\u00ae WINDOWS\u00ae OPERATING SYSTEM"'));
  assert.ok(xml.includes('ProductName="MICROSOFT EDGE WEBVIEW2"'));
  assert.ok(xml.includes('Path="%PROGRAMFILES%\\dotnet\\*"'));
  // Drivers' tools from hardware makers.
  assert.ok(xml.includes('Path="%PROGRAMFILES%\\Realtek\\*"'));
  assert.ok(xml.includes('Path="%PROGRAMFILES%\\NVIDIA Corporation\\*"'));
  assert.ok(!xml.includes('Path="%PROGRAMFILES%\\*"'), "not every Program Files application");
  assert.ok(!xml.includes("S-1-5-32-544"));
  assert.ok(!xml.includes('ProductName="Microsoft Edge"'), "no selected Microsoft products");
});

test("baseline options: Program Files, administrators, Microsoft products or all Microsoft", () => {
  const xml = joined(base);
  assert.ok(xml.includes('Path="%PROGRAMFILES%\\*"'));
  assert.ok(xml.includes('UserOrGroupSid="S-1-5-32-544" Action="Allow"><Conditions><FilePathCondition Path="*" />'));
  assert.ok(xml.includes('PublisherName="O=MICROSOFT CORPORATION, L=REDMOND, S=WASHINGTON, C=US" ProductName="Microsoft Edge" BinaryName="*"'));
  const all = joined({ ...base, microsoftSigned: "ALL" });
  assert.ok(all.includes('PublisherName="O=MICROSOFT CORPORATION, L=REDMOND, S=WASHINGTON, C=US" ProductName="*" BinaryName="*"'));
  // Same product, same rule id on every sync.
  assert.equal(joined(base), joined(base));
});

test("publisher, hash and path allow rules", () => {
  const xml = joined({
    ...base,
    rules: [
      {
        ruleId: "a1",
        ruleType: "ALLOW_PUBLISHER",
        value: "O=GOOGLE LLC, L=MOUNTAIN VIEW, S=CALIFORNIA, C=US",
        productName: "Google Chrome",
        fileName: "chrome.exe",
        versionMatch: "MIN",
        version: "131",
        fileSize: null,
      },
      { ruleId: "a2", ruleType: "ALLOW_HASH", value: "0x" + "ab".repeat(32), fileName: "tool.exe", fileSize: 1234 },
      { ruleId: "a3", ruleType: "ALLOW_PATH", value: "D:\\ERP" },
      { ruleId: "a4", ruleType: "ALLOW_PUBLISHER", value: "GOOGLE LLC" }, // not a signer name: skipped
    ],
  });
  assert.ok(xml.includes('ProductName="Google Chrome" BinaryName="CHROME.EXE"><BinaryVersionRange LowSection="131.0.0.0" HighSection="*" />'));
  assert.ok(xml.includes(`<FileHash Type="SHA256" Data="0x${"AB".repeat(32)}" SourceFileName="tool.exe" SourceFileLength="1234" />`));
  assert.ok(xml.includes('Id="a3"') && xml.includes('Path="D:\\ERP\\*"'));
  assert.ok(!xml.includes('Id="a4"'));
});

test("Windows' packaged apps and Internet Explorer keep working for every user", () => {
  // Calculator, Photos, the new Notepad, Store... - Microsoft's and Windows' packaged apps, and the
  // hardware makers'; not every signed one (other Store apps stay blocked).
  const appx = allowlistAppxRules().join("");
  assert.ok(appx.includes('UserOrGroupSid="S-1-1-0"') && appx.includes('Action="Allow"'));
  assert.ok(appx.includes('PublisherName="CN=MICROSOFT WINDOWS, O=MICROSOFT CORPORATION, L=REDMOND, S=WASHINGTON, C=US"'));
  assert.ok(appx.includes('PublisherName="CN=MICROSOFT CORPORATION, O=MICROSOFT CORPORATION, L=REDMOND, S=WASHINGTON, C=US"'));
  assert.ok(!appx.includes('PublisherName="*"'));
  const d = desiredAppLocker([], [], { ...base, enforce: true });
  assert.deepEqual(d.exe?.appxRules, allowlistAppxRules());
  assert.ok(buildApplyScript(d, []).includes("Add-Allowlist 'Appx' 'Enabled'"));
  // Internet Explorer's launcher is signed as its own product, not as Windows.
  assert.ok(joined({ ...base, microsoftSigned: "OFF" }).includes('ProductName="INTERNET EXPLORER"'));
  // Computer makers' utilities under Program Files, but not Program Files as a whole.
  const strict = joined({ ...base, allowProgramFiles: false, exemptAdministrators: false, microsoftSigned: "OFF" });
  assert.ok(strict.includes('Path="%PROGRAMFILES%\\Dell\\*"') && strict.includes('Path="%PROGRAMFILES%\\Lenovo\\*"') && strict.includes('Path="%PROGRAMFILES%\\HP\\*"'));
  assert.ok(!strict.includes('Path="%PROGRAMFILES%\\*"'));
});

test("installers: only Windows' installer cache, and administrators when allowed", () => {
  const xml = allowlistMsiRules({ ...base, exemptAdministrators: false }).join("");
  assert.ok(xml.includes('Path="%WINDIR%\\Installer\\*"'));
  assert.ok(!xml.includes("S-1-5-32-544"));
  assert.ok(allowlistMsiRules(base).join("").includes('UserOrGroupSid="S-1-5-32-544"'));
});

test("audit or enforce, and no allowlist without one", () => {
  assert.equal(desiredAppLocker([], [], base).exe?.mode, "AuditOnly");
  assert.equal(desiredAppLocker([], [], { ...base, enforce: true }).exe?.mode, "Enabled");
  assert.equal(desiredAppLocker([], []).exe, null);
});

test("Windows' signer field (Fqbn)", () => {
  assert.deepEqual(parseFqbn("O=OPENJS FOUNDATION, L=SAN FRANCISCO, S=CALIFORNIA, C=US\\NODE.JS\\NODE.EXE\\24.15.0.0"), {
    publisher: "O=OPENJS FOUNDATION, L=SAN FRANCISCO, S=CALIFORNIA, C=US",
    productName: "NODE.JS",
    fileVersion: "24.15.0.0",
  });
  assert.equal(parseFqbn("-"), null);
  assert.equal(parseFqbn(""), null);
});
