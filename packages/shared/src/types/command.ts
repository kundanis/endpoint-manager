export type Shell = "powershell" | "cmd" | "bash" | "sh";

export type CommandTaskStatus =
  | "PENDING"
  | "DISPATCHED"
  | "SUCCESS"
  | "FAILED"
  | "TIMEOUT";

export interface CommandJob {
  id: string;
  shell: Shell;
  script: string;
  timeoutSec: number;
  createdByAdminId: string;
  createdAt: string;
}

export interface CommandTask {
  id: string;
  jobId: string;
  agentId: string;
  status: CommandTaskStatus;
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  dispatchedAt: string | null;
  completedAt: string | null;
}
