import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { encryptField } from "../src/utils/fieldEncryption";

const prisma = new PrismaClient();

interface SeedRule {
  ruleKey: string;
  title: string;
  description: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  checkPowerShell: string;
  operator: "EQUALS" | "NOT_EQUALS" | "GTE" | "LTE" | "CONTAINS" | "REGEX_MATCH";
  expectedValue: string;
  remediationPowerShell?: string;
}

// Each account-policy rule re-exports secedit independently rather than sharing state —
// rules are self-contained scripts (agent runs each one separately), and the export
// itself is sub-second, so the duplication costs nothing in practice.
const SECEDIT_EXPORT = "secedit /export /cfg $env:TEMP\\secpol.cfg | Out-Null; ";
function seceditValue(key: string): string {
  return `${SECEDIT_EXPORT}(Select-String -Path $env:TEMP\\secpol.cfg -Pattern '^${key}\\s*=').Line.Split('=')[1].Trim()`;
}

function auditSetting(subcategory: string): string {
  return `(auditpol /get /subcategory:"${subcategory}" /r | ConvertFrom-Csv).'Inclusion Setting'`;
}
function auditRemediate(subcategory: string): string {
  return `auditpol /set /subcategory:"${subcategory}" /success:enable /failure:enable`;
}

// An original rule set inspired by publicly documented CIS Level 1 Windows hardening
// categories (password/lockout policy, audit policy, firewall, guest/admin account
// posture, SMBv1, RDP NLA, UAC, AutoRun, etc.) — NOT the copyrighted CIS benchmark
// text/thresholds themselves. Every checkPowerShell prints a single value to stdout;
// grading against expectedValue happens server-side (see securityConfigEvaluate.util.ts).
const BASELINE_RULES: SeedRule[] = [
  {
    ruleKey: "pw-history",
    title: "Enforce password history (>= 24 remembered)",
    description: "Number of unique new passwords before an old one can be reused.",
    severity: "MEDIUM",
    checkPowerShell: seceditValue("PasswordHistorySize"),
    operator: "GTE",
    expectedValue: "24",
    remediationPowerShell: "net accounts /uniquepw:24",
  },
  {
    ruleKey: "pw-max-age",
    title: "Maximum password age <= 365 days",
    description: "Passwords that never expire (0) or expire too infrequently weaken credential hygiene.",
    severity: "MEDIUM",
    checkPowerShell: seceditValue("MaximumPasswordAge"),
    operator: "LTE",
    expectedValue: "365",
    remediationPowerShell: "net accounts /maxpwage:365",
  },
  {
    ruleKey: "pw-min-age",
    title: "Minimum password age >= 1 day",
    description: "Prevents rapid password-history cycling to reuse a favorite password.",
    severity: "LOW",
    checkPowerShell: seceditValue("MinimumPasswordAge"),
    operator: "GTE",
    expectedValue: "1",
    remediationPowerShell: "net accounts /minpwage:1",
  },
  {
    ruleKey: "pw-min-length",
    title: "Minimum password length >= 14",
    description: "Short passwords are the single biggest factor in offline brute-force success.",
    severity: "HIGH",
    checkPowerShell: seceditValue("MinimumPasswordLength"),
    operator: "GTE",
    expectedValue: "14",
    remediationPowerShell: "net accounts /minpwlen:14",
  },
  {
    ruleKey: "pw-complexity",
    title: "Password complexity requirements enabled",
    description: "Requires a mix of character classes in local account passwords.",
    severity: "MEDIUM",
    checkPowerShell: seceditValue("PasswordComplexity"),
    operator: "EQUALS",
    expectedValue: "1",
  },
  {
    ruleKey: "lockout-enabled",
    title: "Account lockout threshold is enabled (non-zero)",
    description:
      "A threshold of 0 disables lockout entirely, permitting unlimited password guesses. This rule only checks that lockout is enabled, not a specific threshold value.",
    severity: "HIGH",
    checkPowerShell: seceditValue("LockoutBadCount"),
    operator: "NOT_EQUALS",
    expectedValue: "0",
    remediationPowerShell: "net accounts /lockoutthreshold:5",
  },
  {
    ruleKey: "lockout-duration",
    title: "Account lockout duration >= 15 minutes",
    description: "How long an account stays locked after exceeding the bad-password threshold.",
    severity: "MEDIUM",
    checkPowerShell: seceditValue("LockoutDuration"),
    operator: "GTE",
    expectedValue: "15",
    remediationPowerShell: "net accounts /lockoutduration:15",
  },
  {
    ruleKey: "lockout-reset",
    title: "Reset account lockout counter after >= 15 minutes",
    description: "How long before the bad-password counter resets to zero.",
    severity: "LOW",
    checkPowerShell: seceditValue("ResetLockoutCount"),
    operator: "GTE",
    expectedValue: "15",
    remediationPowerShell: "net accounts /lockoutwindow:15",
  },
  {
    ruleKey: "audit-logon",
    title: "Audit Logon events (success and failure)",
    description: "Logs interactive and network logon attempts, needed for incident investigation.",
    severity: "MEDIUM",
    checkPowerShell: auditSetting("Logon"),
    operator: "EQUALS",
    expectedValue: "Success and Failure",
    remediationPowerShell: auditRemediate("Logon"),
  },
  {
    ruleKey: "audit-account-lockout",
    title: "Audit Account Lockout events (success and failure)",
    description: "Logs when an account becomes locked out, a signal of a brute-force attempt.",
    severity: "MEDIUM",
    checkPowerShell: auditSetting("Account Lockout"),
    operator: "EQUALS",
    expectedValue: "Success and Failure",
    remediationPowerShell: auditRemediate("Account Lockout"),
  },
  {
    ruleKey: "audit-security-state-change",
    title: "Audit Security State Change events (success and failure)",
    description: "Logs system startup/shutdown and other security-relevant state changes.",
    severity: "LOW",
    checkPowerShell: auditSetting("Security State Change"),
    operator: "EQUALS",
    expectedValue: "Success and Failure",
    remediationPowerShell: auditRemediate("Security State Change"),
  },
  {
    ruleKey: "firewall-domain",
    title: "Windows Firewall enabled (Domain profile)",
    description: "The Domain network profile's firewall must be enabled.",
    severity: "HIGH",
    checkPowerShell: "(Get-NetFirewallProfile -Profile Domain).Enabled",
    operator: "EQUALS",
    expectedValue: "True",
    remediationPowerShell: "Set-NetFirewallProfile -Profile Domain -Enabled True",
  },
  {
    ruleKey: "firewall-private",
    title: "Windows Firewall enabled (Private profile)",
    description: "The Private network profile's firewall must be enabled.",
    severity: "HIGH",
    checkPowerShell: "(Get-NetFirewallProfile -Profile Private).Enabled",
    operator: "EQUALS",
    expectedValue: "True",
    remediationPowerShell: "Set-NetFirewallProfile -Profile Private -Enabled True",
  },
  {
    ruleKey: "firewall-public",
    title: "Windows Firewall enabled (Public profile)",
    description: "The Public network profile's firewall must be enabled.",
    severity: "HIGH",
    checkPowerShell: "(Get-NetFirewallProfile -Profile Public).Enabled",
    operator: "EQUALS",
    expectedValue: "True",
    remediationPowerShell: "Set-NetFirewallProfile -Profile Public -Enabled True",
  },
  {
    ruleKey: "guest-disabled",
    title: "Guest account is disabled",
    description: "The built-in Guest account should never be enabled.",
    severity: "HIGH",
    checkPowerShell: "(Get-LocalUser -Name 'Guest' -ErrorAction SilentlyContinue).Enabled",
    operator: "EQUALS",
    expectedValue: "False",
    remediationPowerShell: "Disable-LocalUser -Name 'Guest'",
  },
  {
    ruleKey: "smb1-disabled",
    title: "SMBv1 protocol is disabled",
    description: "SMBv1 has no modern integrity/encryption protections and is a common lateral-movement vector.",
    severity: "HIGH",
    checkPowerShell: "(Get-WindowsOptionalFeature -Online -FeatureName SMB1Protocol).State",
    operator: "EQUALS",
    expectedValue: "Disabled",
    remediationPowerShell: "Disable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -NoRestart",
  },
  {
    ruleKey: "rdp-nla",
    title: "RDP requires Network Level Authentication",
    description: "NLA requires authentication before a full RDP session is established.",
    severity: "HIGH",
    checkPowerShell:
      "(Get-ItemProperty 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp' -Name UserAuthentication -ErrorAction SilentlyContinue).UserAuthentication",
    operator: "EQUALS",
    expectedValue: "1",
    remediationPowerShell:
      "Set-ItemProperty -Path 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp' -Name UserAuthentication -Value 1",
  },
  {
    ruleKey: "uac-enabled",
    title: "User Account Control (UAC) is enabled",
    description: "EnableLUA governs whether UAC's privilege-elevation prompts apply at all.",
    severity: "HIGH",
    checkPowerShell:
      "(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name EnableLUA -ErrorAction SilentlyContinue).EnableLUA",
    operator: "EQUALS",
    expectedValue: "1",
    remediationPowerShell:
      "Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name EnableLUA -Value 1",
  },
  {
    ruleKey: "autorun-disabled",
    title: "AutoRun/AutoPlay disabled for all drive types",
    description: "NoDriveTypeAutoRun=255 blocks AutoRun on all drive types, a common USB-borne malware vector.",
    severity: "MEDIUM",
    checkPowerShell:
      "(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer' -Name NoDriveTypeAutoRun -ErrorAction SilentlyContinue).NoDriveTypeAutoRun",
    operator: "EQUALS",
    expectedValue: "255",
    remediationPowerShell:
      "New-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer' -Force | Out-Null; Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer' -Name NoDriveTypeAutoRun -Value 255 -Type DWord",
  },
  {
    ruleKey: "llmnr-disabled",
    title: "LLMNR (link-local name resolution) is disabled",
    description: "LLMNR responses can be spoofed for credential-relay attacks (e.g. Responder).",
    severity: "MEDIUM",
    checkPowerShell:
      "(Get-ItemProperty 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\DNSClient' -Name EnableMulticast -ErrorAction SilentlyContinue).EnableMulticast",
    operator: "EQUALS",
    expectedValue: "0",
    remediationPowerShell:
      "New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\DNSClient' -Force | Out-Null; Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\DNSClient' -Name EnableMulticast -Value 0 -Type DWord",
  },
  {
    ruleKey: "wdigest-disabled",
    title: "WDigest credential caching is disabled",
    description: "UseLogonCredential=1 caches reversible plaintext-equivalent credentials in LSASS memory.",
    severity: "HIGH",
    checkPowerShell:
      "(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\SecurityProviders\\WDigest' -Name UseLogonCredential -ErrorAction SilentlyContinue).UseLogonCredential",
    operator: "EQUALS",
    expectedValue: "0",
    remediationPowerShell:
      "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\SecurityProviders\\WDigest' -Name UseLogonCredential -Value 0 -Type DWord",
  },
  {
    ruleKey: "restrict-anonymous",
    title: "Anonymous SAM/share enumeration is restricted",
    description: "RestrictAnonymous=1 blocks unauthenticated enumeration of local accounts and shares.",
    severity: "MEDIUM",
    checkPowerShell:
      "(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -Name RestrictAnonymous -ErrorAction SilentlyContinue).RestrictAnonymous",
    operator: "EQUALS",
    expectedValue: "1",
    remediationPowerShell:
      "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -Name RestrictAnonymous -Value 1 -Type DWord",
  },
  {
    ruleKey: "ps-scriptblock-logging",
    title: "PowerShell Script Block Logging is enabled",
    description: "Records executed script content, essential for detecting fileless/PowerShell-based attacks.",
    severity: "MEDIUM",
    checkPowerShell:
      "(Get-ItemProperty 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging' -Name EnableScriptBlockLogging -ErrorAction SilentlyContinue).EnableScriptBlockLogging",
    operator: "EQUALS",
    expectedValue: "1",
    remediationPowerShell:
      "New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging' -Force | Out-Null; Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging' -Name EnableScriptBlockLogging -Value 1 -Type DWord",
  },
  {
    ruleKey: "remote-registry-disabled",
    title: "Remote Registry service is disabled",
    description: "An unnecessary remote-management surface unless actively required.",
    severity: "LOW",
    checkPowerShell: "(Get-Service -Name RemoteRegistry -ErrorAction SilentlyContinue).StartType",
    operator: "EQUALS",
    expectedValue: "Disabled",
    remediationPowerShell: "Stop-Service -Name RemoteRegistry -Force; Set-Service -Name RemoteRegistry -StartupType Disabled",
  },
  {
    ruleKey: "defender-realtime",
    title: "Windows Defender real-time protection is enabled",
    description: "Core always-on malware protection.",
    severity: "HIGH",
    checkPowerShell: "(Get-MpComputerStatus).RealTimeProtectionEnabled",
    operator: "EQUALS",
    expectedValue: "True",
    remediationPowerShell: "Set-MpPreference -DisableRealtimeMonitoring $false",
  },
  {
    ruleKey: "smartscreen-enabled",
    title: "Windows SmartScreen is enabled",
    description: "Warns before running unrecognized downloaded applications.",
    severity: "MEDIUM",
    checkPowerShell:
      "(Get-ItemProperty 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System' -Name EnableSmartScreen -ErrorAction SilentlyContinue).EnableSmartScreen",
    operator: "EQUALS",
    expectedValue: "1",
    remediationPowerShell:
      "New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System' -Force | Out-Null; Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System' -Name EnableSmartScreen -Value 1 -Type DWord",
  },
  {
    ruleKey: "lsa-protection",
    title: "LSA Protection (RunAsPPL) is enabled",
    description: "Runs LSASS as a protected process, blocking common credential-dumping tools.",
    severity: "HIGH",
    checkPowerShell: "(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -Name RunAsPPL -ErrorAction SilentlyContinue).RunAsPPL",
    operator: "EQUALS",
    expectedValue: "1",
    remediationPowerShell:
      "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -Name RunAsPPL -Value 1 -Type DWord",
  },
  {
    ruleKey: "security-log-size",
    title: "Security event log maximum size >= ~192 MB",
    description: "An undersized log rotates (and loses evidence) too quickly during an incident.",
    severity: "LOW",
    checkPowerShell: "(Get-WinEvent -ListLog Security).MaximumSizeInBytes",
    operator: "GTE",
    expectedValue: "201326592",
    remediationPowerShell: "wevtutil sl Security /ms:201326592",
  },
  {
    ruleKey: "w32time-running",
    title: "Windows Time service is running",
    description: "Accurate system time is required for Kerberos auth and reliable log correlation.",
    severity: "LOW",
    checkPowerShell: "(Get-Service -Name W32Time -ErrorAction SilentlyContinue).Status",
    operator: "EQUALS",
    expectedValue: "Running",
    remediationPowerShell: "Set-Service -Name W32Time -StartupType Automatic; Start-Service W32Time",
  },
];

