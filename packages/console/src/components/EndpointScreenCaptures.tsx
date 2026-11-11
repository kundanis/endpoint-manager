import { useState } from "react";
import { Link } from "react-router-dom";
import { Camera } from "lucide-react";
import { useEndpointScreenCaptureReport, useEndpointScreenCaptures } from "../api/hooks";
import type { ScreenCaptureReportRow } from "../api/types";
import { ScreenCaptureDailyTable, ScreenCaptureList } from "./ScreenCaptureReportView";
import { Alert, Badge, Card, EmptyState, Skeleton } from "./ui";

// The endpoint's Data protection tab -> Screen capture: this endpoint's screenshots from every
// screen capture policy, one row per user per day. Opening a row lists the screenshots (logged in
// Admin logs); super admins also see the saved images and can download or delete them.

const RANGES = [
  { days: 1, label: "Today" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
];

function Captures({ agentId, row }: { agentId: string; row: ScreenCaptureReportRow }) {
  const { data, isLoading } = useEndpointScreenCaptures(agentId, row);
  return <ScreenCaptureList captures={data} isLoading={isLoading} />;
}

export default function EndpointScreenCaptures({ agentId }: { agentId: string }) {
  const [days, setDays] = useState(7);
  const { data: report, isLoading, error } = useEndpointScreenCaptureReport(agentId, days);

  const period = (
    <select className="ep-select" aria-label="Screenshot period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
      {RANGES.map((r) => (
        <option key={r.days} value={r.days}>
          {r.label}
        </option>
      ))}
    </select>
  );
  const totals = report?.totals;
  const hint = totals
    ? `${totals.captures} ${totals.captures === 1 ? "screenshot" : "screenshots"}${totals.quickDeleted > 0 ? ` · ${totals.quickDeleted} deleted quickly` : ""}`
    : undefined;

  return (
    <Card title="Screen capture" hint={hint} actions={period}>
      {isLoading ? (
        <Skeleton />
      ) : error ? (
        <Alert tone="critical" title="Couldn't load screenshots">
          {(error as Error).message}
        </Alert>
      ) : !report || report.rows.length === 0 ? (
        <EmptyState
          icon={Camera}
          title={report && report.policies.length === 0 ? "No screen capture policy on this endpoint" : "No screenshots in this period"}
          action={
            <Link className="ep-link" to="/data-movement/screen-capture">
              Open screen capture
            </Link>
          }
        >
          {report && report.policies.length === 0
            ? "Assign a screen capture policy to this endpoint, or to one of its groups, to record screenshots."
            : "Screenshots taken on this endpoint appear here, one row per user per day."}
        </EmptyState>
      ) : (
        <div className="app-stack-sm">
          <div className="app-cell-actions">
            <span className="app-muted">
              Policies: {report.policies.length > 0 ? report.policies.map((p) => p.name + (p.enabled ? "" : " (off)")).join(", ") : "none now"}. Flagged after
              more than <b>{report.dailyThreshold}</b> a day; deleted within {report.quickDeleteMinutes} min counts as quick.
            </span>
            {report.totals.flaggedUserDays > 0 && <Badge tone="crit">{report.totals.flaggedUserDays} over threshold</Badge>}
          </div>
          <ScreenCaptureDailyTable rows={report.rows} showEndpoint={false} renderCaptures={(r) => <Captures agentId={agentId} row={r} />} />
        </div>
      )}
    </Card>
  );
}
