import type { PrismaClient } from "@prisma/client";
import type { RequiredSoftwareRequest, SecurityProductChoice } from "@em/shared";

// The built-in Zero Trust policy. Installed from the console (Zero Trust -> Add built-in
// policy) or by prisma/seed.ts; both create it only when missing and only add conditions it
// doesn't have yet, so re-running never duplicates or overwrites an admin's edits.

export const BUILT_IN_ZERO_TRUST_POLICY_NAME = "Baseline Device Trust";

export interface ZeroTrustSeedCondition {
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
// a fast, reliable proxy instead. The antivirus and management-agent conditions aren't in
// this list: they're generated for whichever products the admin picks (see
// requiredSoftwareConditions below).
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
      "Windows Hello (PIN, face or fingerprint) is set up for at least one user on the device. Read from the folder Windows keeps Hello credentials in, which only the agent (running as SYSTEM) can open.",
    // The Ngc folder lives under the LocalService profile, not ProgramData (the old path never
    // existed, so this check used to fail everywhere).
    checkPowerShell:
      "$ngc = Join-Path $env:windir 'ServiceProfiles\\LocalService\\AppData\\Local\\Microsoft\\Ngc'; $n = 0; try { $n = @(Get-ChildItem -LiteralPath $ngc -Directory -Force -ErrorAction Stop).Count } catch {}; if ($n -gt 0) { 'COMPLIANT' } else { 'NONCOMPLIANT: Windows Hello (PIN, face or fingerprint) is not set up for any user' }",
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
    description:
      "SmartScreen for apps and files is on, SmartScreen for Microsoft Edge isn't turned off by policy, and exploit protection (DEP, CFG) isn't switched off system-wide.",
    // An absent SmartScreenEnabled value is Windows' default (on); only an explicit Off, or the
    // EnableSmartScreen=0 policy, means it's off. The policy value wins over the user setting.
    checkPowerShell:
      "$r = @(); $p = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System' -Name EnableSmartScreen -ErrorAction SilentlyContinue).EnableSmartScreen; $e = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer' -Name SmartScreenEnabled -ErrorAction SilentlyContinue).SmartScreenEnabled; if ($p -eq 0 -or ($null -eq $p -and $e -eq 'Off')) { $r += 'SmartScreen for apps and files is off' }; $edge = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge' -Name SmartScreenEnabled -ErrorAction SilentlyContinue).SmartScreenEnabled; if ($edge -eq 0) { $r += 'SmartScreen for Microsoft Edge is turned off by policy' }; try { $m = Get-ProcessMitigation -System -ErrorAction Stop; if ([string]$m.Dep.Enable -eq 'OFF') { $r += 'Exploit protection: DEP is off' }; if ([string]$m.Cfg.Enable -eq 'OFF') { $r += 'Exploit protection: CFG is off' } } catch {}; if ($r.Count) { 'NONCOMPLIANT: ' + ($r -join '; ') } else { 'COMPLIANT' }",
    operator: "EQUALS",
    expectedValue: "COMPLIANT",
  },
  {
    conditionKey: "win-security-device-security",
    title: "Device security",
    description:
      "The device has a working TPM (security processor) and UEFI Secure Boot is on. Legacy BIOS devices can't use Secure Boot, so they don't pass.",
    // Confirm-SecureBootUEFI throws on legacy BIOS - caught and read as off.
    checkPowerShell:
      "$r = @(); $tpm = $null; try { $tpm = Get-Tpm -ErrorAction Stop } catch {}; if (-not ($tpm -and $tpm.TpmPresent -and $tpm.TpmReady)) { $r += 'TPM is missing or not ready' }; $sb = $false; try { $sb = Confirm-SecureBootUEFI -ErrorAction Stop } catch {}; if (-not $sb) { $r += 'Secure Boot is off' }; if ($r.Count) { 'NONCOMPLIANT: ' + ($r -join '; ') } else { 'COMPLIANT' }",
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

export interface SecurityProductOption {
  id: string;
  label: string;
  match: string[]; // product-name fragments, matched case-insensitively
}

// Names as they appear in Windows Security Center (AntiVirusProduct.displayName). EDRs that
// replace Defender register there too. "Other" in the console lets the admin type any name.
export const ANTIVIRUS_PRODUCTS: SecurityProductOption[] = [
  { id: "defender", label: "Microsoft Defender Antivirus", match: ["Defender"] },
  { id: "kaspersky", label: "Kaspersky", match: ["Kaspersky"] },
  { id: "crowdstrike", label: "CrowdStrike Falcon", match: ["CrowdStrike"] },
  { id: "sentinelone", label: "SentinelOne", match: ["Sentinel"] },
  { id: "sophos", label: "Sophos", match: ["Sophos"] },
  { id: "trendmicro", label: "Trend Micro", match: ["Trend Micro"] },
  { id: "symantec", label: "Symantec / Broadcom Endpoint Protection", match: ["Symantec", "Broadcom"] },
  { id: "trellix", label: "Trellix / McAfee", match: ["Trellix", "McAfee"] },
  { id: "eset", label: "ESET", match: ["ESET"] },
  { id: "bitdefender", label: "Bitdefender", match: ["Bitdefender"] },
  { id: "cortex", label: "Palo Alto Cortex XDR", match: ["Cortex"] },
  { id: "seqrite", label: "Seqrite / Quick Heal", match: ["Seqrite", "Quick Heal"] },
  { id: "k7", label: "K7 Security", match: ["K7"] },
  { id: "avast", label: "Avast / AVG", match: ["Avast", "AVG"] },
  { id: "webroot", label: "Webroot", match: ["Webroot"] },
  { id: "malwarebytes", label: "Malwarebytes", match: ["Malwarebytes"] },
];

// Names as they appear in Programs and Features (the Uninstall registry keys).
export const MANAGEMENT_AGENTS: SecurityProductOption[] = [
  { id: "endpoint-one", label: "Endpoint IQ agent", match: ["Endpoint Pro", "Endpoint One", "Endpoint IQ"] },
  { id: "intune", label: "Microsoft Intune Management Extension", match: ["Intune Management Extension"] },
  { id: "configmgr", label: "Microsoft Configuration Manager (SCCM) client", match: ["Configuration Manager Client"] },
  { id: "kaspersky-ksc", label: "Kaspersky Security Center Network Agent", match: ["Kaspersky Security Center Network Agent"] },
  { id: "manageengine", label: "ManageEngine Endpoint Central / UEMS agent", match: ["ManageEngine", "Desktop Central"] },
  { id: "tanium", label: "Tanium Client", match: ["Tanium"] },
  { id: "ivanti", label: "Ivanti / LANDESK agent", match: ["Ivanti", "LANDESK"] },
  { id: "ninja", label: "NinjaOne agent", match: ["NinjaRMM", "NinjaOne"] },
  { id: "connectwise", label: "ConnectWise Automate agent", match: ["ConnectWise", "LabTech"] },
];

function psList(items: string[]): string {
  return `@(${items.map((i) => `'${i.replace(/'/g, "''")}'`).join(", ")})`;
}

