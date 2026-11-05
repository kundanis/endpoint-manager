// Command blocking catalogue: harmful actions described in plain words. An admin ticks the
// protections a policy should enforce; there are no custom commands. Each protection lists the
// command lines that carry it out on each operating system, and an endpoint receives only the
// patterns for its own OS (win32 / linux / darwin). Every protection is always enforced (Block).
//
// Patterns are case-insensitive regular expressions matched against a process's full command
// line - by .NET on Windows and by Node.js on Linux and macOS, so they use syntax both share.
// Every Windows pattern must also pass commandBlockRuleProblem (it may never match a core Windows
// process); the server test suite checks that, plus sample commands each protection must and must
// not catch.

export type CommandProtectionOs = "win32" | "linux" | "darwin";

export interface CommandProtection {
  key: string;
  title: string;
  description: string;
  patterns: Partial<Record<CommandProtectionOs, string[]>>;
}

// A program name at the start of a command line or after a path / quote: "vssadmin",
// "C:\Windows\System32\vssadmin.exe", "\"vssadmin.exe\"".
const win = (exe: string) => `(^|[\\\\/\\s"'])${exe}(\\.exe)?["']?\\s`;
// A Unix program name at the start or after a path: "useradd", "/usr/sbin/useradd".
const nix = (cmd: string) => `(^|[/\\s])${cmd}\\s`;