// Windows 11-only hardware-security additions — meant to be assigned *alongside*
// the Windows 10 baseline above (which still applies), not instead of it. TPM/Secure
// Boot/VBS/Credential Guard are firmware- or platform-level and correctly ship with
// no remediation script; only Memory Integrity is a plain registry toggle.
const WINDOWS_11_RULES: SeedRule[] = [
  {
    ruleKey: "tpm-present",
    title: "TPM 2.0 is present",
    description: "Required hardware root of trust for Windows 11's security baseline.",
    severity: "HIGH",
    checkPowerShell: "(Get-Tpm).TpmPresent",
    operator: "EQUALS",
    expectedValue: "True",
  },
  {
    ruleKey: "secure-boot-enabled",
    title: "Secure Boot is enabled",
    description: "Blocks unsigned bootloaders/rootkits from loading before Windows starts. Throws (reported as ERROR) on legacy BIOS machines with no UEFI firmware.",
    severity: "HIGH",
    checkPowerShell: "Confirm-SecureBootUEFI",
    operator: "EQUALS",
    expectedValue: "True",
  },
  {
    ruleKey: "vbs-running",
    title: "Virtualization-based Security is running",
    description: "The hypervisor-backed security platform Credential Guard/HVCI/Application Control build on.",
    severity: "MEDIUM",
    checkPowerShell:
      "(Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\\Microsoft\\Windows\\DeviceGuard).VirtualizationBasedSecurityStatus",
    operator: "EQUALS",
    expectedValue: "2",
  },
  {
    ruleKey: "credential-guard-running",
    title: "Credential Guard is running",
    description: "Isolates LSASS secrets in a VBS enclave, blocking common credential-dumping techniques.",
    severity: "HIGH",
    checkPowerShell:
      "(Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\\Microsoft\\Windows\\DeviceGuard).SecurityServicesRunning -join ','",
    operator: "CONTAINS",
    expectedValue: "1",
  },
  {
    ruleKey: "memory-integrity-enabled",
    title: "Memory Integrity (HVCI) is enabled",
    description: "Hypervisor-enforced Code Integrity blocks unsigned/malicious kernel-mode code. Requires a reboot after enabling.",
    severity: "MEDIUM",
    checkPowerShell:
      "(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity' -Name Enabled -ErrorAction SilentlyContinue).Enabled",
    operator: "EQUALS",
    expectedValue: "1",
    remediationPowerShell:
      "New-Item -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity' -Force | Out-Null; Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity' -Name Enabled -Value 1 -Type DWord",
  },
];

