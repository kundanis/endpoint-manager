import type { PrismaClient } from "@prisma/client";

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

export async function installBuiltInZeroTrustPolicy(
  prisma: PrismaClient,
): Promise<{ name: string; policyCreated: boolean; conditionsAdded: number }> {
  const name = BUILT_IN_ZERO_TRUST_POLICY_NAME;
  let policyCreated = false;
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
    policyCreated = true;
  }

  const existingConditions = await prisma.zeroTrustCondition.findMany({
    where: { policyId: policy.id },
    select: { conditionKey: true },
  });
  const existingKeys = new Set(existingConditions.map((c) => c.conditionKey));
  const missing = ZERO_TRUST_CONDITIONS.filter((c) => !existingKeys.has(c.conditionKey));

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
