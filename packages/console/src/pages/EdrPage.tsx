import { useState } from "react";
import { Lock, LockOpen, Monitor, ShieldAlert } from "lucide-react";
import { useEdrAgents, useEdrEvents, useQuarantineAgent, useReleaseAgent, useSetEdrEnabled } from "../api/hooks";
import type { EdrAgentSummaryView } from "../api/types";
import EndpointLabel, { EndpointOption } from "../components/EndpointLabel";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Pagination,
  RowMenu,
  Skeleton,
  Switch,
  Toolbar,
  useConfirm,
  usePagedList,
} from "../components/ui";
import { formatDateTime } from "../format";

const CATEGORY_LABEL: Record<string, string> = {
  PROCESS: "Suspicious process",
  PERSISTENCE: "New persistence entry",
};

const RIGHT = { textAlign: "right" } as const;

function DetailSummary({ category, detail }: { category: string; detail: Record<string, unknown> }) {
  if (category === "PROCESS") {
    return (
      <span className="ep-mono" style={{ overflowWrap: "anywhere" }}>
        {String(detail.processName)} (pid {String(detail.processId)})
        {detail.parentProcessName ? ` ← ${detail.parentProcessName}` : ""}
        {detail.commandLine ? `: ${detail.commandLine}` : ""}
      </span>
    );
  }
  return (
    <span className="ep-mono" style={{ overflowWrap: "anywhere" }}>
      {String(detail.location)} — {String(detail.name)}
      {detail.command ? `: ${detail.command}` : ""}
    </span>
  );
}

function AgentRow({ agent }: { agent: EdrAgentSummaryView }) {
  const setEnabled = useSetEdrEnabled();
  const quarantine = useQuarantineAgent();
  const release = useReleaseAgent();
  const confirm = useConfirm();
  const [pending, setPending] = useState(false);

  async function handleIsolateToggle() {
    if (agent.quarantined) {
      const confirmed = await confirm({
        title: `Release ${agent.hostname} from quarantine?`,
        body: "This restores normal outbound network access on the endpoint.",
        confirmLabel: "Release endpoint",
      });
      if (!confirmed) return;
      setPending(true);
      release.mutate(agent.agentId, { onSettled: () => setPending(false) });
    } else {
      const confirmed = await confirm({
        title: `Isolate ${agent.hostname}?`,
        body:
          "This locks the endpoint's firewall down to DNS and this server only — all other network access is blocked " +
          "until you release it. The endpoint must be online to pick up the command.",
        confirmLabel: "Isolate endpoint",
        tone: "danger",
      });
      if (!confirmed) return;
      setPending(true);
      quarantine.mutate(agent.agentId, { onSettled: () => setPending(false) });
    }
  }

  return (
    <tr>
      <td>
        <EndpointLabel hostname={agent.hostname} agentId={agent.agentId} />
      </td>
      <td>
        <Switch
          checked={agent.edrEnabled}
          onChange={(enabled) => setEnabled.mutate({ agentId: agent.agentId, enabled })}
          label={agent.edrEnabled ? "Enabled" : "Off"}
        />
      </td>
      <td className="ep-num" style={RIGHT}>
        {agent.eventCount}
      </td>
      <td className="app-muted">{formatDateTime(agent.lastDetectedAt)}</td>
      <td>{agent.quarantined ? <Badge tone="crit">Quarantined</Badge> : <span className="app-muted">Normal</span>}</td>
      <td>
        <div className="app-cell-actions">
          <RowMenu
            label={`Actions for ${agent.hostname}`}
            items={[
              {
                label: pending ? "Working…" : agent.quarantined ? "Release from quarantine" : "Isolate endpoint",
                icon: agent.quarantined ? LockOpen : Lock,
                danger: !agent.quarantined,
                disabled: pending,
                onSelect: handleIsolateToggle,
              },
            ]}
          />
        </div>
      </td>
    </tr>
  );
}

