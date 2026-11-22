import { useState, type FormEvent } from "react";
import { Check, KeyRound, SearchX, X } from "lucide-react";
import {
  useAgents,
  useApprovePolicyAccessException,
  useAssetGroups,
  useAppControlPolicies,
  useCommandBlockPolicies,
  useCreatePolicyAccessException,
  useDlpPolicies,
  useIpBlockPolicies,
  usePolicyAccessExceptions,
  useRejectPolicyAccessException,
  useEndPolicyAccessException,
  useScreenshotBlockPolicies,
  useUsbControlPolicies,
  useWebBlockPolicies,
} from "../api/hooks";
import type { PolicyAccessExceptionType } from "@em/shared";
import type { PolicyAccessExceptionView } from "../api/types";
import EndpointLabel, { EndpointOption } from "../components/EndpointLabel";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormFooter,
  FormGrid,
  PageHeader,
  Pagination,
  SearchInput,
  Segmented,
  Skeleton,
  Toolbar,
  useConfirm,
  usePagedList,
  useToast,
  type BadgeTone,
} from "../components/ui";
import { formatDateTime } from "../format";

const POLICY_TYPE_LABELS: Record<PolicyAccessExceptionType, string> = {
  APP_CONTROL: "Application control",
  WEB_BLOCK: "Web & email blocking",
  COMMAND_BLOCK: "Command blocking",
  IP_BLOCK: "IP blocking",
  USB_CONTROL: "USB device control",
  SCREENSHOT_BLOCK: "Screenshot blocking",
  DLP: "DLP",
};
const POLICY_TYPES = Object.keys(POLICY_TYPE_LABELS) as PolicyAccessExceptionType[];

const DURATION_OPTIONS = [
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 240, label: "4 hours" },
  { minutes: 1440, label: "1 day" },
  { minutes: 10080, label: "7 days" },
];

// Requests a user raised from the Endpoint IQ tray app on their own PC carry this prefix plus
// their Windows account (ENDPOINT_USER_REQUESTER_PREFIX in @em/shared - copied, as the console
// can't import runtime values from that package).
const ENDPOINT_USER_PREFIX = "endpoint-user:";

function endpointRequester(r: PolicyAccessExceptionView): string | null {
  return r.requestedByAdminId.startsWith(ENDPOINT_USER_PREFIX) ? r.requestedByAdminId.slice(ENDPOINT_USER_PREFIX.length) : null;
}

type DisplayStatus = "pending" | "active" | "expired" | "ended" | "rejected";

// Approved requests are "Active" until they expire or an admin ends them; the server sets isActive.
function displayStatus(r: PolicyAccessExceptionView): DisplayStatus {
  if (r.status === "PENDING") return "pending";
  if (r.status === "REJECTED") return "rejected";
  if (r.status === "ENDED") return "ended";
  return r.isActive ? "active" : "expired";
}

const STATUS_BADGE: Record<DisplayStatus, { tone: BadgeTone; label: string }> = {
  pending: { tone: "med", label: "Pending" },
  active: { tone: "ok", label: "Active" },
  expired: { tone: "crit", label: "Expired" },
  ended: { tone: "neu", label: "Ended early" },
  rejected: { tone: "crit", label: "Rejected" },
};

function usePoliciesForType(policyType: PolicyAccessExceptionType) {
  const appControl = useAppControlPolicies();
  const webBlock = useWebBlockPolicies();
  const commandBlock = useCommandBlockPolicies();
  const ipBlock = useIpBlockPolicies();
  const usbControl = useUsbControlPolicies();
  const dlp = useDlpPolicies();
  const screenshotBlock = useScreenshotBlockPolicies();

  switch (policyType) {
    case "APP_CONTROL":
      return appControl.data ?? [];
    case "WEB_BLOCK":
      return webBlock.data ?? [];
    case "COMMAND_BLOCK":
      return commandBlock.data ?? [];
    case "IP_BLOCK":
      return ipBlock.data ?? [];
    case "USB_CONTROL":
      return usbControl.data ?? [];
    case "DLP":
      return dlp.data ?? [];
    case "SCREENSHOT_BLOCK":
      return screenshotBlock.data ?? [];
  }
}

