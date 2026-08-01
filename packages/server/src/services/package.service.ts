import fs from "node:fs";
import type { PackageMetadata } from "@em/shared";
import { prisma } from "../db";
import { sha256File } from "../utils/hashFile";

export async function uploadPackage(params: {
  metadata: PackageMetadata;
  uploadedByAdminId: string;
  savedFilePath: string;
  originalFilename: string;
  fileSizeBytes: number;
}): Promise<{ packageId: string }> {
  const sha256 = await sha256File(params.savedFilePath);

  const pkg = await prisma.package.create({
    data: {
      name: params.metadata.name,
      version: params.metadata.version,
      installerType: params.metadata.installerType,
      silentArgs: params.metadata.silentArgs,
      filename: params.originalFilename,
      storagePath: params.savedFilePath,
      fileSizeBytes: params.fileSizeBytes,
      sha256,
      uploadedByAdminId: params.uploadedByAdminId,
    },
  });

  return { packageId: pkg.id };
}

export async function listPackages() {
  const packages = await prisma.package.findMany({ orderBy: { createdAt: "desc" } });
  return packages.map((p) => ({
    id: p.id,
    name: p.name,
    version: p.version,
    filename: p.filename,
    fileSizeBytes: p.fileSizeBytes,
    sha256: p.sha256,
    installerType: p.installerType,
    silentArgs: p.silentArgs,
    uploadedByAdminId: p.uploadedByAdminId,
    createdAt: p.createdAt.toISOString(),
  }));
}

export async function getPackageRecord(id: string) {
  return prisma.package.findUnique({ where: { id } });
}

export async function deletePackage(id: string): Promise<boolean> {
  const pkg = await prisma.package.findUnique({ where: { id } });
  if (!pkg) return false;

  await prisma.package.delete({ where: { id } });
  await fs.promises.unlink(pkg.storagePath).catch(() => {});
  return true;
}
