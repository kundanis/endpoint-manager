import type { FindingRemediation } from "../api/types";
import { Badge, Pill } from "./ui";

// A vulnerability finding's latest remediation on its endpoint: what was done, how it went,
// and - on failure - the reason the endpoint reported (e.g. "this program refuses to be
// uninstalled ... update it instead").
const IN_PROGRESS = new Set(["PENDING", "DISPATCHED", "RUNNING"]);

export function isRemediationInProgress(r: FindingRemediation | null | undefined): boolean {
  return !!r && IN_PROGRESS.has(r.status);
}

export default function RemediationStatus({ remediation }: { remediation: FindingRemediation | null }) {
  if (!remediation) return <span className="app-muted">Not remediated</span>;
  const verb = remediation.action === "update" ? "Update" : "Uninstall";

  let badge;
  if (remediation.status === "SUCCESS") badge = <Badge tone="ok">{remediation.action === "update" ? "Updated" : "Uninstalled"}</Badge>;
  else if (IN_PROGRESS.has(remediation.status))
    badge = <Pill tone="warn">{remediation.status === "PENDING" ? `${verb} queued` : `${verb} running`}</Pill>;
  else badge = <Pill tone="critical">{verb} failed</Pill>;

  return (
    <div className="app-stack-sm">
      {badge}
      {remediation.message && <span className="ep-hint">{remediation.message}</span>}
    </div>
  );
}