const MATCH_ANY =
  "$hit = $names | Where-Object { $n = $_; @($needles | Where-Object { $n.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count -gt 0 } | Select-Object -First 1";

function describeMatch(choice: SecurityProductChoice): string {
  return choice.match.map((m) => `"${m}"`).join(" or ");
}

// Both checks print "OK: <product found>" or "Missing (...)" and pass on CONTAINS "OK:", so an
// endpoint's result shows what it actually found. Matching is a plain case-insensitive
// substring test (IndexOf): nothing the admin types is ever run as code or as a pattern.
function antivirusCondition(choice: SecurityProductChoice): ZeroTrustSeedCondition {
  return {
    conditionKey: "antivirus-registered",
    title: `Antivirus: ${choice.name} is registered with Windows Security Center`,
    description: `Passes when an antivirus whose name contains ${describeMatch(choice)} is registered with Windows Security Center (the list Windows Security itself shows). Workstations only - Windows Server has no Security Center.`,
    checkPowerShell: [
      `$needles = ${psList(choice.match)}`,
      "$names = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue | ForEach-Object { $_.displayName } | Where-Object { $_ })",
      MATCH_ANY,
      "if ($hit) { \"OK: $hit\" } elseif ($names.Count) { \"Missing (registered: $($names -join ', '))\" } else { 'Missing (no antivirus registered)' }",
    ].join("; "),
    operator: "CONTAINS",
    expectedValue: "OK:",
  };
}