// "DOMAIN\jdoe" and "jdoe" are the same user for the search.
function bareUser(value: string | null | undefined): string {
  const v = (value ?? "").trim().toLowerCase();
  return v.slice(v.lastIndexOf("\\") + 1);
}

function RequestForm() {
  const { data: agents } = useAgents();
  const { data: groups } = useAssetGroups();
  const createRequest = useCreatePolicyAccessException();
  const toast = useToast();

  const [policyType, setPolicyType] = useState<PolicyAccessExceptionType>("APP_CONTROL");
  const [policyId, setPolicyId] = useState("");
  // One endpoint, or every endpoint in a group (one request per endpoint).
  const [target, setTarget] = useState<"agent" | "group">("agent");
  const [agentId, setAgentId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [search, setSearch] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [reason, setReason] = useState("");

  const policies = usePoliciesForType(policyType);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createRequest.mutate(
      { policyType, policyId, ...(target === "agent" ? { agentId } : { groupId }), durationMinutes, reason },
      {
        onSuccess: (result) => {
          if (result.created > 1) toast(`${result.created} requests created, one for each endpoint in the group.`);
          setPolicyId("");
          setAgentId("");
          setGroupId("");
          setSearch("");
          setReason("");
        },
      },
    );
  }

  // The search narrows the list - endpoints by hostname, signed-in user or group, groups by name.
  const term = search.trim().toLowerCase();
  const agentText = (a: NonNullable<typeof agents>[number]) =>
    [a.hostname, a.inventory?.lastLoggedOnUser ?? "", ...a.groups.map((g) => g.name)].join(" ").toLowerCase();
  const matchAgents = (t: string) => (agents ?? []).filter((a) => !t || agentText(a).includes(t));
  const matchGroups = (t: string) => (groups ?? []).filter((g) => !t || g.name.toLowerCase().includes(t));
  const shownAgents = matchAgents(term);
  const shownGroups = matchGroups(term);

  // Typing selects the best match straight away: an exact hostname, user or group name first,
  // otherwise the first match. No match clears the selection.
  function handleSearch(value: string) {
    setSearch(value);
    const t = value.trim().toLowerCase();
    if (!t) return;
    if (target === "agent") {
      const found = matchAgents(t);
      const exact = found.find((a) => a.hostname.toLowerCase() === t || bareUser(a.inventory?.lastLoggedOnUser) === bareUser(t));
      setAgentId((exact ?? found[0])?.id ?? "");
    } else {
      const found = matchGroups(t);
      setGroupId((found.find((g) => g.name.toLowerCase() === t) ?? found[0])?.id ?? "");
    }
  }
  const chosenGroup = groups?.find((g) => g.id === groupId);
  const hasTarget = target === "agent" ? !!agentId : !!groupId && (chosenGroup?.memberCount ?? 0) > 0;

  return (
    <form className="ep-card" onSubmit={handleSubmit}>
      <div className="ep-section">
        <h4>Request an Access Exception</h4>
        <p>
          Temporarily carve out an endpoint, or every endpoint in a group, from one EPM or DLP policy's enforcement, for a
          fixed window. A group creates one request per endpoint. Nothing takes effect until an admin approves it above.
        </p>
        <FormGrid>
          <Field label="Module" htmlFor="ae-module">
            <select
              id="ae-module"
              className="ep-select"
              value={policyType}
              onChange={(e) => {
                setPolicyType(e.target.value as PolicyAccessExceptionType);
                setPolicyId("");
              }}
            >
              {POLICY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {POLICY_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Policy" htmlFor="ae-policy" required>
            <select id="ae-policy" className="ep-select" value={policyId} onChange={(e) => setPolicyId(e.target.value)} required>
              <option value="">Select a policy…</option>
              {policies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Request for" htmlFor="ae-target">
            <Segmented
              label="Request for"
              options={[
                { value: "agent", label: "Endpoint" },
                { value: "group", label: "Group" },
              ]}
              value={target}
              onChange={(v) => {
                setTarget(v);
                setSearch("");
              }}
            />
          </Field>
          <Field label={target === "agent" ? "Search endpoints" : "Search groups"} htmlFor="ae-search">
            <SearchInput
              id="ae-search"
              placeholder={target === "agent" ? "Hostname or user name" : "Group name"}
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </Field>
          {target === "agent" ? (
            <Field label="Endpoint" htmlFor="ae-endpoint" required span2>
              <select id="ae-endpoint" className="ep-select" value={agentId} onChange={(e) => setAgentId(e.target.value)} required>
                <option value="">{term ? (shownAgents.length ? `Select an endpoint… (${shownAgents.length} match)` : "No endpoint matches the search") : "Select an endpoint…"}</option>
                {shownAgents.map((a) => (
                  <EndpointOption key={a.id} value={a.id} hostname={a.hostname} agentId={a.id} />
                ))}
              </select>
            </Field>
          ) : (
            <Field
              label="Group"
              htmlFor="ae-group"
              required
              span2
              help={chosenGroup ? (chosenGroup.memberCount > 0 ? `Creates ${chosenGroup.memberCount} request${chosenGroup.memberCount === 1 ? "" : "s"}, one per endpoint.` : "This group has no endpoints.") : undefined}
            >
              <select id="ae-group" className="ep-select" value={groupId} onChange={(e) => setGroupId(e.target.value)} required>
                <option value="">{term ? (shownGroups.length ? `Select a group… (${shownGroups.length} match)` : "No group matches the search") : "Select a group…"}</option>
                {shownGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.memberCount} endpoint{g.memberCount === 1 ? "" : "s"})
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Duration" htmlFor="ae-duration">
            <select id="ae-duration" className="ep-select" value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))}>
              {DURATION_OPTIONS.map((d) => (
                <option key={d.minutes} value={d.minutes}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reason" htmlFor="ae-reason" required span2>
            <input
              id="ae-reason"
              className="ep-input"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Contractor needs temporary access to a blocked site for a vendor demo"
              required
            />
          </Field>
        </FormGrid>
        {createRequest.isError && (
          <div style={{ marginTop: 12 }}>
            <Alert tone="critical">{(createRequest.error as Error).message}</Alert>
          </div>
        )}
      </div>
      <FormFooter>
        <Button type="submit" variant="primary" disabled={createRequest.isPending || !policyId || !hasTarget || !reason.trim()}>
          {createRequest.isPending ? "Submitting…" : "Submit request"}
        </Button>
      </FormFooter>
    </form>
  );
}

type StatusFilter = "all" | DisplayStatus;

export default function AccessExceptionsPage() {
  const { data: requests, isLoading, error, refetch } = usePolicyAccessExceptions();
  const approve = useApprovePolicyAccessException();
  const reject = useRejectPolicyAccessException();
  const end = useEndPolicyAccessException();
  const confirm = useConfirm();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const all = requests ?? [];
  const countOf = (s: DisplayStatus) => all.filter((r) => displayStatus(r) === s).length;
  const term = search.trim().toLowerCase();
  const filtered = all.filter(
    (r) =>
      (statusFilter === "all" || displayStatus(r) === statusFilter) &&
      (!term ||
        r.policyName.toLowerCase().includes(term) ||
        (r.hostname ?? "").toLowerCase().includes(term) ||
        r.reason.toLowerCase().includes(term) ||
        POLICY_TYPE_LABELS[r.policyType].toLowerCase().includes(term)),
  );
  const paged = usePagedList(filtered, 25);

  async function handleEnd(r: PolicyAccessExceptionView) {
    const confirmed = await confirm({
      title: `End the Exception for ${r.hostname ?? "this endpoint"} Now?`,
      body: `"${r.policyName}" applies to it again within about 20 seconds, before the exception would have expired (${formatDateTime(r.expiresAt)}).`,
      confirmLabel: "End exception",
      tone: "danger",
    });
    if (!confirmed) return;
    end.mutate({ id: r.id });
  }

  async function handleReject(r: PolicyAccessExceptionView) {
    const confirmed = await confirm({
      title: `Reject the Exception for ${r.hostname ?? "this endpoint"}?`,
      body: `The request to exempt it from "${r.policyName}" is closed and never takes effect.`,
      confirmLabel: "Reject request",
      tone: "danger",
    });
    if (!confirmed) return;
    reject.mutate({ id: r.id });
  }

  function clearFilters() {
    setStatusFilter("all");
    setSearch("");
  }

  return (
    <>
      <PageHeader
        title="Access Exceptions"
        description="Time-bound, admin-approved carve-outs from an EPM or DLP policy's enforcement for one endpoint"
      />

      <Alert tone="info" title="How exceptions take effect">
        The exception filter is applied server-side, so it takes effect the next time that endpoint syncs (within about
        20 seconds), and expires automatically with no separate revert step. Select End now on an active exception to
        end it early; the policy applies again within about 20 seconds. A request must be approved by a different admin
        than the one who raised it. Users can also ask to pause a policy from the Endpoint IQ icon on their PC; those
        requests appear here as pending, marked "Requested on the endpoint".
      </Alert>

      <Card flush>
        <Toolbar
          right={
            <Segmented
              label="Status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: `All ${all.length}` },
                { value: "pending", label: `Pending ${countOf("pending")}` },
                { value: "active", label: `Active ${countOf("active")}` },
                { value: "expired", label: `Expired ${countOf("expired")}` },
                { value: "ended", label: `Ended early ${countOf("ended")}` },
                { value: "rejected", label: `Rejected ${countOf("rejected")}` },
              ]}
            />
          }
        >
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search policy, endpoint, reason…" />
        </Toolbar>

        {(approve.isError || reject.isError) && (
          <div className="ep-cb app-stack-sm">
            {approve.isError && <Alert tone="critical">{(approve.error as Error).message}</Alert>}
            {reject.isError && <Alert tone="critical">{(reject.error as Error).message}</Alert>}
            {end.isError && <Alert tone="critical">{(end.error as Error).message}</Alert>}
          </div>
        )}

        {isLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : error ? (
          <div className="ep-cb">
            <Alert tone="critical" title="Couldn't load access exceptions" action={<Button size="sm" onClick={() => refetch()}>Retry</Button>}>
              {(error as Error).message}
            </Alert>
          </div>
        ) : all.length === 0 ? (
          <EmptyState icon={KeyRound} title="No access exception requests yet">
            Submit a request with the form below; it appears here for another admin to approve.
          </EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No requests match these filters"
            action={
              <Button size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          >
            Try a different search or status.
          </EmptyState>
        ) : (
          <>
            <div className="app-table-scroll">
              <table className="ep-tbl">
                <thead>
                  <tr>
                    <th scope="col">Policy</th>
                    <th scope="col">Endpoint</th>
                    <th scope="col">Reason</th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Duration
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">Expires</th>
                    <th scope="col">
                      <span className="app-vh">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paged.pageItems.map((r) => {
                    const badge = STATUS_BADGE[displayStatus(r)];
                    return (
                      <tr key={r.id}>
                        <td className="ep-host">
                          <b>{r.policyName}</b>
                          <small>{POLICY_TYPE_LABELS[r.policyType]}</small>
                        </td>
                        <td className="ep-host">
                          <EndpointLabel hostname={r.hostname} agentId={r.agentId} />
                          {endpointRequester(r) && <small>Requested on the endpoint by {endpointRequester(r)}</small>}
                        </td>
                        <td style={{ maxWidth: 360 }}>{r.reason}</td>
                        <td className="ep-num" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {r.durationMinutes} min
                        </td>
                        <td>
                          <Badge tone={badge.tone}>{badge.label}</Badge>
                        </td>
                        <td className="app-muted">{formatDateTime(r.expiresAt)}</td>
                        <td>
                          {r.status === "PENDING" && (
                            <div className="app-cell-actions">
                              <Button size="sm" icon={Check} onClick={() => approve.mutate({ id: r.id })} disabled={approve.isPending}>
                                Approve
                              </Button>
                              <Button size="sm" variant="danger" icon={X} onClick={() => handleReject(r)} disabled={reject.isPending}>
                                Reject
                              </Button>
                            </div>
                          )}
                          {displayStatus(r) === "active" && (
                            <div className="app-cell-actions">
                              <Button size="sm" variant="danger" icon={X} onClick={() => handleEnd(r)} disabled={end.isPending}>
                                End now
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={paged.page}
              pageSize={paged.pageSize}
              total={paged.total}
              noun="requests"
              onPageChange={paged.setPage}
              onPageSizeChange={paged.setPageSize}
            />
          </>
        )}
      </Card>

      <RequestForm />
    </>
  );
}