export default function EdrPage() {
  const { data: agents, isLoading, error, refetch } = useEdrAgents();
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const { data: events, isLoading: eventsLoading } = useEdrEvents(selectedAgentId);

  const agentsPaged = usePagedList(agents ?? [], 25);
  const eventsPaged = usePagedList(events ?? [], 25);

  return (
    <>
      <PageHeader
        title="EDR (lite)"
        description="Process-tree and command-line heuristics plus a new-persistence-entry watch, scanned every 30 seconds on each endpoint"
      />

      <Alert tone="warn" title="This is poll-based detection, not real-time kernel/ETW interception">
        Built-in process-tree and command-line heuristics (Office/PDF/script apps spawning a command interpreter, LOLBin
        abuse patterns) plus a new-persistence-entry watch (Run keys, services, scheduled tasks), scanned every 30
        seconds. It can catch persistent or sloppy malware but will miss anything that finishes between scans.
        High-confidence process-tree matches are killed automatically; command-line heuristics are alert-only (a
        legitimate script can occasionally match one of these patterns).
      </Alert>

      <Card flush title="Endpoints" hint="EDR-lite detection and network isolation per endpoint">
        {isLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : error ? (
          <div className="ep-cb">
            <Alert tone="critical" title="Couldn't load endpoints" action={<Button size="sm" onClick={() => refetch()}>Retry</Button>}>
              {(error as Error).message}
            </Alert>
          </div>
        ) : !agents || agents.length === 0 ? (
          <EmptyState icon={Monitor} title="No endpoints enrolled yet">
            Enroll an endpoint with an enrollment token; it appears here with EDR-lite detection controls.
          </EmptyState>
        ) : (
          <>
            <div className="app-table-scroll">
              <table className="ep-tbl">
                <thead>
                  <tr>
                    <th scope="col">Endpoint</th>
                    <th scope="col">EDR detection</th>
                    <th scope="col" style={RIGHT}>
                      Events
                    </th>
                    <th scope="col">Last detection</th>
                    <th scope="col">Network status</th>
                    <th scope="col">
                      <span className="app-vh">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {agentsPaged.pageItems.map((a) => (
                    <AgentRow key={a.agentId} agent={a} />
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={agentsPaged.page}
              pageSize={agentsPaged.pageSize}
              total={agentsPaged.total}
              noun="endpoints"
              onPageChange={agentsPaged.setPage}
              onPageSizeChange={agentsPaged.setPageSize}
            />
          </>
        )}
      </Card>

      <Card flush title="Events" hint={events ? `${events.length} ${events.length === 1 ? "detection" : "detections"}` : undefined}>
        <Toolbar>
          <select
            className="ep-select"
            aria-label="Filter by endpoint"
            value={selectedAgentId ?? ""}
            onChange={(e) => setSelectedAgentId(e.target.value || undefined)}
          >
            <option value="">Endpoint: All</option>
            {agents?.map((a) => (
              <EndpointOption key={a.agentId} value={a.agentId} hostname={a.hostname} agentId={a.agentId} />
            ))}
          </select>
        </Toolbar>
        {eventsLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : !events || events.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title={selectedAgentId ? "No detections on this endpoint yet" : "No detections yet"}
            action={
              selectedAgentId && (
                <Button size="sm" onClick={() => setSelectedAgentId(undefined)}>
                  Show all endpoints
                </Button>
              )
            }
          >
            Detections appear here within about 30 seconds of a match on an endpoint with EDR detection enabled.
          </EmptyState>
        ) : (
          <>
            <div className="app-table-scroll">
              <table className="ep-tbl">
                <thead>
                  <tr>
                    <th scope="col">Endpoint</th>
                    <th scope="col">Category</th>
                    <th scope="col">Summary</th>
                    <th scope="col">Detail</th>
                    <th scope="col">Severity</th>
                    <th scope="col">Killed</th>
                    <th scope="col">Detected</th>
                  </tr>
                </thead>
                <tbody>
                  {eventsPaged.pageItems.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <EndpointLabel hostname={e.hostname} agentId={e.agentId} />
                      </td>
                      <td>{CATEGORY_LABEL[e.category] ?? e.category}</td>
                      <td>{e.summary}</td>
                      <td style={{ maxWidth: 420 }}>
                        <DetailSummary category={e.category} detail={e.detail} />
                      </td>
                      <td>{e.severity === "HIGH" ? <Badge tone="high">High</Badge> : <Badge tone="med">Medium</Badge>}</td>
                      <td>{e.killed ? <Badge tone="ok">Killed</Badge> : <span className="app-muted">—</span>}</td>
                      <td className="app-muted">{formatDateTime(e.detectedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={eventsPaged.page}
              pageSize={eventsPaged.pageSize}
              total={eventsPaged.total}
              noun="events"
              onPageChange={eventsPaged.setPage}
              onPageSizeChange={eventsPaged.setPageSize}
            />
          </>
        )}
      </Card>
    </>
  );
}
