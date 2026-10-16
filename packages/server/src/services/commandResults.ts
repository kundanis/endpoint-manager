import { prisma } from "../db";
import { decryptFieldOrNull } from "../utils/fieldEncryption";

// The outcome of a command an admin dispatched to fix something on an endpoint (vulnerability
// remediation, benchmark rule fix): the CommandTask of that job on that endpoint, with the
// endpoint's own explanation - its error text on failure, its success line otherwise.
export interface CommandOutcome {
  status: string; // PENDING | DISPATCHED | SUCCESS | FAILED | TIMED_OUT ...
  exitCode: number | null;
  message: string | null;
  requestedAt: string;
  completedAt: string | null;
}

function firstLine(text: string | null): string | null {
  const line = text?.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  return line ? line.slice(0, 500) : null;
}

// Outcomes keyed by `${jobId}:${agentId}`.
export async function getCommandOutcomes(pairs: { jobId: string; agentId: string }[]): Promise<Map<string, CommandOutcome>> {
  const outcomes = new Map<string, CommandOutcome>();
  const jobIds = [...new Set(pairs.map((p) => p.jobId))];
  if (jobIds.length === 0) return outcomes;
  const wanted = new Set(pairs.map((p) => `${p.jobId}:${p.agentId}`));
  const tasks = await prisma.commandTask.findMany({
    where: { jobId: { in: jobIds } },
    select: { jobId: true, agentId: true, status: true, exitCode: true, stdout: true, stderr: true, completedAt: true, job: { select: { createdAt: true } } },
  });
  for (const t of tasks) {
    const key = `${t.jobId}:${t.agentId}`;
    if (!wanted.has(key)) continue;
    const stdout = decryptFieldOrNull(t.stdout) ?? null;
    const stderr = decryptFieldOrNull(t.stderr) ?? null;
    outcomes.set(key, {
      status: t.status,
      exitCode: t.exitCode,
      message: t.status === "SUCCESS" ? firstLine(stdout) : (firstLine(stderr) ?? firstLine(stdout)),
      requestedAt: t.job.createdAt.toISOString(),
      completedAt: t.completedAt?.toISOString() ?? null,
    });
  }
  return outcomes;
}
