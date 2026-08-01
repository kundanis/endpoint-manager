// One-time backfill: encrypts existing plaintext values in the columns
// fieldEncryption.ts now protects, so historical rows match what every new read/write
// goes through. Safe to re-run — each row is skipped if its current value already
// decrypts successfully (i.e. is already in the encrypted format).
import { prisma } from "../src/db";
import { decryptField, encryptField } from "../src/utils/fieldEncryption";

function isAlreadyEncrypted(value: string): boolean {
  try {
    decryptField(value);
    return true;
  } catch {
    return false;
  }
}

async function backfillSoftwareLicenses() {
  const rows = await prisma.softwareLicense.findMany({ where: { licenseKey: { not: null } } });
  let n = 0;
  for (const row of rows) {
    if (!row.licenseKey || isAlreadyEncrypted(row.licenseKey)) continue;
    await prisma.softwareLicense.update({ where: { id: row.id }, data: { licenseKey: encryptField(row.licenseKey) } });
    n++;
  }
  console.log(`SoftwareLicense.licenseKey: encrypted ${n} of ${rows.length} row(s)`);
}

async function backfillCommandJobs() {
  const rows = await prisma.commandJob.findMany();
  let n = 0;
  for (const row of rows) {
    if (isAlreadyEncrypted(row.script)) continue;
    await prisma.commandJob.update({ where: { id: row.id }, data: { script: encryptField(row.script) } });
    n++;
  }
  console.log(`CommandJob.script: encrypted ${n} of ${rows.length} row(s)`);
}

async function backfillCommandTemplates() {
  const rows = await prisma.commandTemplate.findMany();
  let n = 0;
  for (const row of rows) {
    if (isAlreadyEncrypted(row.script)) continue;
    await prisma.commandTemplate.update({ where: { id: row.id }, data: { script: encryptField(row.script) } });
    n++;
  }
  console.log(`CommandTemplate.script: encrypted ${n} of ${rows.length} row(s)`);
}

async function backfillCommandTasks() {
  const rows = await prisma.commandTask.findMany({
    where: { OR: [{ stdout: { not: null } }, { stderr: { not: null } }] },
  });
  let n = 0;
  for (const row of rows) {
    const data: { stdout?: string; stderr?: string } = {};
    if (row.stdout && !isAlreadyEncrypted(row.stdout)) data.stdout = encryptField(row.stdout);
    if (row.stderr && !isAlreadyEncrypted(row.stderr)) data.stderr = encryptField(row.stderr);
    if (Object.keys(data).length === 0) continue;
    await prisma.commandTask.update({ where: { id: row.id }, data });
    n++;
  }
  console.log(`CommandTask.stdout/stderr: encrypted ${n} of ${rows.length} row(s)`);
}

async function main() {
  await backfillSoftwareLicenses();
  await backfillCommandJobs();
  await backfillCommandTemplates();
  await backfillCommandTasks();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