// Windows Server-oriented checks. Telnet-Server genuinely only exists as a concept
// on Server (Get-WindowsFeature isn't present at all on client OSes, so this rule
// reports ERROR — cmdlet not found — everywhere except a real Server install, which
// is the correct behavior for a Server-only check). The others run fine on either
// OS but are specifically server-hardening-relevant; absent/default registry values
// read as a plain FAIL rather than ERROR (PowerShell returns $null gracefully for a
// missing property, it doesn't throw).
const WINDOWS_SERVER_RULES: SeedRule[] = [
  {
    ruleKey: "print-spooler-disabled",
    title: "Print Spooler service is disabled",
    description: "Mitigates PrintNightmare-class vulnerabilities on servers that don't need print sharing.",
    severity: "HIGH",
    checkPowerShell: "(Get-Service -Name Spooler -ErrorAction SilentlyContinue).StartType",
    operator: "EQUALS",
    expectedValue: "Disabled",
    remediationPowerShell: "Stop-Service -Name Spooler -Force; Set-Service -Name Spooler -StartupType Disabled",
  },
  {
    ruleKey: "smb-server-signing",
    title: "SMB server signing is required",
    description: "Prevents SMB relay/tampering attacks against file shares hosted by this server.",
    severity: "HIGH",
    checkPowerShell: "(Get-SmbServerConfiguration).RequireSecuritySignature",
    operator: "EQUALS",
    expectedValue: "True",
    remediationPowerShell: "Set-SmbServerConfiguration -RequireSecuritySignature $true -Force",
  },
  {
    ruleKey: "ldap-server-signing",
    title: "LDAP server signing is required",
    description: "Domain-controller-only setting — reads as not-configured on any non-DC server.",
    severity: "MEDIUM",
    checkPowerShell:
      "(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NTDS\\Parameters' -Name LDAPServerIntegrity -ErrorAction SilentlyContinue).LDAPServerIntegrity",
    operator: "EQUALS",
    expectedValue: "2",
  },
  {
    ruleKey: "ntlm-restrict-outgoing",
    title: "Outgoing NTLM traffic is restricted",
    description: "0=allow all, 1=audit, 2=deny all. Reduces exposure to NTLM relay attacks.",
    severity: "MEDIUM",
    checkPowerShell:
      "(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa\\MSV1_0' -Name RestrictSendingNTLMTraffic -ErrorAction SilentlyContinue).RestrictSendingNTLMTraffic",
    operator: "GTE",
    expectedValue: "1",
  },
  {
    ruleKey: "telnet-server-not-installed",
    title: "Telnet Server feature is not installed",
    description: "Telnet transmits credentials in plaintext. Uses Get-WindowsFeature, a Server-only cmdlet — reports ERROR (cmdlet not found) on any non-Server machine, which is expected.",
    severity: "HIGH",
    checkPowerShell: "(Get-WindowsFeature -Name Telnet-Server).InstallState",
    operator: "NOT_EQUALS",
    expectedValue: "Installed",
  },
];