export const COMMAND_PROTECTIONS: readonly CommandProtection[] = [
  {
    key: "BACKUP_DELETION",
    title: "Stop deletion of backups and restore points",
    description: "Ransomware deletes backup copies first so files can't be recovered. Stops shadow copies, Windows backups and Time Machine snapshots being deleted.",
    patterns: {
      win32: [
        `${win("vssadmin")}.*\\b(delete\\s+shadows|resize\\s+shadowstorage)\\b`,
        `${win("wmic")}.*\\bshadowcopy\\b.*\\bdelete\\b`,
        `${win("wbadmin")}.*\\bdelete\\s+(catalog|systemstatebackup|backup)\\b`,
        `win32_shadowcopy.*\\b(delete|remove-ciminstance|remove-wmiobject)\\b`,
        `\\b(remove-ciminstance|remove-wmiobject)\\b.*win32_shadowcopy`,
      ],
      darwin: [`${nix("tmutil")}(delete|disable|deletelocalsnapshots|thinlocalsnapshots)\\b`],
    },
  },
  {
    key: "RECOVERY_DISABLE",
    title: "Stop recovery and safe-boot from being switched off",
    description: "Stops Windows' automatic repair and recovery environment being disabled, so a damaged PC can still be repaired.",
    patterns: {
      win32: [
        `${win("bcdedit")}.*\\b(recoveryenabled\\s+(no|off|0)|bootstatuspolicy\\s+ignoreallfailures)\\b`,
        `${win("reagentc")}.*[/-]disable\\b`,
      ],
    },
  },
  {
    key: "SECURITY_TOOLS_OFF",
    title: "Stop antivirus or firewall being turned off",
    description: "Stops Microsoft Defender, the firewall and other protection being switched off or bypassed from the command line.",
    patterns: {
      win32: [
        `set-mppreference.*-disable\\w*\\s+(\\$true|1)\\b`,
        `add-mppreference.*-exclusion(path|process|extension)\\b`,
        `${win("netsh")}.*\\badvfirewall\\s+set\\s+\\w+\\s+state\\s+off\\b`,
        `${win("netsh")}.*\\bfirewall\\s+set\\s+opmode\\s+(mode=)?disable\\b`,
        `set-netfirewallprofile.*-enabled\\s+(false|\\$false|0)\\b`,
        `${win("sc")}(stop|config|delete)\\s+(windefend|mpssvc|wscsvc|sense|wdnissvc)\\b`,
        `${win("net1?")}stop\\s+(windefend|mpssvc|wscsvc|sense)\\b`,
      ],
      linux: [
        `${nix("ufw")}disable\\b`,
        `${nix("systemctl")}(stop|disable|mask)\\b.*\\b(firewalld|ufw|apparmor|auditd|clamav-daemon|falcon-sensor)(\\.service)?\\b`,
        `${nix("service")}(firewalld|ufw|auditd|apparmor)\\s+stop\\b`,
        `${nix("iptables")}(-F|--flush)\\b`,
        `${nix("setenforce")}0\\b`,
      ],
      darwin: [
        `${nix("spctl")}--(master|global)-disable\\b`,
        `socketfilterfw\\s+--setglobalstate\\s+off\\b`,
        `${nix("pfctl")}-d\\b`,
      ],
    },
  },
  {
    key: "LOG_WIPING",
    title: "Stop security logs being wiped",
    description: "Attackers clear the logs to hide what they did. Stops the system and security logs being cleared or deleted.",
    patterns: {
      win32: [`${win("wevtutil")}(cl|clear-log)\\b`, `\\b(clear-eventlog|remove-eventlog)\\b`, `eventlogsession.*clearlog`],
      linux: [
        `${nix("rm")}(-\\S+\\s+)*/var/log(/|\\s|$)`,
        `${nix("(shred|truncate)")}.*/var/log/`,
        `${nix("journalctl")}.*--vacuum-time=\\d+s\\b`,
      ],
      darwin: [`${nix("log")}erase\\b`, `${nix("rm")}(-\\S+\\s+)*/(private/)?var/log(/|\\s|$)`],
    },
  },
  {
    key: "TOOL_DOWNLOADS",
    title: "Stop system tools downloading programs from the internet",
    description: "Malware uses built-in tools to download and run more malware. Stops downloads through tools such as certutil, BITS and PowerShell, and scripts piped straight from the internet into a shell.",
    patterns: {
      win32: [
        `${win("certutil")}.*-urlcache\\b`,
        `${win("bitsadmin")}.*/(transfer|addfile)\\b`,
        `\\b(iex|invoke-expression)\\b.*\\b(downloadstring|invoke-webrequest|iwr|irm|invoke-restmethod|net\\.webclient)\\b`,
        `\\b(downloadstring|downloaddata|downloadfile)\\s*\\(\\s*["']?https?://`,
        `${win("mshta")}["']?(https?|javascript|vbscript):`,
        `${win("regsvr32")}.*/i:\\s*["']?https?://`,
      ],
      linux: [`\\b(curl|wget)\\b[^|]*\\|\\s*(sudo\\s+)?(ba|z|da|k)?sh\\b`],
      darwin: [`\\b(curl|wget)\\b[^|]*\\|\\s*(sudo\\s+)?(ba|z|da|k)?sh\\b`],
    },
  },
  {
    key: "ENCODED_POWERSHELL",
    title: "Stop scrambled (encoded) PowerShell commands",
    description: "Malware hides what it does by scrambling PowerShell commands. Stops PowerShell running encoded commands.",
    patterns: {
      win32: [`${win("(powershell|pwsh)")}(.*\\s)?-e[a-z]*\\s+["']?[a-z0-9+/=]{16,}["']?(\\s|$)`],
    },
  },
  {
    key: "ACCOUNT_CREATION",
    title: "Stop new user accounts or administrators being created",
    description: "Stops new user accounts being created, and existing ones being made administrators, from the command line.",
    patterns: {
      win32: [
        `${win("net1?")}user\\s+.*[/-]add\\b`,
        `${win("net1?")}localgroup\\s+.*[/-]add\\b`,
        `\\bnew-localuser\\b`,
        `\\badd-localgroupmember\\b`,
      ],
      linux: [
        // Package installs create system accounts (--system / -r); those stay allowed.
        `${nix("(useradd|adduser)")}(?!(.*\\s)?(--system|-r)\\b)`,
        `${nix("usermod")}.*-a?G\\s+\\S*\\b(sudo|wheel|admin)\\b`,
        `${nix("gpasswd")}-a\\s+\\S+\\s+(sudo|wheel|admin)\\b`,
      ],
      darwin: [
        `${nix("dscl")}\\S+\\s+-(create|append)\\s+/(users|groups/admin)\\b`,
        `${nix("sysadminctl")}.*-adduser\\b`,
        `${nix("dseditgroup")}.*-o\\s+edit\\b.*\\badmin\\b`,
      ],
    },
  },
  {
    key: "DISK_WIPING",
    title: "Stop disks being wiped or formatted",
    description: "Stops drives being formatted, erased or overwritten.",
    patterns: {
      win32: [
        `${win("format")}["']?[a-z]:`,
        `(^|[\\\\/\\s"'])format\\.com["']?\\s+[a-z]:`,
        `(^|[\\\\/\\s"'])diskpart(\\.exe)?["']?(\\s|$)`,
        `${win("cipher")}.*/w:`,
        `\\b(clear-disk|format-volume|remove-partition|initialize-disk)\\b`,
      ],
      linux: [
        `(^|[/\\s])mkfs(\\.\\w+)?\\s`,
        `${nix("dd")}.*\\bof=/dev/(sd|nvme|hd|vd|xvd|mmcblk)`,
        `${nix("(wipefs|blkdiscard)")}`,
        `${nix("shred")}.*/dev/`,
      ],
      darwin: [
        `${nix("diskutil")}(erase\\w*|zerodisk|randomdisk|secureerase|partitiondisk|reformat)\\b`,
        `${nix("dd")}.*\\bof=/dev/r?disk\\d`,
      ],
    },
  },
  {
    key: "SYSTEM_DELETION",
    title: "Stop deletion of the whole system drive or Windows folder",
    description: "Stops commands that delete an entire drive or the operating system's own folders.",
    patterns: {
      win32: [
        `\\b(rd|rmdir)\\s+(/[sq]\\s+)+["']?[a-z]:\\\\(windows\\\\?)?["']?(\\s|$)`,
        `\\bdel\\s+(/[fsqa]\\S*\\s+)+["']?[a-z]:\\\\(windows\\\\)?\\*?(\\.\\*)?["']?(\\s|$)`,
        `\\bremove-item\\s+(-path\\s+)?["']?[a-z]:\\\\(windows\\\\?)?["']?\\s.*-recurse\\b`,
      ],
      linux: [
        `${nix("rm")}(-\\S+\\s+)*-[a-z]*r[a-z]*\\s+(-\\S+\\s+)*/(bin|boot|etc|lib|lib64|sbin|usr|var|home|root)?/?\\*?(\\s|$)`,
        `${nix("rm")}.*--no-preserve-root\\b`,
      ],
      darwin: [`${nix("rm")}(-\\S+\\s+)*-[a-z]*r[a-z]*\\s+(-\\S+\\s+)*/(system|users|applications|library|bin|sbin|usr|etc|private)?/?\\*?(\\s|$)`],
    },
  },
  {
    key: "HIDDEN_AUTOSTART",
    title: "Stop programs being set to start automatically and hidden",
    description: "Malware makes itself start every time the PC starts or a user signs in. Stops Run-key entries and startup tasks being added from the command line.",
    patterns: {
      win32: [
        `${win("reg")}add\\s+["']?hk(lm|cu|ey_local_machine|ey_current_user)\\\\software\\\\(wow6432node\\\\)?microsoft\\\\windows\\\\currentversion\\\\run(once)?\\b`,
        `${win("schtasks")}.*/create\\b.*/sc\\s+(onlogon|onstart)\\b`,
        `\\b(new|set)-itemproperty\\b.*\\\\currentversion\\\\run(once)?\\b`,
      ],
    },
  },
  {
    key: "REVERSE_SHELLS",
    title: "Stop remote-control back doors (reverse shells)",
    description: "Stops a command prompt or shell being handed to someone on the internet, a common way attackers take control.",
    patterns: {
      win32: [`${win("(nc|ncat|netcat|nc64)")}(.*\\s)?-(e|c)\\s`, `system\\.net\\.sockets\\.tcpclient\\b.*\\b(getstream|invoke-expression|iex)\\b`],
      linux: [
        `${nix("(nc|ncat|netcat)")}(.*\\s)?-(e|c)\\s`,
        `/dev/tcp/`,
        `${nix("socat")}.*\\bexec:`,
        `\\b(python[23]?|perl|ruby|php)\\b.*\\bsocket\\b.*(/bin/(ba|z)?sh|pty\\.spawn|subprocess)`,
      ],
      darwin: [
        `${nix("(nc|ncat|netcat)")}(.*\\s)?-(e|c)\\s`,
        `/dev/tcp/`,
        `\\b(python[23]?|perl|ruby|php)\\b.*\\bsocket\\b.*(/bin/(ba|z)?sh|pty\\.spawn|subprocess)`,
      ],
    },
  },
  {
    key: "PASSWORD_THEFT",
    title: "Stop saved passwords being copied out of the system",
    description: "Stops well-known password-stealing tools and commands that copy the system's password stores.",
    patterns: {
      win32: [
        `\\bmimikatz\\b`,
        `\\bsekurlsa::`,
        `${win("reg")}save\\s+["']?hk(lm|ey_local_machine)\\\\(sam|security|system)\\b`,
        `\\bcomsvcs(\\.dll)?["']?\\s*,\\s*#?(minidump|24)\\b`,
        `\\bprocdump(64)?(\\.exe)?["']?\\s+.*\\blsass\\b`,
        `${win("vaultcmd")}.*/list`,
        `${win("ntdsutil")}.*\\bifm\\b`,
      ],
      linux: [`^(?!.*\\b(passwd|chpasswd|chage|usermod|useradd|vipw|pwck|grpck|unix_chkpwd)\\b).*/etc/g?shadow\\b`, `\\bunshadow\\b`],
      darwin: [`${nix("security")}(dump-keychain\\b|find-(generic|internet)-password\\b.*\\s-[wg]\\b)`],
    },
  },
  {
    key: "SECURITY_WEAKENING",
    title: "Stop security controls being weakened",
    description: "Stops security prompts (UAC) being switched off, driver signing being disabled, and system files or shells being opened up to everyone.",
    patterns: {
      win32: [
        `${win("reg")}add\\s+.*\\\\policies\\\\system["']?\\s+.*/v\\s+enablelua\\s+.*/d\\s+0\\b`,
        `\\bset-itemproperty\\b.*\\\\policies\\\\system\\b.*\\benablelua\\b.*\\s0\\b`,
        `${win("bcdedit")}.*\\b(testsigning|nointegritychecks)\\s+(on|yes)\\b`,
        `${win("icacls")}["']?[a-z]:\\\\(windows\\\\?)?["']?\\s+.*/grant\\s+["']?(everyone|\\*s-1-1-0)\\b`,
      ],
      linux: [
        `${nix("chmod")}(-\\S+\\s+)*(0?777|a\\+rwx|o\\+w)\\s+/(etc|bin|sbin|usr|boot|var)?/?(\\s|$)`,
        `${nix("chmod")}.*\\b(u\\+s|[4-7][0-7]{3})\\s+/(usr/)?s?bin/(ba|z|da)?sh\\b`,
        `nopasswd.*/etc/sudoers|/etc/sudoers.*nopasswd`,
      ],
      darwin: [
        `${nix("csrutil")}disable\\b`,
        `${nix("chmod")}.*\\b(u\\+s|[4-7][0-7]{3})\\s+/(usr/)?s?bin/(ba|z|da)?sh\\b`,
        `nopasswd.*/etc/sudoers|/etc/sudoers.*nopasswd`,
      ],
    },
  },
  {
    key: "UPDATES_OFF",
    title: "Stop system updates being switched off",
    description: "Stops automatic security updates being stopped or disabled.",
    patterns: {
      win32: [
        `${win("sc")}(config\\s+wuauserv\\s+start=\\s*disabled|stop\\s+wuauserv)\\b`,
        `${win("net1?")}stop\\s+wuauserv\\b`,
        `\\bset-service\\b.*\\bwuauserv\\b.*-startuptype\\s+disabled\\b`,
        `\\bstop-service\\b.*\\bwuauserv\\b`,
        `${win("reg")}add\\s+.*\\\\windowsupdate\\\\au["']?\\s+.*/v\\s+noautoupdate\\s+.*/d\\s+1\\b`,
      ],
      linux: [`${nix("systemctl")}(stop|disable|mask)\\b.*\\b(unattended-upgrades|apt-daily(-upgrade)?\\.timer|dnf-automatic(\\.timer)?|packagekit)\\b`],
      darwin: [
        `${nix("softwareupdate")}--schedule\\s+off\\b`,
        `${nix("defaults")}write\\s+.*com\\.apple\\.softwareupdate\\s+automaticcheckenabled\\s+-bool\\s+(false|no|0)\\b`,
      ],
    },
  },
];

export const COMMAND_PROTECTION_KEYS = COMMAND_PROTECTIONS.map((p) => p.key);

export function commandProtection(key: string): CommandProtection | undefined {
  return COMMAND_PROTECTIONS.find((p) => p.key === key);
}

// The operating systems a protection covers, for the console's checklist.
export function commandProtectionOses(p: CommandProtection): CommandProtectionOs[] {
  return (["win32", "linux", "darwin"] as const).filter((os) => (p.patterns[os]?.length ?? 0) > 0);
}
