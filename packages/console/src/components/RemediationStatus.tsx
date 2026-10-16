import type { FindingRemediation } from "../api/types";
import { Badge, Pill } from "./ui";

// The latest fix dispatched for a finding on its endpoint - a vulnerability remediation
// (update / uninstall) or a benchmark rule fix (configure): what was done, how it went, and on
// failure the reason the endpoint reported (e.g. "this program refuses to be uninstalled ...
// update it instead").
const IN_PROGRESS = new Set(["PENDING", "DISPATCHED", "RUNNING"]);

export function isRemediationInProgress(r: { status: string } | null | undefined): boolean {
  return !!r && IN_PROGRESS.has(r.status);
}

const WORDS: Record<FindingRemediation["action"], { verb: string; done: string }> = {
  update: { verb: "Update", done: "Updated" },
  uninstall: { verb: "Uninstall", done: "Uninstalled" },
  configure: { verb: "Fix", done: "Fix applied" },
};

export default function RemediationStatus({
  remediation,
  emptyLabel = "Not remediated",
}: {
  remediation: FindingRemediation | null;
  emptyLabel?: string;
}) {
  if (!remediation) return <span className="app-muted">{emptyLabel}</span>;
  const words = WORDS[remediation.action] ?? WORDS.uninstall;

  let badge;
  if (remediation.status === "SUCCESS") badge = <Badge tone="ok">{words.done}</Badge>;
  else if (IN_PROGRESS.has(remediation.status))
    badge = (
      <span title={remediation.status === "PENDING" ? "Waiting for the endpoint to check in and collect it" : undefined}>
        <Pill tone="warn">{remediation.status === "PENDING" ? `${words.verb} queued` : `${words.verb} running`}</Pill>
      </span>
    );
  else badge = <Pill tone="critical">{words.verb} failed</Pill>;

  const message =
    remediation.message ??
    (remediation.status !== "SUCCESS" && !IN_PROGRESS.has(remediation.status) && remediation.exitCode !== null
      ? `Exit code ${remediation.exitCode}`
      : null);

  return (
    <div className="app-stack-sm">
      {badge}
      {message && <span className="ep-hint">{message}</span>}
    </div>
  );
}
