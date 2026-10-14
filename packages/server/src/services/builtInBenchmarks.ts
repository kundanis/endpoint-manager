import type { PrismaClient } from "@prisma/client";

// The built-in hardening benchmarks: original rule sets inspired by publicly documented CIS
// Level 1 / Microsoft baseline categories - not the copyrighted CIS benchmark text itself.
// Installed from the console (Security configuration -> Add built-in benchmarks) or by
// prisma/seed.ts; both skip any benchmark whose name already exists, so re-running never
// duplicates or overwrites an admin's edits.

export interface SeedRule {
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

export type BuiltInTargetType = "WINDOWS_10" | "WINDOWS_11" | "WINDOWS_SERVER" | "SQL_SERVER";

export const BUILT_IN_BENCHMARKS: { name: string; description: string; targetType: BuiltInTargetType; rules: SeedRule[] }[] = [
  {
    name: "Windows Security Baseline (CIS-aligned)",
    description: "An original rule set inspired by publicly documented CIS Level 1 Windows hardening guidance — not the copyrighted CIS benchmark document itself.",
    targetType: "WINDOWS_10",
    rules: BASELINE_RULES,
  },
  {
    name: "Windows 11 Additional Hardening (CIS-aligned)",
    description: "Hardware-security checks unique to Windows 11 (TPM, Secure Boot, VBS, Credential Guard, Memory Integrity). Assign this alongside the Windows 10 baseline, not instead of it.",
    targetType: "WINDOWS_11",
    rules: WINDOWS_11_RULES,
  },
  {
    name: "Windows Server Hardening (CIS-aligned)",
    description: "Server-oriented hardening checks (Print Spooler, SMB/LDAP signing, NTLM, Telnet). Not verified end-to-end against a real Server install in this environment.",
    targetType: "WINDOWS_SERVER",
    rules: WINDOWS_SERVER_RULES,
  },
  {
    name: "SQL Server Hardening (CIS-aligned)",
    description: "Runs via sqlcmd against a local default SQL Server instance using Windows trusted auth. Named-instance or SQL-auth environments should clone this as a CUSTOM benchmark.",
    targetType: "SQL_SERVER",
    rules: SQL_SERVER_RULES,
  },
];

// Creates each built-in benchmark that doesn't exist yet (matched by name). Returns what
// was created and what was skipped.
export async function installBuiltInBenchmarks(
  prisma: PrismaClient,
): Promise<{ created: { name: string; rules: number }[]; skipped: string[] }> {
  const created: { name: string; rules: number }[] = [];
  const skipped: string[] = [];
  for (const b of BUILT_IN_BENCHMARKS) {
    const existing = await prisma.securityBenchmark.findFirst({ where: { name: b.name } });
    if (existing) {
      skipped.push(b.name);
      continue;
    }
    await prisma.$transaction(async (tx) => {
      const benchmark = await tx.securityBenchmark.create({
        data: { name: b.name, description: b.description, source: "BUILT_IN", targetType: b.targetType, createdByAdminId: null },
      });
      await tx.securityBenchmarkRule.createMany({
        data: b.rules.map((r) => ({
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
    });
    created.push({ name: b.name, rules: b.rules.length });
  }
  return { created, skipped };
}