function managementAgentCondition(choice: SecurityProductChoice): ZeroTrustSeedCondition {
  return {
    conditionKey: "management-agent-installed",
    title: `Management agent: ${choice.name} is installed`,
    description: `Passes when an installed program's name contains ${describeMatch(choice)} (Programs and Features, 64- and 32-bit).`,
    checkPowerShell: [
      `$needles = ${psList(choice.match)}`,
      "$roots = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'",
      // GetValue per key: one malformed value elsewhere can't fail the whole lookup.
      "$names = @(foreach ($r in $roots) { Get-ChildItem -Path $r -ErrorAction SilentlyContinue | ForEach-Object { $_.GetValue('DisplayName') } | Where-Object { $_ } })",
      MATCH_ANY,
      "if ($hit) { \"OK: $hit\" } else { 'Missing (not installed)' }",
    ].join("; "),
    operator: "CONTAINS",
    expectedValue: "OK:",
  };
}

// What a policy needs for the chosen products: conditions to upsert, and keys to remove
// (a product set to "don't check").
export function requiredSoftwareConditions(req: RequiredSoftwareRequest): {
  upsert: ZeroTrustSeedCondition[];
  remove: string[];
} {
  const upsert: ZeroTrustSeedCondition[] = [];
  const remove: string[] = [];
  if (req.antivirus) upsert.push(antivirusCondition(req.antivirus));
  else remove.push("antivirus-registered");
  if (req.managementAgent) upsert.push(managementAgentCondition(req.managementAgent));
  else remove.push("management-agent-installed");
  return { upsert, remove };
}

// Applies the choice to any policy: creates or updates the two conditions, or removes the one
// set to "don't check". The policy's other conditions are untouched.
export async function setRequiredSoftware(prisma: PrismaClient, policyId: string, req: RequiredSoftwareRequest): Promise<void> {
  const { upsert, remove } = requiredSoftwareConditions(req);
  await prisma.$transaction(async (tx) => {
    for (const c of upsert) {
      await tx.zeroTrustCondition.upsert({
        where: { policyId_conditionKey: { policyId, conditionKey: c.conditionKey } },
        create: { policyId, ...c },
        update: {
          title: c.title,
          description: c.description,
          checkPowerShell: c.checkPowerShell,
          operator: c.operator,
          expectedValue: c.expectedValue,
        },
      });
    }
    if (remove.length) await tx.zeroTrustCondition.deleteMany({ where: { policyId, conditionKey: { in: remove } } });
  });
}

// Used when nothing is chosen (prisma/seed.ts): Defender, no management-agent check.
export const DEFAULT_REQUIRED_SOFTWARE: RequiredSoftwareRequest = {
  antivirus: { name: ANTIVIRUS_PRODUCTS[0].label, match: ANTIVIRUS_PRODUCTS[0].match },
  managementAgent: null,
};

// The built-in checks an admin can add to any policy (Conditions -> Add built-in check), so a
// renamed or self-made policy can still get e.g. the Windows Security checks without typing
// PowerShell. Required software (antivirus / management agent) has its own tab, so it's not here.
export function builtInConditionChoices(): ZeroTrustSeedCondition[] {
  return ZERO_TRUST_CONDITIONS.map((c) => ({ ...c }));
}

