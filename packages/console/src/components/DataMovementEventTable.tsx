import type { AgentDataMovementEventView } from "../api/types";
import { Badge } from "./ui";
import { formatBytes, formatDateTime } from "../format";

// One row per file that left through USB, a cloud-sync folder or a network share: when, who,
// which file, where it came from on the endpoint (copied or moved) and where it went.
// Used on the endpoint's Data protection tab and in the Data movement page's endpoint rows.

const CHANNEL_LABEL: Record<string, string> = {
  USB: "USB / removable",
  CLOUD_SYNC: "Cloud sync",
  NETWORK_SHARE: "Network share",
};

function destinationName(e: AgentDataMovementEventView): string {
  const d = e.channelDetail;
  if (e.channel === "USB") {
    return [d.volumeLabel || d.driveLetter, d.serialNumber ? `serial ${d.serialNumber}` : null].filter(Boolean).join(" · ") || "USB drive";
  }
  if (e.channel === "NETWORK_SHARE") return [d.driveLetter, d.uncPath].filter(Boolean).join(" ") || "Network share";
  return d.provider || "Cloud sync";
}

function fileName(p: string): string {
  return p.slice(Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/")) + 1) || p;
}

function folderOf(p: string): string {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i > 0 ? p.slice(0, i) : p;
}

function Source({ e }: { e: AgentDataMovementEventView }) {
  if (e.operation === null) return <span className="app-muted">Not recorded (agent before 0.2.25)</span>;
  if (!e.sourcePath) return <span className="app-muted">Not found on this PC (downloaded or created there)</span>;
  return (
    <span className="app-stack-xs">
      <span>
        <Badge tone="neu">{e.operation === "MOVE" ? "Moved from" : "Copied from"}</Badge>
      </span>
      <span className="ep-mono" style={{ wordBreak: "break-all" }}>
        {folderOf(e.sourcePath)}
      </span>
    </span>
  );
}

export default function DataMovementEventTable({ events, showPolicy = false }: { events: AgentDataMovementEventView[]; showPolicy?: boolean }) {
  return (
    <div className="app-table-scroll">
      <table className="ep-tbl">
        <thead>
          <tr>
            <th scope="col">Detected</th>
            <th scope="col">User</th>
            <th scope="col">File</th>
            <th scope="col">From</th>
            <th scope="col">To</th>
            {showPolicy && <th scope="col">Policy</th>}
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td className="app-muted" style={{ whiteSpace: "nowrap" }}>
                {formatDateTime(e.detectedAt)}
              </td>
              <td>{e.userName ?? <span className="app-muted">—</span>}</td>
              <td>
                <span className="app-stack-xs">
                  <span style={{ wordBreak: "break-all" }}>{fileName(e.filePath)}</span>
                  <span className="app-muted ep-num">{formatBytes(e.fileSizeBytes)}</span>
                </span>
              </td>
              <td>
                <Source e={e} />
              </td>
              <td>
                <span className="app-stack-xs">
                  <span>
                    <Badge tone="med">{CHANNEL_LABEL[e.channel] ?? e.channel}</Badge> <span className="app-muted">{destinationName(e)}</span>
                  </span>
                  <span className="ep-mono" style={{ wordBreak: "break-all" }}>
                    {folderOf(e.filePath)}
                  </span>
                </span>
              </td>
              {showPolicy && <td>{e.policyName}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