// SQL Server hardening — runs through the existing Windows agent via sqlcmd against
// a local instance (Windows trusted auth, default instance). Named-instance/SQL-auth
// environments should clone this as a CUSTOM benchmark and adjust the -S/-E flags.
// The sys.configurations/SERVERPROPERTY-based checks are portable across instance
// name/version; the ForceEncryption check resolves the instance registry path
// dynamically rather than hardcoding a version-specific instance ID.
function sqlQuery(query: string): string {
  return `sqlcmd -S localhost -E -h -1 -W -Q "SET NOCOUNT ON; ${query}"`;
}

const SQL_SERVER_RULES: SeedRule[] = [
  {
    ruleKey: "sql-xp-cmdshell-disabled",
    title: "xp_cmdshell is disabled",
    description: "xp_cmdshell lets any login with EXECUTE permission run arbitrary OS commands as the SQL service account.",
    severity: "HIGH",
    checkPowerShell: sqlQuery("SELECT CAST(value AS INT) FROM sys.configurations WHERE name = 'xp_cmdshell'"),
    operator: "EQUALS",
    expectedValue: "0",
    remediationPowerShell: sqlQuery(
      "EXEC sp_configure 'show advanced options',1; RECONFIGURE; EXEC sp_configure 'xp_cmdshell',0; RECONFIGURE;",
    ),
  },
  {
    ruleKey: "sql-adhoc-distributed-queries-disabled",
    title: "Ad Hoc Distributed Queries is disabled",
    description: "OPENROWSET/OPENDATASOURCE ad hoc access is a common data-exfiltration and SSRF-style vector.",
    severity: "HIGH",
    checkPowerShell: sqlQuery("SELECT CAST(value AS INT) FROM sys.configurations WHERE name = 'Ad Hoc Distributed Queries'"),
    operator: "EQUALS",
    expectedValue: "0",
    remediationPowerShell: sqlQuery(
      "EXEC sp_configure 'show advanced options',1; RECONFIGURE; EXEC sp_configure 'Ad Hoc Distributed Queries',0; RECONFIGURE;",
    ),
  },
  {
    ruleKey: "sql-cross-db-ownership-chaining-disabled",
    title: "Cross-database ownership chaining is disabled",
    description: "Prevents a user with access to one database from accessing objects in another via shared ownership.",
    severity: "MEDIUM",
    checkPowerShell: sqlQuery("SELECT CAST(value AS INT) FROM sys.configurations WHERE name = 'cross db ownership chaining'"),
    operator: "EQUALS",
    expectedValue: "0",
    remediationPowerShell: sqlQuery("EXEC sp_configure 'cross db ownership chaining',0; RECONFIGURE;"),
  },
  {
    ruleKey: "sql-database-mail-xps-disabled",
    title: "Database Mail XPs is disabled unless needed",
    description: "Database Mail can be used to exfiltrate data or as a phishing relay if not explicitly required.",
    severity: "LOW",
    checkPowerShell: sqlQuery("SELECT CAST(value AS INT) FROM sys.configurations WHERE name = 'Database Mail XPs'"),
    operator: "EQUALS",
    expectedValue: "0",
    remediationPowerShell: sqlQuery(
      "EXEC sp_configure 'show advanced options',1; RECONFIGURE; EXEC sp_configure 'Database Mail XPs',0; RECONFIGURE;",
    ),
  },
  {
    ruleKey: "sql-windows-auth-only",
    title: "Windows-only authentication mode",
    description:
      "Detect-only signal — mixed mode (SQL logins alongside Windows auth) is often a legitimate, deliberate choice for app service accounts, not automatically a misconfiguration.",
    severity: "LOW",
    checkPowerShell: sqlQuery("SELECT CAST(SERVERPROPERTY('IsIntegratedSecurityOnly') AS INT)"),
    operator: "EQUALS",
    expectedValue: "1",
  },
  {
    ruleKey: "sql-sa-disabled",
    title: "The 'sa' login is disabled",
    description: "The well-known 'sa' account is the single most-targeted login in credential-stuffing attacks against SQL Server.",
    severity: "HIGH",
    checkPowerShell: sqlQuery("SELECT CAST(is_disabled AS INT) FROM sys.server_principals WHERE sid = 0x01"),
    operator: "EQUALS",
    expectedValue: "1",
    remediationPowerShell: sqlQuery("ALTER LOGIN sa DISABLE;"),
  },
  {
    ruleKey: "sql-force-encryption",
    title: "Force encryption is enabled",
    description:
      "Encrypts all client-server traffic for this instance, including credentials, without requiring per-app opt-in. Resolves the instance's registry path dynamically (default instance only — named instances need a CUSTOM copy of this rule).",
    severity: "MEDIUM",
    checkPowerShell:
      "$id = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Microsoft SQL Server\\Instance Names\\SQL' -Name MSSQLSERVER -ErrorAction SilentlyContinue).MSSQLSERVER; if ($id) { (Get-ItemProperty \"HKLM:\\SOFTWARE\\Microsoft\\Microsoft SQL Server\\$id\\MSSQLServer\\SuperSocketNetLib\" -Name ForceEncryption -ErrorAction SilentlyContinue).ForceEncryption }",
    operator: "EQUALS",
    expectedValue: "1",
  },
];