// The two conditions the Required software tab writes (and removes, with "Don't check").
export const REQUIRED_SOFTWARE_KEYS = ["antivirus-registered", "management-agent-installed"];

// Built-in conditions can be switched off or edited, but not deleted: switching off keeps the
// check one click away, and a deleted one used to be gone for good. Custom conditions an admin
// adds under their own key stay deletable.
export function isProtectedConditionKey(conditionKey: string): boolean {
  return REQUIRED_SOFTWARE_KEYS.includes(conditionKey) || ZERO_TRUST_CONDITIONS.some((c) => c.conditionKey === conditionKey);
}

// "Reset to built-in": puts an edited built-in check back to its shipped definition (keeps its
// on/off switch). Returns false when the condition isn't in this policy or isn't a resettable
// built-in (required-software conditions are reset from their own tab).
export async function resetBuiltInCondition(prisma: PrismaClient, policyId: string, conditionId: string): Promise<boolean> {
  const row = await prisma.zeroTrustCondition.findFirst({ where: { id: conditionId, policyId }, select: { conditionKey: true } });
  const def = row && ZERO_TRUST_CONDITIONS.find((c) => c.conditionKey === row.conditionKey);
  if (!def) return false;
  await prisma.zeroTrustCondition.update({
    where: { id: conditionId },
    data: {
      title: def.title,
      description: def.description,
      checkPowerShell: def.checkPowerShell,
      operator: def.operator,
      expectedValue: def.expectedValue,
    },
  });
  return true;
}

// Adds the chosen built-in checks the policy doesn't have yet; ones it already has are left as
// they are (an admin may have edited them).
export async function addBuiltInConditions(prisma: PrismaClient, policyId: string, conditionKeys: string[]): Promise<number> {
  const wanted = ZERO_TRUST_CONDITIONS.filter((c) => conditionKeys.includes(c.conditionKey));
  const existing = await prisma.zeroTrustCondition.findMany({
    where: { policyId, conditionKey: { in: wanted.map((c) => c.conditionKey) } },
    select: { conditionKey: true },
  });
  const have = new Set(existing.map((c) => c.conditionKey));
  const missing = wanted.filter((c) => !have.has(c.conditionKey));
  if (missing.length) {
    await prisma.zeroTrustCondition.createMany({ data: missing.map((c) => ({ policyId, ...c })) });
  }
  return missing.length;
}

export async function installBuiltInZeroTrustPolicy(
  prisma: PrismaClient,
  required: RequiredSoftwareRequest = DEFAULT_REQUIRED_SOFTWARE,
): Promise<{ name: string; policyCreated: boolean; conditionsAdded: number }> {
  const name = BUILT_IN_ZERO_TRUST_POLICY_NAME;
  let policyCreated = false;
  let policy = await prisma.zeroTrustPolicy.findFirst({ where: { name } });

  if (!policy) {
    policy = await prisma.zeroTrustPolicy.create({
      data: {
        name,
        description:
          "Device-trust conditions: OS currency, firewall, disk encryption, required antivirus and management agent, patch currency and blocked processes, plus the Windows Security app's own categories (virus & threat protection, account protection, firewall & network protection, app & browser control, device security). Choose the required antivirus and management agent under Required software.",
        createdByAdminId: null,
      },
    });
    policyCreated = true;
  }

  const existingConditions = await prisma.zeroTrustCondition.findMany({
    where: { policyId: policy.id },
    select: { conditionKey: true },
  });
  const existingKeys = new Set(existingConditions.map((c) => c.conditionKey));
  const wanted = [...ZERO_TRUST_CONDITIONS, ...requiredSoftwareConditions(required).upsert];
  const missing = wanted.filter((c) => !existingKeys.has(c.conditionKey));

  if (missing.length === 0) return { name, policyCreated, conditionsAdded: 0 };

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

  return { name, policyCreated, conditionsAdded: missing.length };
}
