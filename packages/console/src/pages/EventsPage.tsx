import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Activity, ChevronDown, ChevronRight, ExternalLink, Layers, ListFilter, Monitor, ShieldAlert } from "lucide-react";
import { useEventGroups, useEventOptions, useEventTimeline } from "../api/hooks";
import type { EventCategory, EventGroupView, EventItemView, EventSeverity } from "../api/types";
import { formatDateTime, formatRelative, pluralize } from "../format";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  FilterChips,
  Kpi,
  KpiStrip,
  PageHeader,
  Pagination,
  Segmented,
  Skeleton,
  Tabs,
  Toolbar,
  usePagedList,
  type BadgeTone,
} from "../components/ui";

// Events (PAGE_PATTERNS: list page with KPI strip). Everything the agents and the console
// record, from every module the admin can open, in one place: "By event" shows each kind of
// event once with the endpoints it happened on; "Timeline" shows every event, newest first.
// Filters live in the address, so an endpoint can link here with ?agent= set. Acting on an
// event (release, unblock, remediate) stays on its module's page - each row links there.

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  THREATS: "Threats",
  DATA_PROTECTION: "Data protection",
  DEVICE_CONTROL: "Device control",
  POLICY_VIOLATIONS: "Policy violations",
  COMPLIANCE: "Compliance",
  USER_RISK: "User risk",
  SOFTWARE_CHANGES: "Software changes",
};