type TargetType = "WINDOWS_10" | "WINDOWS_11" | "WINDOWS_SERVER" | "SQL_SERVER";

async function seedBenchmark(name: string, description: string, targetType: TargetType, rules: SeedRule[]) {
  const existing = await prisma.securityBenchmark.findFirst({ where: { name } });
  if (existing) {
    console.log(`SecurityBenchmark "${name}" already exists, skipping seed.`);
    return;
  }

  const benchmark = await prisma.securityBenchmark.create({
    data: { name, description, source: "BUILT_IN", targetType, createdByAdminId: null },
  });

  await prisma.securityBenchmarkRule.createMany({
    data: rules.map((r) => ({
      benchmarkId: benchmark.id,
      ruleKey: r.ruleKey,
      title: r.title,
      description: r.description,
      severity: r.severity,
      checkPowerShell: r.checkPowerShell,
      operator: r.operator,
      expectedValue: r.expectedValue,
      remediationPowerShell: r.remediationPowerShell ?? null,
    })),
  });

  console.log(`Seeded SecurityBenchmark "${name}" with ${rules.length} rules`);
}

interface ZeroTrustSeedCondition {
  conditionKey: string;
  title: string;
  description: string;
  checkPowerShell: string;
  operator: "EQUALS" | "NOT_EQUALS" | "GTE" | "LTE" | "CONTAINS" | "REGEX_MATCH";
  expectedValue: string;
}

