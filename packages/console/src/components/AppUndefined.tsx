import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, ShieldCheck } from "lucide-react";
import {
  useAddAppControlRule,
  useAppControlPolicies,
  useUndefinedApplications,
} from "../api/hooks";
import type { UndefinedApplication } from "../api/types";
import EndpointLabel from "./EndpointLabel";
import {
  Alert,
  Badge,
  Button,
  Card,
  Check,
  EmptyState,
  IconButton,
  Pagination,
  RowMenu,
  SearchInput,
  Skeleton,
  usePagedList,
  useToast,
} from "./ui";
import { pluralize } from "../format";

// Application control -> Undefined applications: software installed on endpoints that no policy
// names yet, so admins can decide to allow or block it.
export default function UndefinedApplications() {
  const [includeSystem, setIncludeSystem] = useState(false);
  const [search, setSearch] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch } =
    useUndefinedApplications(includeSystem);
  const { data: policies } = useAppControlPolicies();
  const addRule = useAddAppControlRule();
  const toast = useToast();

  const q = search.trim().toLowerCase();
  const apps = (data?.applications ?? []).filter(
    (a) =>
      !q ||
      a.name.toLowerCase().includes(q) ||
      (a.publisher ?? "").toLowerCase().includes(q),
  );
  const paged = usePagedList(apps, 25);
  const allowlists = (policies ?? []).filter((p) => p.mode === "ALLOWLIST");
  const blockLists = (policies ?? []).filter((p) => p.mode !== "ALLOWLIST");
  const keyOf = (a: UndefinedApplication) => `${a.name}|${a.publisher ?? ""}`;

  function allow(
    a: UndefinedApplication,
    policyId: string,
    policyName: string,
  ) {
    addRule.mutate(
      {
        policyId,
        ruleType: "ALLOW_CATALOG",
        value: a.catalogKey!,
        label: a.catalogName,
      },
      {
        onSuccess: () => toast(`${a.catalogName} allowed in ${policyName}.`),
        onError: (err) => toast((err as Error).message),
      },
    );
  }

  function block(
    a: UndefinedApplication,
    policyId: string,
    policyName: string,
  ) {
    addRule.mutate(
      { policyId, ruleType: "PRODUCT", value: a.name, label: a.name },
      {
        onSuccess: () => toast(`${a.name} blocked in ${policyName}.`),
        onError: (err) => toast((err as Error).message),
      },
    );
  }

  return (
    <Card
      flush
      title="Undefined applications"
      hint={
        data
          ? `${pluralize(apps.length, "application")} on ${pluralize(data.endpointCount, "endpoint")}`
          : undefined
      }
    >
      <div className="ep-cb app-stack">
        <p className="app-text app-muted">
          Software installed on your endpoints that no Application control
          policy allows or blocks yet, from each endpoint's software list. Allow
          it in an allowlist, or block it in a block list.
          {data &&
            data.definedCount > 0 &&
            ` ${pluralize(data.definedCount, "application")} already covered by a policy ${data.definedCount === 1 ? "isn't" : "aren't"} shown.`}
        </p>
        <div className="app-actions-row">
          <SearchInput
            placeholder="Search by name or publisher"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Check
            checked={includeSystem}
            onChange={setIncludeSystem}
            label={`Show drivers, runtimes and updates${data && !includeSystem && data.hiddenSystemCount ? ` (${data.hiddenSystemCount} hidden)` : ""}`}
          />
        </div>
      </div>
      {isLoading ? (
        <div className="ep-cb">
          <Skeleton />
        </div>
      ) : isError ? (
        <div className="ep-cb">
          <Alert
            tone="critical"
            title="Couldn't load the software list"
            action={
              <Button size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            }
          >
            {(error as Error).message}
          </Alert>
        </div>
      ) : apps.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={
            q
              ? "No application matches"
              : "Every installed application is covered"
          }
        >
          {q
            ? "Try another name or publisher."
            : "Every application in your endpoints' software lists is allowed or blocked by a policy."}
        </EmptyState>
      ) : (
        <div className="app-table-scroll">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">
                  <span className="app-vh">Show endpoints</span>
                </th>
                <th scope="col">Application</th>
                <th scope="col">Publisher</th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Endpoints
                </th>
                <th scope="col">Common application</th>
                <th scope="col">
                  <span className="app-vh">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {paged.pageItems.map((a) => {
                const key = keyOf(a);
                const open = openKey === key;
                const items = [
                  ...(a.catalogKey
                    ? allowlists.map((p) => ({
                        label: `Allow in ${p.name}`,
                        onSelect: () => allow(a, p.id, p.name),
                      }))
                    : []),
                  ...blockLists.map((p, i) => ({
                    label: `Block in ${p.name}`,
                    dividerBefore:
                      i === 0 && !!a.catalogKey && allowlists.length > 0,
                    onSelect: () => block(a, p.id, p.name),
                  })),
                ];
                return (
                  <Fragment key={key}>
                    <tr>
                      <td className="ep-cb">
                        <IconButton
                          icon={open ? ChevronDown : ChevronRight}
                          label={
                            open
                              ? `Hide endpoints with ${a.name}`
                              : `Show endpoints with ${a.name}`
                          }
                          onClick={() => setOpenKey(open ? null : key)}
                        />
                      </td>
                      <td>
                        <b>{a.name}</b>
                        {a.versions.length > 0 && (
                          <span className="app-row-sub">
                            {a.versions.slice(0, 3).join(", ") +
                              (a.versions.length > 3 ? "…" : "")}
                          </span>
                        )}
                      </td>
                      <td>
                        {a.publisher ?? <span className="app-muted">—</span>}
                      </td>
                      <td className="ep-num" style={{ textAlign: "right" }}>
                        {a.endpointCount}
                      </td>
                      <td>
                        {a.catalogName ? (
                          <Badge tone="neu">{a.catalogName}</Badge>
                        ) : (
                          <span className="app-muted">—</span>
                        )}
                      </td>
                      <td>
                        {items.length > 0 ? (
                          <RowMenu
                            label={`Actions for ${a.name}`}
                            items={items}
                          />
                        ) : (
                          <span
                            className="app-muted"
                            title="Create an allowlist or block list policy first"
                          >
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td
                          colSpan={6}
                          style={{ background: "var(--ep-surface-2)" }}
                        >
                          <div className="app-chips">
                            {a.endpoints.map((e) => (
                              <span key={e.agentId} className="ep-tag">
                                <EndpointLabel
                                  hostname={e.hostname}
                                  agentId={e.agentId}
                                />
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {paged.total > paged.pageSize && (
            <Pagination
              page={paged.page}
              pageSize={paged.pageSize}
              total={paged.total}
              noun="applications"
              onPageChange={paged.setPage}
            />
          )}
        </div>
      )}
    </Card>
  );
}