const SEVERITY_LABELS: Record<EventSeverity, string> = { CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low", INFO: "Info" };
const SEVERITY_TONES: Record<EventSeverity, BadgeTone> = { CRITICAL: "crit", HIGH: "high", MEDIUM: "med", LOW: "low", INFO: "neu" };
const SEVERITIES: EventSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

const PERIODS = [
  { value: "1", label: "24 hours" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
] as const;
type Period = (typeof PERIODS)[number]["value"];

const ICON = { size: 16, strokeWidth: 1.7, "aria-hidden": true } as const;

// Icon link to the event's own module page (where it can be acted on).
function ModuleLink({ to }: { to: string }) {
  return (
    <Link className="ep-iconbtn" to={to} aria-label="Open module page" title="Open module page" onClick={(e) => e.stopPropagation()} style={{ verticalAlign: "middle" }}>
      <ExternalLink size={16} strokeWidth={1.7} className="ep-ic" aria-hidden />
    </Link>
  );
}

function SeverityBadge({ severity }: { severity: EventSeverity }) {
  return <Badge tone={SEVERITY_TONES[severity]}>{SEVERITY_LABELS[severity]}</Badge>;
}

export default function EventsPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "timeline" ? "timeline" : "events";
  const period: Period = (PERIODS.find((p) => p.value === params.get("period"))?.value ?? "7") as Period;
  const agent = params.get("agent") ?? "";
  const group = agent ? "" : (params.get("group") ?? "");
  const category = params.get("category") ?? "";
  const severity = params.get("severity") ?? "";
  const type = params.get("type") ?? "";
  const event = params.get("event") ?? "";

  // Changing one filter keeps the others; endpoint and group are either/or.
  function setParam(changes: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (changes.agent) next.delete("group");
    if (changes.group) next.delete("agent");
    setParams(next, { replace: true });
  }

  // The period is fixed when it's chosen (not "now" on every refresh), so pages stay stable.
  const [periodEnd, setPeriodEnd] = useState(() => new Date());
  useEffect(() => setPeriodEnd(new Date()), [period]);
  const from = useMemo(() => new Date(periodEnd.getTime() - Number(period) * 86400000).toISOString(), [period, periodEnd]);

  const qs = useMemo(() => {
    const q = new URLSearchParams({ from });
    if (agent) q.set("agent", agent);
    if (group) q.set("group", group);
    if (category) q.set("category", category);
    if (severity) q.set("severity", severity);
    if (type) q.set("type", type);
    return q.toString();
  }, [from, agent, group, category, severity, type]);

  const { data: options } = useEventOptions();
  const { data, isLoading, error, refetch } = useEventGroups(qs);

  const agentName = agent ? (options?.agents.find((a) => a.id === agent)?.hostname ?? "this endpoint") : undefined;
  const groupName = group ? (options?.groups.find((g) => g.id === group)?.name ?? "this group") : undefined;
  const eventGroup = event ? data?.groups.find((g) => g.key === event) : undefined;
  const typeLabel = type ? (options?.types.find((t) => t.type === type)?.label ?? type) : undefined;
  const categories = [...new Set((options?.types ?? []).map((t) => t.category))];

  const chips = [
    agent && { key: "agent", label: `Endpoint: ${agentName}`, onRemove: () => setParam({ agent: "" }) },
    group && { key: "group", label: `Group: ${groupName}`, onRemove: () => setParam({ group: "" }) },
    category && { key: "category", label: `Category: ${CATEGORY_LABELS[category as EventCategory] ?? category}`, onRemove: () => setParam({ category: "" }) },
    severity && {
      key: "severity",
      label: `Severity: ${severity
        .split(",")
        .map((s) => SEVERITY_LABELS[s as EventSeverity] ?? s)
        .join(", ")}`,
      onRemove: () => setParam({ severity: "" }),
    },
    type && { key: "type", label: `Event type: ${typeLabel}`, onRemove: () => setParam({ type: "" }) },
    event && { key: "event", label: `Event: ${eventGroup?.title ?? "selected event"}`, onRemove: () => setParam({ event: "" }) },
  ].filter((c): c is { key: string; label: string; onRemove: () => void } => !!c);

  const totals = data?.totals;
  const critHigh = (totals?.bySeverity.CRITICAL ?? 0) + (totals?.bySeverity.HIGH ?? 0);
  const topCategory = Object.entries(totals?.byCategory ?? {}).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0] as [EventCategory, number] | undefined;
  const scopeText = agentName ?? (groupName ? `group ${groupName}` : "every endpoint");

  return (
    <div className="app-stack">
      <PageHeader
        title="Events"
        description={`Threats, policy violations, compliance failures and changes from every module, on ${scopeText}`}
        actions={<Segmented label="Period" options={[...PERIODS]} value={period} onChange={(v) => setParam({ period: v === "7" ? "" : v })} />}
      />

      {error ? (
        <Alert tone="critical">
          Couldn't load events: {(error as Error).message}{" "}
          <button type="button" className="ep-link app-link-btn" onClick={() => refetch()}>
            Try again
          </button>
        </Alert>
      ) : (
        <KpiStrip>
          <Kpi icon={Activity} label="Events" value={totals ? totals.events.toLocaleString() : "—"} footer={totals ? `${pluralize(totals.kinds, "kind")} of event` : undefined} />
          <Kpi
            icon={ShieldAlert}
            label="Critical and high"
            value={totals ? critHigh.toLocaleString() : "—"}
            valueTone={critHigh > 0 ? "critical" : undefined}
            footer={totals && totals.events > 0 ? `${Math.round((critHigh / totals.events) * 100)}% of events` : undefined}
            onClick={() => setParam({ severity: severity === "CRITICAL,HIGH" ? "" : "CRITICAL,HIGH" })}
            active={severity === "CRITICAL,HIGH"}
            title="Show only critical and high events"
          />
          <Kpi
            icon={Monitor}
            label="Endpoints with events"
            value={totals ? totals.endpoints.toLocaleString() : "—"}
            footer={agentName ? agentName : groupName ? `in group ${groupName}` : undefined}
          />
          <Kpi
            icon={Layers}
            label="Top category"
            value={topCategory ? CATEGORY_LABELS[topCategory[0]] : "—"}
            footer={topCategory ? `${topCategory[1].toLocaleString()} events` : undefined}
            onClick={topCategory ? () => setParam({ category: category === topCategory[0] ? "" : topCategory[0] }) : undefined}
            active={!!topCategory && category === topCategory[0]}
          />
        </KpiStrip>
      )}

      <Card flush>
        <Tabs
          items={[
            { value: "events", label: "By Event" },
            { value: "timeline", label: "Timeline" },
          ]}
          value={view}
          onChange={(v) => setParam({ view: v === "timeline" ? "timeline" : "" })}
        />
        <Toolbar>
          <select className="ep-select" aria-label="Endpoint" value={agent} onChange={(e) => setParam({ agent: e.target.value })}>
            <option value="">Endpoint: All</option>
            {agent && !options?.agents.some((a) => a.id === agent) && <option value={agent}>This endpoint</option>}
            {(options?.agents ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.hostname}
              </option>
            ))}
          </select>
          <select className="ep-select" aria-label="Group" value={group} onChange={(e) => setParam({ group: e.target.value })}>
            <option value="">Group: All</option>
            {(options?.groups ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.path ?? g.name}
              </option>
            ))}
          </select>
          <select className="ep-select" aria-label="Category" value={category} onChange={(e) => setParam({ category: e.target.value, type: "" })}>
            <option value="">Category: All</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <select className="ep-select" aria-label="Severity" value={severity} onChange={(e) => setParam({ severity: e.target.value })}>
            <option value="">Severity: All</option>
            <option value="CRITICAL,HIGH">Critical and high</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABELS[s]}
              </option>
            ))}
          </select>
          <select className="ep-select" aria-label="Event type" value={type} onChange={(e) => setParam({ type: e.target.value, event: "" })}>
            <option value="">Event type: All</option>
            {(options?.types ?? [])
              .filter((t) => !category || t.category === category)
              .map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
          </select>
        </Toolbar>
        {chips.length > 0 && (
          <div className="ep-cb" style={{ paddingTop: 0 }}>
            <FilterChips
              chips={chips}
              onClearAll={() =>
                setParam({ agent: "", group: "", category: "", severity: "", type: "", event: "" })
              }
            />
          </div>
        )}

        {view === "events" ? (
          <EventGroupsTable
            groups={data?.groups}
            loading={isLoading}
            filtered={chips.length > 0}
            period={PERIODS.find((p) => p.value === period)!.label}
            onTimeline={(key) => setParam({ view: "timeline", event: key })}
            onEndpoint={(id) => setParam({ agent: id })}
          />
        ) : (
          <Timeline key={`${qs}|${event}`} qs={event ? `${qs}&event=${encodeURIComponent(event)}` : qs} filtered={chips.length > 0} onEndpoint={(id) => setParam({ agent: id })} />
        )}
      </Card>
    </div>
  );
}