// A device-trust policy distilled from a prior posture-based NAC project's actual
// policy.yaml (OS version, firewall, disk encryption, required AV/management agent,
// patch currency, blacklisted processes) — reimplemented as agent-run PowerShell
// checks rather than ported wholesale, since the underlying scan/grade pipeline here
// already covers the same ground. "Pending critical updates" is deliberately NOT a
// live Windows Update Agent search (WUA searches can take minutes on first run,
// blowing the per-condition check timeout) — days-since-last-patch via Get-HotFix is
// a fast, reliable proxy instead. AV/management-agent checks are hardcoded to
// Kaspersky to match what's actually running in this environment; clone this policy
// and adjust the product name for a different AV/EDR vendor.
const ZERO_TRUST_CONDITIONS: ZeroTrustSeedCondition[] = [
  {
    conditionKey: "os-min-build",
    title: "OS build is reasonably current",
    description: "Windows build number >= 19045 (Windows 10 22H2) — a floor both current Windows 10 and 11 installs should clear.",
    checkPowerShell: "(Get-CimInstance Win32_OperatingSystem).BuildNumber",
    operator: "GTE",
    expectedValue: "19045",
  },
  {
    conditionKey: "firewall-all-profiles-enabled",
    title: "All Windows Firewall profiles are enabled",
    description: "Counts firewall profiles (Domain/Private/Public) that are currently disabled — must be zero.",
    checkPowerShell: "@(Get-NetFirewallProfile | Where-Object { $_.Enabled -eq $false }).Count",
    operator: "EQUALS",
    expectedValue: "0",
  },
  {
    conditionKey: "disk-encryption-enabled",
    title: "Disk encryption (BitLocker) is on for C:",
    description: "An unencrypted disk means data at rest is fully exposed if the device is lost or stolen.",
    checkPowerShell: "(Get-BitLockerVolume -MountPoint C: -ErrorAction SilentlyContinue).ProtectionStatus",
    operator: "EQUALS",
    expectedValue: "On",
  },
  {
    conditionKey: "antivirus-registered",
    title: "Required AV/EDR is registered with Windows Security Center",
    description:
      "Org-specific — checks for Kaspersky specifically via the same WMI SecurityCenter2 interface Windows Security itself uses. Clone and rename for a different AV/EDR vendor.",
    checkPowerShell:
      "(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue).displayName -join ','",
    operator: "CONTAINS",
    expectedValue: "Kaspersky",
  },
  {
    conditionKey: "management-agent-installed",
    title: "Required endpoint management agent is installed",
    description:
      "Org-specific — checks the Uninstall registry hive for Kaspersky Security Center Network Agent. Clone and rename for a different management agent.",
    checkPowerShell:
      "(Get-ItemProperty 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*Kaspersky Security Center Network Agent*' } | Select-Object -First 1).DisplayName",
    operator: "CONTAINS",
    expectedValue: "Kaspersky",
  },
  {
    conditionKey: "days-since-last-patch",
    title: "A Windows update was installed within the last 45 days",
    description: "Fast proxy for patch currency via Get-HotFix's most recent InstalledOn date — not a live Windows Update search.",
    checkPowerShell:
      "(New-TimeSpan -Start (Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 1).InstalledOn -End (Get-Date)).Days",
    operator: "LTE",
    expectedValue: "45",
  },
  {
    conditionKey: "blacklisted-process-not-running",
    title: "No blacklisted remote-access tools are running",
    description:
      "Illustrative example (AnyDesk/TeamViewer) — replace with whatever unauthorized-tool list your organization actually wants to flag.",
    checkPowerShell: "@(Get-Process -Name 'AnyDesk', 'TeamViewer' -ErrorAction SilentlyContinue).Count",
    operator: "EQUALS",
    expectedValue: "0",
  },
  // The five conditions below mirror the Windows Security app's own top-level category
  // names exactly (Settings -> Privacy & security -> Windows Security) rather than being
  // vendor-specific like antivirus-registered/management-agent-installed above — each
  // checks a native OS signal (WSC, Defender's own cmdlet, or a built-in hardware/policy
  // check) so they work unmodified regardless of which AV/EDR product is actually
  // installed. All five report a plain "COMPLIANT"/"NONCOMPLIANT" string so they share one
  // operator/expectedValue convention.
  {
    conditionKey: "win-security-virus-threat-protection",
    title: "Virus & threat protection",
    description:
      "Windows Defender (or whichever product WSC has delegated to) reports antivirus enabled, real-time protection on, and signatures no more than 7 days old. Requires the Defender PowerShell module — reports NONCOMPLIANT rather than erroring if that module itself isn't present.",
    checkPowerShell:
      "$s = Get-MpComputerStatus -ErrorAction SilentlyContinue; if ($s -and $s.AntivirusEnabled -and $s.RealTimeProtectionEnabled -and $s.AntivirusSignatureAge -le 7) { 'COMPLIANT' } else { 'NONCOMPLIANT' }",
    operator: "EQUALS",
    expectedValue: "COMPLIANT",
  },
  {
    conditionKey: "win-security-account-protection",
    title: "Account protection",
    description:
      "Best-effort presence check for Windows Hello enrollment (PIN/biometric) via the per-machine NGC container folder Windows itself stores enrolled credentials in — not a live Microsoft Graph/MDM query.",
    checkPowerShell:
      "$ngc = \"$env:ProgramData\\Microsoft\\Ngc\"; if ((Test-Path $ngc) -and (Get-ChildItem $ngc -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) { 'COMPLIANT' } else { 'NONCOMPLIANT' }",
    operator: "EQUALS",
    expectedValue: "COMPLIANT",
  },
  {
    conditionKey: "win-security-firewall-network-protection",
    title: "Firewall & network protection",
    description:
      "All three Windows Firewall profiles (Domain/Private/Public) are enabled. Conceptually the same fact as firewall-all-profiles-enabled above, kept as a separate condition so it can be assigned/overridden under this Windows-Security-style name independently of that org-specific policy's own copy.",
    checkPowerShell:
      "$profiles = Get-NetFirewallProfile -ErrorAction SilentlyContinue; if ($profiles -and (@($profiles | Where-Object { -not $_.Enabled })).Count -eq 0) { 'COMPLIANT' } else { 'NONCOMPLIANT' }",
    operator: "EQUALS",
    expectedValue: "COMPLIANT",
  },
  {
    conditionKey: "win-security-app-browser-control",
    title: "App & browser control",
    description: "SmartScreen for apps and files (Explorer\\SmartScreenEnabled) is turned on, not 'Off'.",
    checkPowerShell:
      "$v = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer' -Name SmartScreenEnabled -ErrorAction SilentlyContinue).SmartScreenEnabled; if ($v -and $v -ne 'Off') { 'COMPLIANT' } else { 'NONCOMPLIANT' }",
    operator: "EQUALS",
    expectedValue: "COMPLIANT",
  },
  {
    conditionKey: "win-security-device-security",
    title: "Device security",
    description:
      "Core hardware-security floor: a present-and-ready TPM plus UEFI Secure Boot enabled. Confirm-SecureBootUEFI throws outright on legacy BIOS machines — caught and treated as 'no', which is the correct read (legacy BIOS can't have Secure Boot at all).",
    checkPowerShell:
      "$tpm = Get-Tpm -ErrorAction SilentlyContinue; $sb = $false; try { $sb = Confirm-SecureBootUEFI } catch {}; if ($tpm -and $tpm.TpmPresent -and $tpm.TpmReady -and $sb) { 'COMPLIANT' } else { 'NONCOMPLIANT' }",
    operator: "EQUALS",
    expectedValue: "COMPLIANT",
  },
];

