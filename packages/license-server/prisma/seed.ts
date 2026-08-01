import "dotenv/config";
import { PrismaClient } from "../generated/prisma";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.LICENSE_ADMIN_EMAIL ?? "vendor@local";
  const password = process.env.LICENSE_ADMIN_PASSWORD ?? "changeme";

  const existingAdmin = await prisma.licenseAdmin.findUnique({ where: { email } });
  if (existingAdmin) {
    console.log(`LicenseAdmin ${email} already exists, skipping seed.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.licenseAdmin.create({ data: { email, passwordHash } });
  console.log(`Seeded LicenseAdmin ${email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
