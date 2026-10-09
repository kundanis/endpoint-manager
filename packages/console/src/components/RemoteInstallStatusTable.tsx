import type { RemoteInstallTaskView } from "../api/types";

// Shared between EnrollmentTokensPage's multi-target "Install on endpoint" panel and
// NetworkScanPage's per-host "Install agent" button - same job/task shape, same
// SUCCESS/FAILED/pending rendering either way.
export default function RemoteInstallStatusTable({ tasks }: { tasks: RemoteInstallTaskView[] }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Target</th>
          <th>Status</th>
          <th>Detail</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t.id}>
            <td className="mono-cell">{t.target}</td>
            <td>
              <span
                className={`status-badge ${t.status === "SUCCESS" ? "online" : t.status === "FAILED" ? "danger" : ""}`}
              >
                {t.status}
              </span>
            </td>
            <td className="mono-cell">
              {t.status === "FAILED" ? t.errorMessage : t.status === "SUCCESS" ? "Installed" : "…"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