// Self-healing, not just create-once: if the policy already exists (a re-run, or an
// existing customer deployment from before some of ZERO_TRUST_CONDITIONS existed), this
// tops up only whichever conditionKeys are actually missing rather than skipping entirely —
// same "don't just skip forever" fix already applied to the SUPER_ADMIN bootstrap seed
// earlier in this project's life. Concretely what this was needed for: the five
// win-security-* conditions were added to ZERO_TRUST_CONDITIONS after "Baseline Device
// Trust" had already been seeded on real installs — without this, those installs would
// never have received them.
async function seedZeroTrustPolicy() {
  const name = "Baseline Device Trust";
  let policy = await prisma.zeroTrustPolicy.findFirst({ where: { name } });

  if (!policy) {
    policy = await prisma.zeroTrustPolicy.create({
      data: {
        name,
        description:
          "Device-trust conditions distilled from a prior posture-based NAC project (OS currency, firewall, disk encryption, required AV/management agent, patch currency, blacklisted processes), plus the Windows Security app's own top-level categories (virus & threat protection, account protection, firewall & network protection, app & browser control, device security). The AV/management-agent checks are hardcoded to Kaspersky to match this environment — clone and adjust for a different vendor.",
        createdByAdminId: null,
      },
    });
    console.log(`Seeded ZeroTrustPolicy "${name}"`);
  }

  const existingConditions = await prisma.zeroTrustCondition.findMany({
    where: { policyId: policy.id },
    select: { conditionKey: true },
  });
  const existingKeys = new Set(existingConditions.map((c) => c.conditionKey));
  const missing = ZERO_TRUST_CONDITIONS.filter((c) => !existingKeys.has(c.conditionKey));

  if (missing.length === 0) {
    console.log(`ZeroTrustPolicy "${name}" already has all ${ZERO_TRUST_CONDITIONS.length} seed conditions, skipping.`);
    return;
  }

  await prisma.zeroTrustCondition.createMany({
    data: missing.map((c) => ({
      policyId: policy!.id,
      conditionKey: c.conditionKey,
      title: c.title,
      description: c.description,
      checkPowerShell: c.checkPowerShell,
      operator: c.operator,
      expectedValue: c.expectedValue,
    })),
  });

  console.log(`Added ${missing.length} new condition(s) to ZeroTrustPolicy "${name}": ${missing.map((c) => c.conditionKey).join(", ")}`);
}

interface SeedDlpRule {
  ruleType: "CONTENT_KEYWORD" | "CONTENT_REGEX" | "CONTENT_PATTERN" | "BLOCKED_PATH" | "TRUSTED_PROCESS" | "FILE_EXTENSION";
  value: string;
  label?: string;
}

interface SeedDlpPolicy {
  name: string;
  description: string;
  enforcementMode: "ALERT_ONLY" | "BLOCK";
  removableMediaOnly: boolean;
  rules: SeedDlpRule[];
}

// Ready-made starting points, not locked templates — fully editable/deletable like
// any other policy. All ship with enabled: false: an admin reviews and checks the
// ones they actually want active rather than having anything start enforcing (or
// even just alerting) silently on seed.
const DLP_POLICIES: SeedDlpPolicy[] = [
  {
    name: "Personal & Financial Identifiers on Removable Media",
    description:
      "Detects common personal/financial identifiers in documents written to USB drives. Scoped to common document extensions so binary/media files aren't scanned, and exempts Windows Defender's own writes.",
    enforcementMode: "BLOCK",
    removableMediaOnly: true,
    rules: [
      { ruleType: "CONTENT_PATTERN", value: "AADHAAR", label: "Aadhaar number" },
      { ruleType: "CONTENT_PATTERN", value: "PAN_INDIA", label: "PAN" },
      { ruleType: "CONTENT_PATTERN", value: "CREDIT_CARD", label: "Credit/debit card number" },
      { ruleType: "CONTENT_PATTERN", value: "EMAIL", label: "Email address" },
      { ruleType: "FILE_EXTENSION", value: ".csv" },
      { ruleType: "FILE_EXTENSION", value: ".xlsx" },
      { ruleType: "FILE_EXTENSION", value: ".docx" },
      { ruleType: "FILE_EXTENSION", value: ".pdf" },
      { ruleType: "FILE_EXTENSION", value: ".txt" },
      { ruleType: "TRUSTED_PROCESS", value: "MsMpEng.exe", label: "Windows Defender" },
    ],
  },
  {
    name: "Cloud Sync Folder Restriction",
    description:
      "Flags writes into common cloud-storage sync folders regardless of file type or media — a broader, more disruptive scope than removable-media rules, so this ships as alert-only. Review before switching to Block.",
    enforcementMode: "ALERT_ONLY",
    removableMediaOnly: false,
    rules: [
      { ruleType: "BLOCKED_PATH", value: "\\Dropbox\\", label: "Dropbox" },
      { ruleType: "BLOCKED_PATH", value: "\\OneDrive\\", label: "OneDrive" },
      { ruleType: "BLOCKED_PATH", value: "\\Google Drive\\", label: "Google Drive" },
      { ruleType: "BLOCKED_PATH", value: "\\Box\\", label: "Box" },
    ],
  },
  {
    name: "Confidential Document Markers",
    description:
      "Detects common sensitivity marker phrases in documents written to USB drives — catches intentionally-labeled confidential material regardless of its actual content.",
    enforcementMode: "ALERT_ONLY",
    removableMediaOnly: true,
    rules: [
      { ruleType: "CONTENT_KEYWORD", value: "Confidential" },
      { ruleType: "CONTENT_KEYWORD", value: "Internal Use Only" },
      { ruleType: "CONTENT_KEYWORD", value: "Do Not Distribute" },
      { ruleType: "CONTENT_KEYWORD", value: "Strictly Private" },
    ],
  },
  {
    name: "Source Code & Credential Protection",
    description:
      "Detects AWS access keys and PEM private key headers accidentally left in files being written anywhere (not scoped to removable media, since credential leaks matter regardless of destination). Custom regex rules — extend with your own secret formats.",
    enforcementMode: "ALERT_ONLY",
    removableMediaOnly: false,
    rules: [
      { ruleType: "CONTENT_REGEX", value: "\\bAKIA[0-9A-Z]{16}\\b", label: "AWS access key" },
      {
        ruleType: "CONTENT_REGEX",
        value: "-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----",
        label: "Private key header",
      },
    ],
  },
];

