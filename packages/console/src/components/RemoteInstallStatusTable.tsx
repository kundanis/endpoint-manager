import type { RemoteInstallTaskView } from "../api/types";
import { Badge, Pill } from "./ui";

// Shared between EnrollmentTokensPage's multi-target "Install on endpoint" panel and
// NetworkScanPage's per-host "Install agent" button - same job/task shape, same
// SUCCESS/FAILED/pending rendering either way.
export default function RemoteInstallStatusTable({ tasks }: { tasks: RemoteInstallTaskView[] }) {
  return (
    <div className="app-table-wrap">
      <table className="ep-tbl">
        <thead>
          <tr>
            <th scope="col">Target</th>
            <th scope="col">Status</th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id}>
              <td className="ep-mono">{t.target}</td>
              <td>
                {t.status === "SUCCESS" ? (
                  <Badge tone="ok">Installed</Badge>
                ) : t.status === "FAILED" ? (
                  <Badge tone="crit">Failed</Badge>
                ) : (
                  <Pill tone="warn">In progress</Pill>
                )}
              </td>
              <td className={t.status === "FAILED" ? "ep-mono" : undefined}>
                {t.status === "FAILED" ? t.errorMessage : t.status === "SUCCESS" ? "Agent installed" : "Waiting for the endpoint…"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
