// Guard rails against blocking policies that take Windows down. Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import { appControlRuleProblem, BUILT_IN_DATA_TYPES, commandBlockRuleProblem, remediationRisk, targetsForDataType, threatExclusionProblem } from "@em/shared";

test("Threat Protection exclusions refuse whole drives, malware landing folders and script types", () => {
  for (const v of ["C:\\", "C:\\*", "*", "%TEMP%", "C:\\Windows", "C:\\Windows\\Temp", "C:\\Users", "C:\\Users\\alice\\Downloads", "C:\\Users\\alice\\AppData\\Local\\Temp", "C:\\ProgramData", "%USERPROFILE%"]) {
    assert.ok(threatExclusionProblem("path", v), `path ${v} should be refused`);
  }
  for (const v of ["D:\\SQLData", "C:\\Program Files\\Vendor\\Cache", "D:\\build\\temp", "\\\\fileserver\\backups"]) {
    assert.equal(threatExclusionProblem("path", v), null, `path ${v} should be allowed`);
  }
  for (const v of [".exe", "dll", ".ps1", ".zip", ".log, .tmp", "*"]) assert.ok(threatExclusionProblem("extension", v), `extension ${v} should be refused`);
  for (const v of [".ldf", "mdf", ".log"]) assert.equal(threatExclusionProblem("extension", v), null, `extension ${v} should be allowed`);
  for (const v of ["powershell.exe", "C:\\Windows\\System32\\cmd.exe", "rundll32.exe", "notepad"]) assert.ok(threatExclusionProblem("process", v), `process ${v} should be refused`);
  for (const v of ["sqlservr.exe", "D:\\Apps\\backup.exe"]) assert.equal(threatExclusionProblem("process", v), null, `process ${v} should be allowed`);
});

test("application control refuses rules that would stop Windows", () => {
  for (const ext of [".exe", "exe", ".COM", ".scr", ".dll", ".lnk", "*", ".*"]) {
    assert.ok(appControlRuleProblem("EXTENSION", ext), `extension ${ext} should be refused`);
  }
  for (const v of ["explorer.exe", "C:\\Windows\\explorer.exe", "userinit.exe", "C:\\Windows\\System32\\cmd.exe", "%WINDIR%\\notepad.exe", "C:\\", "C:\\*", "*", "*.exe", "*\\*", "sihost.exe", "node.exe", "C:\\ProgramData\\EndpointPro\\Agent\\node\\node.exe"]) {
    assert.ok(appControlRuleProblem("EXECUTABLE", v), `executable ${v} should be refused`);
  }
  for (const [type, v] of [["EXTENSION", ".ps1, .bat, .cmd"], ["EXTENSION", ".ps1;.bat"], ["EXTENSION", ". ps1"], ["EXECUTABLE", "a.exe, b.exe"], ["DLL", "a.dll,b.dll"]]) {
    assert.ok(appControlRuleProblem(type, v), `${type} "${v}" (a list in one rule) should be refused`);
  }
  for (const [type, v] of [["EXTENSION", ".vbs"], ["EXTENSION", ".hta"], ["EXTENSION", ".jar"], ["EXECUTABLE", "AnyDesk.exe"], ["EXECUTABLE", "C:\\Program Files\\uTorrent\\uTorrent.exe"], ["EXECUTABLE", "UltraViewer_Desktop.exe"]]) {
    assert.equal(appControlRuleProblem(type, v), null, `${type} ${v} should be allowed`);
  }
});

test("application control product and publisher rules refuse Microsoft, Windows and the agent", () => {
  for (const [type, v] of [["PUBLISHER", "Microsoft Corporation"], ["PUBLISHER", "microsoft"], ["PRODUCT", "Microsoft® Windows® Operating System"], ["PRODUCT", "*Windows*"], ["PRODUCT", "Endpoint IQ"], ["PUBLISHER", "*"], ["PRODUCT", "ab"]]) {
    assert.ok(appControlRuleProblem(type, v), `${type} ${v} should be refused`);
  }
  for (const [type, v] of [["PUBLISHER", "AnyDesk Software GmbH"], ["PUBLISHER", "Telegram FZ-LLC"], ["PRODUCT", "Telegram Desktop"], ["PRODUCT", "AnyDesk"], ["PRODUCT", "uTorrent*"]]) {
    assert.equal(appControlRuleProblem(type, v), null, `${type} ${v} should be allowed`);
  }
});

test("advanced application control: DLL rules name a real DLL outside Windows, Allow rules name a folder", () => {
  for (const v of ["*.dll", "*", "evil.exe", "C:\\Windows\\System32\\evil.dll", "%WINDIR%\\x.dll", "%SYSTEM32%\\x.dll", "C:\\ProgramData\\EndpointPro\\Agent\\x.dll", "?.dll"]) {
    assert.ok(appControlRuleProblem("DLL", v), `DLL ${v} should be refused`);
  }
  for (const v of ["evil.dll", "C:\\Users\\*\\AppData\\*\\hook.dll", "C:\\Program Files\\Foo\\bar.ocx"]) {
    assert.equal(appControlRuleProblem("DLL", v), null, `DLL ${v} should be allowed`);
  }
  for (const v of ["*", "C:\\", "C:\\*", "%OSDRIVE%\\*", "\\"]) {
    assert.ok(appControlRuleProblem("ALLOW_PATH", v), `allow ${v} should be refused`);
  }
  for (const v of ["C:\\IT\\Scripts", "\\\\fileserver\\tools\\*", "C:\\Tools\\app.exe"]) {
    assert.equal(appControlRuleProblem("ALLOW_PATH", v), null, `allow ${v} should be allowed`);
  }
});

test("command blocking refuses patterns that match Windows, but allows real threats", () => {
  for (const p of [".*", "", "exe", "\\\\", "windows", "svchost", "explorer"]) {
    assert.ok(commandBlockRuleProblem("COMMAND_PATTERN", p), `pattern "${p}" should be refused`);
  }
  assert.ok(commandBlockRuleProblem("COMMAND_PATTERN", "(unclosed"), "invalid regex refused");
  for (const p of ["powershell.*-enc", "mimikatz", "vssadmin.*delete shadows", "certutil.*-urlcache", "AnyDesk"]) {
    assert.equal(commandBlockRuleProblem("COMMAND_PATTERN", p), null, `pattern "${p}" should be allowed`);
  }
  assert.ok(commandBlockRuleProblem("PROCESS_NAME", "explorer.exe"));
  assert.ok(commandBlockRuleProblem("PROCESS_NAME", "svchost.exe"));
  assert.equal(commandBlockRuleProblem("PROCESS_NAME", "powershell.exe"), null); // script hosts stay blockable
  assert.equal(commandBlockRuleProblem("PROCESS_NAME", "AnyDesk.exe"), null);
});

test("the Executables data type can't be pushed into application control", () => {
  const exe = BUILT_IN_DATA_TYPES.find((d) => d.id === "builtin:executables-scripts")!;
  assert.deepEqual(targetsForDataType(exe), ["dlp"]);
});

test("boot / sign-in changing fixes are flagged", () => {
  assert.ok(remediationRisk("Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity' -Name Enabled -Value 1"));
  assert.ok(remediationRisk("Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -Name RunAsPPL -Value 1"));
  assert.equal(remediationRisk("Set-ItemProperty -Path 'HKLM:\\...\\Policies\\System' -Name EnableLUA -Value 1"), null);
  assert.equal(remediationRisk(null), null);
});