async function seedDlpPolicies() {
  for (const p of DLP_POLICIES) {
    const existing = await prisma.dlpPolicy.findFirst({ where: { name: p.name } });
    if (existing) {
      console.log(`DlpPolicy "${p.name}" already exists, skipping seed.`);
      continue;
    }

    const policy = await prisma.dlpPolicy.create({
      data: {
        name: p.name,
        description: p.description,
        enforcementMode: p.enforcementMode,
        removableMediaOnly: p.removableMediaOnly,
        enabled: false,
        createdByAdminId: null,
      },
    });

    await prisma.dlpRule.createMany({
      data: p.rules.map((r) => ({
        policyId: policy.id,
        ruleType: r.ruleType,
        value: r.value,
        label: r.label ?? null,
      })),
    });

    console.log(`Seeded DlpPolicy "${p.name}" with ${p.rules.length} rules (disabled by default)`);
  }
}

interface SeedCommandTemplate {
  name: string;
  description: string;
  shell: "powershell" | "cmd";
  script: string;
}

const COMMAND_TEMPLATES: SeedCommandTemplate[] = [
  {
    name: "Force logoff all users",
    description: "Logs off every interactive session on the endpoint. Parses `quser` (no simpler built-in cmdlet exists for this) — best-effort, edit freely.",
    shell: "powershell",
    script: [
      "quser 2>$null | Select-Object -Skip 1 | ForEach-Object {",
      "  $sessionId = ($_ -replace '\\s{2,}', ',').Split(',')[2]",
      "  if ($sessionId -match '^\\d+$') { logoff $sessionId }",
      "}",
    ].join("\n"),
  },
  {
    name: "Flush DNS cache",
    description: "Clears the local DNS resolver cache.",
    shell: "powershell",
    script: "ipconfig /flushdns",
  },
  {
    name: "Restart print spooler",
    description: "Restarts the Windows Print Spooler service — the standard fix for a stuck print queue.",
    shell: "powershell",
    script: "Restart-Service -Name Spooler -Force",
  },
  {
    name: "Clear temp files",
    description: "Deletes contents of the user and Windows temp folders, skipping any files currently in use.",
    shell: "powershell",
    script: [
      "Get-ChildItem -Path $env:TEMP, \"$env:WINDIR\\Temp\" -Recurse -Force -ErrorAction SilentlyContinue |",
      "  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue",
      "Write-Output 'Temp files cleared (locked files skipped)'",
    ].join("\n"),
  },
];

async function seedCommandTemplates(createdByAdminId: string) {
  for (const t of COMMAND_TEMPLATES) {
    const existing = await prisma.commandTemplate.findFirst({ where: { name: t.name } });
    if (existing) {
      console.log(`CommandTemplate "${t.name}" already exists, skipping seed.`);
      continue;
    }
    await prisma.commandTemplate.create({
      data: { name: t.name, description: t.description, shell: t.shell, script: encryptField(t.script), createdByAdminId },
    });
    console.log(`Seeded CommandTemplate "${t.name}"`);
  }
}

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@local";
  const password = process.env.ADMIN_PASSWORD ?? "changeme";

  let adminId: string;
  const existingAdmin = await prisma.adminUser.findUnique({ where: { email } });
  if (existingAdmin) {
    console.log(`AdminUser ${email} already exists, skipping seed.`);
    adminId = existingAdmin.id;
    // Guards against a permanent lockout: an admin row created before role-based access
    // existed (or by an earlier setup attempt on this same machine) defaults to plain
    // ADMIN, and nothing else in the app can ever promote the first account - only
    // promote here when there is truly no super admin anywhere yet, so a deliberate
    // demotion on an already-bootstrapped system is never silently undone.
    const superAdminCount = await prisma.adminUser.count({ where: { role: "SUPER_ADMIN" } });
    if (superAdminCount === 0) {
      await prisma.adminUser.update({ where: { id: existingAdmin.id }, data: { role: "SUPER_ADMIN" } });
      console.log(`Promoted ${email} to SUPER_ADMIN (no super admin existed yet).`);
    }
  } else {
    const passwordHash = await bcrypt.hash(password, 10);
    // The bootstrap admin must be a super admin - otherwise no account could ever create
    // the first super admin (or any other admin at all) post-install.
    const created = await prisma.adminUser.create({ data: { email, passwordHash, role: "SUPER_ADMIN" } });
    console.log(`Seeded AdminUser ${email} (SUPER_ADMIN)`);
    adminId = created.id;
  }

  await seedBenchmark(
    "Windows Security Baseline (CIS-aligned)",
    "An original rule set inspired by publicly documented CIS Level 1 Windows hardening guidance — not the copyrighted CIS benchmark document itself.",
    "WINDOWS_10",
    BASELINE_RULES,
  );
  await seedBenchmark(
    "Windows 11 Additional Hardening (CIS-aligned)",
    "Hardware-security checks unique to Windows 11 (TPM, Secure Boot, VBS, Credential Guard, Memory Integrity). Assign this alongside the Windows 10 baseline, not instead of it.",
    "WINDOWS_11",
    WINDOWS_11_RULES,
  );
  await seedBenchmark(
    "Windows Server Hardening (CIS-aligned)",
    "Server-oriented hardening checks (Print Spooler, SMB/LDAP signing, NTLM, Telnet). Not verified end-to-end against a real Server install in this environment.",
    "WINDOWS_SERVER",
    WINDOWS_SERVER_RULES,
  );
  await seedBenchmark(
    "SQL Server Hardening (CIS-aligned)",
    "Runs via sqlcmd against a local default SQL Server instance using Windows trusted auth. Named-instance or SQL-auth environments should clone this as a CUSTOM benchmark.",
    "SQL_SERVER",
    SQL_SERVER_RULES,
  );

  await seedZeroTrustPolicy();
  await seedDlpPolicies();
  await seedCommandTemplates(adminId);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
