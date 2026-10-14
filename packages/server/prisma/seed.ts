import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { encryptField } from "../src/utils/fieldEncryption";
import { installBuiltInBenchmarks } from "../src/services/builtInBenchmarks";

const prisma = new PrismaClient();

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

  const builtIns = await installBuiltInBenchmarks(prisma);
  for (const b of builtIns.created) console.log(`Seeded SecurityBenchmark "${b.name}" with ${b.rules} rules`);
  for (const name of builtIns.skipped) console.log(`SecurityBenchmark "${name}" already exists, skipping seed.`);

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
