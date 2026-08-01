import { useState } from "react";
import { useApproveUnlockRequest, useRejectUnlockRequest, useUnlockRequests } from "../api/hooks";

function statusBadgeClass(status: string): string {
  if (status === "APPROVED") return "online";
  if (status === "REJECTED") return "danger";
  return "offline";
}

export default function UnlockRequestsPage() {
  const { data: requests } = useUnlockRequests();
  const approve = useApproveUnlockRequest();
  const reject = useRejectUnlockRequest();
  const [notes, setNotes] = useState<Record<string, string>>({});

  return (
    <div>
      <h1>Unlock Requests</h1>
      <p>
        A deployment that lost its bindingToken (or is migrating to new hardware) sends one of these. Approving
        resets the key to <span className="mono-cell">ISSUED</span> so it can be activated again — verify the
        requester's identity out-of-band before approving.
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <th>Entity</th>
            <th>Key (suffix)</th>
            <th>Requesting deployment</th>
            <th>Reason</th>
            <th>Status</th>
            <th>Requested</th>
            <th>Resolution note</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {requests?.map((r) => (
            <tr key={r.id}>
              <td>{r.licenseKey.entity.name}</td>
              <td className="mono-cell">…{r.licenseKey.keySuffix}</td>
              <td className="mono-cell">{r.requestingDeploymentId}</td>
              <td>{r.reason}</td>
              <td>
                <span className={`status-badge ${statusBadgeClass(r.status)}`}>{r.status}</span>
              </td>
              <td>{new Date(r.requestedAt).toLocaleString()}</td>
              <td>
                {r.status === "PENDING" ? (
                  <input
                    type="text"
                    placeholder="Note (optional)"
                    value={notes[r.id] ?? ""}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  />
                ) : (
                  r.resolutionNote ?? "—"
                )}
              </td>
              <td>
                {r.status === "PENDING" && (
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <button
                      type="button"
                      onClick={() => approve.mutate({ id: r.id, resolutionNote: notes[r.id] })}
                      disabled={approve.isPending || reject.isPending}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => reject.mutate({ id: r.id, resolutionNote: notes[r.id] })}
                      disabled={approve.isPending || reject.isPending}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
          {requests?.length === 0 && (
            <tr>
              <td colSpan={8}>No unlock requests.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
