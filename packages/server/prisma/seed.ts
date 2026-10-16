import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { encryptField } from "../src/utils/fieldEncryption";
import { installBuiltInBenchmarks } from "../src/services/builtInBenchmarks";
import { installBuiltInZeroTrustPolicy } from "../src/services/builtInZeroTrust";

const prisma = new PrismaClient();

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

  const zt = await installBuiltInZeroTrustPolicy(prisma);
  console.log(`ZeroTrustPolicy "${zt.name}": ${zt.policyCreated ? "created" : "exists"}, ${zt.conditionsAdded} condition(s) added`);
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