// ---- By event

function EventGroupsTable({
  groups,
  loading,
  filtered,
  period,
  onTimeline,
  onEndpoint,
}: {
  groups: EventGroupView[] | undefined;
  loading: boolean;
  filtered: boolean;
  period: string;
  onTimeline: (key: string) => void;
  onEndpoint: (agentId: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const paged = usePagedList(groups ?? [], 25);

  if (loading && !groups) {
    return (
      <div className="ep-cb">
        <Skeleton lines={6} />
      </div>
    );
  }
  if (!groups || groups.length === 0) {
    return (
      <EmptyState icon={ListFilter} title={filtered ? "No events match these filters" : `No events in the last ${period}`}>
        {filtered ? "Remove a filter or choose a longer period." : "Choose a longer period, or check that policies are assigned to your endpoints."}
      </EmptyState>
    );
  }
  return (
    <>
      <div className="app-table-scroll">
        <table className="ep-tbl">
          <thead>
            <tr>
              <th scope="col">
                <span className="app-vh">Expand</span>
              </th>
              <th scope="col">Severity</th>
              <th scope="col">Event</th>
              <th scope="col">Category</th>
              <th scope="col" style={{ textAlign: "right" }}>
                Endpoints
              </th>
              <th scope="col" style={{ textAlign: "right" }}>
                Occurrences
              </th>
              <th scope="col">Last seen</th>
              <th scope="col">
                <span className="app-vh">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {paged.pageItems.map((g) => {
              const isOpen = open === g.key;
              const canExpand = g.endpoints.length > 0;
              return (
                <Fragment key={g.key}>
                  <tr className={canExpand ? `app-clickable ${isOpen ? "ep-sel" : ""}` : undefined} onClick={canExpand ? () => setOpen(isOpen ? null : g.key) : undefined}>
                    <td style={{ width: 28 }}>
                      {canExpand &&
                        (isOpen ? <ChevronDown {...ICON} aria-label="Hide endpoints" /> : <ChevronRight {...ICON} aria-label="Show endpoints" />)}
                    </td>
                    <td>
                      <SeverityBadge severity={g.severity} />
                    </td>
                    <td>
                      {g.title}
                      <span className="app-row-sub">{g.typeLabel}</span>
                    </td>
                    <td>{CATEGORY_LABELS[g.category]}</td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {g.endpointCount ?? <span className="app-muted">—</span>}
                    </td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {g.occurrences.toLocaleString()}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }} title={formatDateTime(g.lastAt)}>
                      {formatRelative(g.lastAt)}
                      {g.occurrences > 1 && <span className="app-row-sub">first {formatRelative(g.firstAt)}</span>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onTimeline(g.key);
                        }}
                      >
                        Timeline
                      </Button>{" "}
                      <ModuleLink to={g.path} />
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td />
                      <td colSpan={7}>
                        <table className="ep-tbl">
                          <thead>
                            <tr>
                              <th scope="col">Endpoint</th>
                              <th scope="col" style={{ textAlign: "right" }}>
                                Occurrences
                              </th>
                              <th scope="col">Last seen</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.endpoints.map((a) => (
                              <tr key={a.agentId}>
                                <td>
                                  <button type="button" className="ep-link app-link-btn ep-mono" onClick={() => onEndpoint(a.agentId)} title="Show only this endpoint's events">
                                    {a.hostname}
                                  </button>
                                </td>
                                <td className="ep-num" style={{ textAlign: "right" }}>
                                  {a.count.toLocaleString()}
                                </td>
                                <td title={formatDateTime(a.lastAt)}>{formatRelative(a.lastAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {g.endpointCount !== null && g.endpointCount > g.endpoints.length && (
                          <p className="app-muted">
                            Showing the {g.endpoints.length} endpoints with the most occurrences of {g.endpointCount}.
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} noun="events" onPageChange={paged.setPage} onPageSizeChange={paged.setPageSize} />
    </>
  );
}

// ---- Timeline: pages of 100, "Load older" fetches the next page.

function Timeline({ qs, filtered, onEndpoint }: { qs: string; filtered: boolean; onEndpoint: (agentId: string) => void }) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [next, setNext] = useState<{ cursor: string | null; loading: boolean; error: string | null; empty: boolean }>({
    cursor: null,
    loading: true,
    error: null,
    empty: false,
  });

  return (
    <>
      <div className="app-table-scroll">
        <table className="ep-tbl">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Severity</th>
              <th scope="col">Event</th>
              <th scope="col">Endpoint</th>
              <th scope="col">User</th>
              <th scope="col">
                <span className="app-vh">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {cursors.map((c, i) => (
              <TimelinePage key={c ?? "first"} qs={qs} before={c} isLast={i === cursors.length - 1} onState={setNext} onEndpoint={onEndpoint} />
            ))}
          </tbody>
        </table>
      </div>
      {next.error && (
        <div className="ep-cb">
          <Alert tone="critical">Couldn't load events: {next.error}</Alert>
        </div>
      )}
      {next.loading && cursors.length === 1 ? (
        <div className="ep-cb">
          <Skeleton lines={6} />
        </div>
      ) : next.empty && cursors.length === 1 ? (
        <EmptyState icon={ListFilter} title={filtered ? "No events match these filters" : "No events in this period"}>
          {filtered ? "Remove a filter or choose a longer period." : "Choose a longer period."}
        </EmptyState>
      ) : (
        next.cursor && (
          <div className="ep-cb" style={{ textAlign: "center" }}>
            <Button size="sm" disabled={next.loading} onClick={() => setCursors((prev) => [...prev, next.cursor])}>
              {next.loading ? "Loading…" : "Load older events"}
            </Button>
          </div>
        )
      )}
    </>
  );
}

function TimelinePage({
  qs,
  before,
  isLast,
  onState,
  onEndpoint,
}: {
  qs: string;
  before: string | null;
  isLast: boolean;
  onState: (s: { cursor: string | null; loading: boolean; error: string | null; empty: boolean }) => void;
  onEndpoint: (agentId: string) => void;
}) {
  const { data, isLoading, error } = useEventTimeline(qs, before);
  useEffect(() => {
    if (!isLast) return;
    onState({
      cursor: data?.nextBefore ?? null,
      loading: isLoading,
      error: error ? (error as Error).message : null,
      empty: !isLoading && !error && (data?.items.length ?? 0) === 0,
    });
  }, [isLast, data, isLoading, error, onState]);

  return (
    <>
      {(data?.items ?? []).map((item: EventItemView) => (
        <tr key={item.id}>
          <td style={{ whiteSpace: "nowrap" }} title={formatDateTime(item.at)}>
            {formatDateTime(item.at)}
            <span className="app-row-sub">{formatRelative(item.at)}</span>
          </td>
          <td>
            <SeverityBadge severity={item.severity} />
          </td>
          <td>
            {item.title}
            <span className="app-row-sub">
              {item.typeLabel}
              {item.detail ? ` · ${item.detail}` : ""}
            </span>
          </td>
          <td>
            {item.agentId ? (
              <button type="button" className="ep-link app-link-btn ep-mono" onClick={() => onEndpoint(item.agentId!)} title="Show only this endpoint's events">
                {item.hostname}
              </button>
            ) : (
              <span className="app-muted">—</span>
            )}
          </td>
          <td>{item.user ?? <span className="app-muted">—</span>}</td>
          <td>
            <ModuleLink to={item.path} />
          </td>
        </tr>
      ))}
    </>
  );
}
