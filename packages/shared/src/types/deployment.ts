export type InstallerType = "EXE" | "MSI";

export type DeploymentTaskStatus =
  | "PENDING"
  | "DOWNLOADING"
  | "INSTALLING"
  | "SUCCESS"
  | "FAILED";

export interface Package {
  id: string;
  name: string;
  version: string;
  filename: string;
  fileSizeBytes: number;
  sha256: string;
  installerType: InstallerType;
  silentArgs: string;
  uploadedByAdminId: string;
  createdAt: string;
}

export interface DeploymentTask {
  id: string;
  jobId: string;
  agentId: string;
  status: DeploymentTaskStatus;
  exitCode: number | null;
  message: string | null;
  dispatchedAt: string | null;
  completedAt: string | null;
}
