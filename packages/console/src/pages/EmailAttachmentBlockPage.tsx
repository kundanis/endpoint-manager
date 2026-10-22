import { useEffect, useState, type FormEvent } from "react";
import { Inbox, ListChecks, MailX, Pencil, Plus, Trash2, X } from "lucide-react";
import type { PiiPatternKey } from "@em/shared";
import {
  useAddPiiEmailBlockRule,
  useAssignPiiEmailBlock,
  useCreatePiiEmailBlockPolicy,
  useDeletePiiEmailBlockPolicy,
  useDeletePiiEmailBlockRule,
  usePiiEmailBlockAssignments,
  usePiiEmailBlockEvents,
  usePiiEmailBlockPolicies,
  usePiiEmailBlockPolicy,
  useUnassignPiiEmailBlock,
  useUpdatePiiEmailBlockPolicy,
} from "../api/hooks";
import AddFromDataTypes from "../components/AddFromDataTypes";
import type { PiiEmailBlockPolicyDetail } from "../api/types";
import { NewPolicyDialog, PolicyDetail, PolicySettingsForm, SectionHeader } from "../components/policy";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Kpi,
  KpiStrip,
  Pagination,
  RowMenu,
  Skeleton,
  Switch,
  Tag,
  useConfirm,
  usePagedList,
} from "../components/ui";
import { formatDateTime } from "../format";

// Policy page template (EPM / DLP): section header → policy list → selected policy's tabs.
// Unlike the endpoint-based policy pages, assignments here are mailboxes (email addresses),
// so this page keeps its own assignment editor styled like the shared AssignmentEditor.

// Display-only copy of the built-in identifier catalog (packages/shared/src/data/
// piiPatterns.ts) — duplicated here rather than importing the runtime array from
// @em/shared, since Vite/Rollup can't statically resolve a named re-export from that
// package's compiled CJS output (same reason DlpPage.tsx/PiiBlockPage.tsx keep their own copy).
const PII_PATTERN_OPTIONS: { key: PiiPatternKey; label: string; regulations: string[] }[] = [
  { key: "EMAIL", label: "Email address", regulations: ["DPDP", "GDPR"] },
  { key: "PHONE_INDIA", label: "Indian mobile number", regulations: ["DPDP"] },
  { key: "PHONE_GENERIC", label: "International phone number", regulations: ["GDPR"] },
  { key: "CREDIT_CARD", label: "Credit/debit card number", regulations: ["DPDP", "GDPR"] },
  { key: "IP_ADDRESS", label: "IP address", regulations: ["GDPR"] },
  { key: "IBAN", label: "IBAN (bank account)", regulations: ["GDPR"] },
  { key: "AADHAAR", label: "Aadhaar number", regulations: ["DPDP"] },
  { key: "PAN_INDIA", label: "PAN (Permanent Account Number)", regulations: ["DPDP"] },
  { key: "PASSPORT_INDIA", label: "Indian passport number", regulations: ["DPDP"] },
  { key: "GSTIN", label: "GSTIN (GST Identification Number)", regulations: ["DPDP"] },
  { key: "IFSC_CODE", label: "IFSC code (bank branch)", regulations: ["DPDP"] },
];

function RulesPanel({ policy }: { policy: PiiEmailBlockPolicyDetail }) {
  const addRule = useAddPiiEmailBlockRule();
  const deleteRule = useDeletePiiEmailBlockRule();
  const confirm = useConfirm();

  const usedKeys = new Set(policy.rules.map((r) => r.value));
  const availablePatterns = PII_PATTERN_OPTIONS.filter((p) => !usedKeys.has(p.key));
  const [selectedKey, setSelectedKey] = useState<PiiPatternKey | "">(availablePatterns[0]?.key ?? "");

  useEffect(() => {
    if (!availablePatterns.some((p) => p.key === selectedKey)) {
      setSelectedKey(availablePatterns[0]?.key ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy.rules.length]);

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!selectedKey) return;
    addRule.mutate({ policyId: policy.id, ruleType: "PII_PATTERN", value: selectedKey });
  }

  async function handleDeleteRule(ruleId: string, label: string) {
    const confirmed = await confirm({
      title: `Remove "${label}"?`,
      body: "Attachments containing this category stop triggering the block/warning for this policy's mailboxes.",
      confirmLabel: "Remove category",
      tone: "danger",
    });
    if (!confirmed) return;
    deleteRule.mutate({ policyId: policy.id, ruleId });
  }

  return (
    <div className="app-stack">
      <AddFromDataTypes target="piiEmailBlock" policyId={policy.id} />
      {policy.rules.length === 0 ? (
        <EmptyState icon={ListChecks} title="No PII categories yet">
          Add one below. A policy with no categories never blocks anything.
        </EmptyState>
      ) : (
        <div className="app-table-wrap">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Regulations</th>
                <th scope="col">
                  <span className="app-vh">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {policy.rules.map((r) => {
                const def = PII_PATTERN_OPTIONS.find((p) => p.key === r.value);
                const label = def?.label ?? r.value;
                return (
                  <tr key={r.id}>
                    <td>{label}</td>
                    <td>
                      {def ? (
                        <div className="app-badge-row">
                          {def.regulations.map((reg) => (
                            <Tag key={reg}>{reg}</Tag>
                          ))}
                        </div>
                      ) : (
                        <span className="app-muted">—</span>
                      )}
                    </td>
                    <td>
                      <div className="app-cell-actions">
                        <IconButton
                          icon={Trash2}
                          label={`Delete ${label}`}
                          onClick={() => handleDeleteRule(r.id, label)}
                          disabled={deleteRule.isPending}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="app-inset-form">
        <span className="app-subhead">Add PII category</span>
        {availablePatterns.length > 0 ? (
          <form onSubmit={handleAdd} className="app-stack-sm">
            <Field
              label="Category"
              htmlFor="email-rule-category"
              help="Any attachment containing this category triggers the block/warning — matched client-side inside the Outlook add-in, before the message leaves the mail client."
            >
              <select
                id="email-rule-category"
                className="ep-select"
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value as PiiPatternKey)}
              >
                {availablePatterns.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label} ({p.regulations.join("/")})
                  </option>
                ))}
              </select>
            </Field>
            {addRule.isError && <Alert tone="critical">{(addRule.error as Error).message}</Alert>}
            <div className="app-actions-row app-end">
              <Button type="submit" variant="primary" disabled={addRule.isPending || !selectedKey}>
                {addRule.isPending ? "Adding…" : "Add category"}
              </Button>
            </div>
          </form>
        ) : (
          <p className="app-muted">Every PII category is already covered by this policy.</p>
        )}
      </div>
    </div>
  );
}

function SettingsPanel({ policy }: { policy: PiiEmailBlockPolicyDetail }) {
  const updatePolicy = useUpdatePiiEmailBlockPolicy();
  return (
    <PolicySettingsForm
      policyId={policy.id}
      name={policy.name}
      description={policy.description}
      onSave={(values) => updatePolicy.mutate({ id: policy.id, ...values })}
      pending={updatePolicy.isPending}
      error={updatePolicy.error}
      saved={updatePolicy.isSuccess}
    />
  );
}

// Splits on comma, semicolon, or newline so a whole list of addresses can be pasted in at
// once — same idea as WebBlockPage's splitBulkValues for domains.
function splitEmailAddresses(raw: string): string[] {
  return [...new Set(raw.split(/[;,\n]/).map((v) => v.trim().toLowerCase()).filter(Boolean))];
}

function AssignmentPanel({ policyId }: { policyId: string }) {
  const { data: assignments } = usePiiEmailBlockAssignments(policyId);
  const assign = useAssignPiiEmailBlock();
  const unassign = useUnassignPiiEmailBlock();

  const [emailsText, setEmailsText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Mailboxes already in "Currently assigned" are skipped, not added twice.
  const assignedEmails = new Set((assignments ?? []).map((a) => a.emailAddress.toLowerCase()));
  const typed = splitEmailAddresses(emailsText);
  const newEmails = typed.filter((addr) => !assignedEmails.has(addr));
  const alreadyAssigned = typed.length - newEmails.length;

  function handleAssign(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const emailAddresses = newEmails;
    if (emailAddresses.length === 0) return;
    assign.mutate(
      { policyId, emailAddresses },
      {
        onSuccess: () => setEmailsText(""),
        onError: (err) => setError((err as Error).message),
      },
    );
  }

  return (
    <div className="app-stack">
      <div className="app-stack-sm">
        <span className="app-subhead">Currently assigned</span>
        {assignments && assignments.length === 0 ? (
          <EmptyState icon={Inbox} title="Not assigned to any mailbox yet">
            Add email addresses below. A policy does nothing until it's assigned.
          </EmptyState>
        ) : (
          <div className="app-table-wrap">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Mailbox</th>
                  <th scope="col">
                    <span className="app-vh">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {assignments?.map((a) => (
                  <tr key={a.id}>
                    <td className="ep-mono">{a.emailAddress}</td>
                    <td>
                      <div className="app-cell-actions">
                        <IconButton
                          icon={X}
                          label={`Remove ${a.emailAddress}`}
                          onClick={() => unassign.mutate({ policyId, assignmentId: a.id })}
                          disabled={unassign.isPending}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <form onSubmit={handleAssign} className="app-stack-sm">
        <span className="app-subhead">Assign to</span>
        <Field label="Email addresses" htmlFor={`email-assign-${policyId}`} help="One per line, or comma/semicolon-separated.">
          <textarea
            id={`email-assign-${policyId}`}
            className="ep-textarea ep-mono"
            rows={3}
            value={emailsText}
            onChange={(e) => setEmailsText(e.target.value)}
            placeholder={"jane.doe@company.com\njohn.smith@company.com"}
          />
        </Field>
        {alreadyAssigned > 0 && (
          <p className="app-text app-muted">
            {alreadyAssigned} {alreadyAssigned === 1 ? "address is" : "addresses are"} already assigned and will be skipped.
          </p>
        )}
        {error && <Alert tone="critical">{error}</Alert>}
        <div className="app-actions-row app-end">
          <Button type="submit" variant="primary" disabled={assign.isPending || newEmails.length === 0}>
            {assign.isPending ? "Assigning…" : "Assign"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function EventsPanel({ policyId }: { policyId: string }) {
  const { data: events, isLoading } = usePiiEmailBlockEvents(policyId);
  const blockedCount = events?.filter((e) => e.action === "BLOCKED").length ?? 0;
  const paged = usePagedList(events ?? [], 25);

  return (
    <div className="app-stack">
      <p className="app-text">
        Reported by the Outlook add-in after every send it evaluated for a mailbox assigned to this policy — the
        matched category names only, never the attachment content itself, since scanning happens entirely inside
        Outlook and content never reaches this server.
      </p>

      <KpiStrip>
        <Kpi label="Evaluated sends" value={<span className="ep-num">{events?.length ?? 0}</span>} />
        <Kpi label="Blocked" value={<span className="ep-num">{blockedCount}</span>} valueTone={blockedCount > 0 ? "critical" : undefined} />
      </KpiStrip>

      {isLoading ? (
        <Skeleton />
      ) : !events || events.length === 0 ? (
        <EmptyState icon={MailX} title="No sends evaluated yet for this policy">
          Assign mailboxes on the Assignment tab; sends they make with attachments show up here.
        </EmptyState>
      ) : (
        <div className="app-table-wrap">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">Sender</th>
                <th scope="col">Attachment</th>
                <th scope="col">Matched categories</th>
                <th scope="col">Action</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {paged.pageItems.map((e) => (
                <tr key={e.id}>
                  <td className="ep-mono">{e.senderEmail}</td>
                  <td className="ep-mono">{e.attachmentName}</td>
                  <td>
                    {e.matchedCategoryLabels.length > 0 ? (
                      <div className="app-badge-row">
                        {e.matchedCategoryLabels.map((label) => (
                          <Tag key={label}>{label}</Tag>
                        ))}
                      </div>
                    ) : (
                      <span className="app-muted">—</span>
                    )}
                  </td>
                  <td>{e.action === "BLOCKED" ? <Badge tone="crit">Blocked</Badge> : <Badge tone="med">Allowed (warned)</Badge>}</td>
                  <td className="app-muted">{formatDateTime(e.occurredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {paged.total > paged.pageSize && (
            <Pagination
              page={paged.page}
              pageSize={paged.pageSize}
              total={paged.total}
              noun="sends"
              onPageChange={paged.setPage}
              onPageSizeChange={paged.setPageSize}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function EmailAttachmentBlockPage() {
  const { data: policies, isLoading, error, refetch } = usePiiEmailBlockPolicies();
  const createPolicy = useCreatePiiEmailBlockPolicy();
  const updatePolicy = useUpdatePiiEmailBlockPolicy();
  const deletePolicy = useDeletePiiEmailBlockPolicy();
  const confirm = useConfirm();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);

  const { data: policy } = usePiiEmailBlockPolicy(selectedId);

  function toggleEnabled(id: string, enabled: boolean) {
    updatePolicy.mutate({ id, enabled });
  }

  async function handleDelete(id: string, name: string) {
    const confirmed = await confirm({
      title: `Delete policy "${name}"?`,
      body: "Its categories stop applying to every assigned mailbox. This cannot be undone.",
      confirmLabel: "Delete policy",
      tone: "danger",
    });
    if (!confirmed) return;
    deletePolicy.mutate(id, {
      onSuccess: () => {
        if (selectedId === id) setSelectedId(undefined);
      },
    });
  }

  return (
    <>
      <SectionHeader
        title="Email attachment blocking"
        description="Blocks (or warns on) an outgoing email in Outlook — desktop, web, and mobile — when an attachment contains a selected category of personal data. Unlike Content & File Policies (and every endpoint-based policy module in this product), this one targets individual mailboxes by email address rather than enrolled endpoints or groups, since a mailbox has no endpoint agent of its own — scanning happens entirely inside a Microsoft 365 add-in installed on the mailbox, not on any managed device."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New policy
          </Button>
        }
      />

      <Alert tone="info" title="Setup required once per organization">
        An admin registers the add-in in the Microsoft 365 admin center ("Integrated Apps") so it deploys to Outlook
        automatically — see <code className="ep-mono">docs/email-attachment-blocking.md</code> for the exact steps and
        the add-in files to upload. Nothing here takes effect until that's done.
      </Alert>

      <Card flush title="Policies" hint={policies ? `${policies.length} total` : undefined}>
        {isLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : error ? (
          <div className="ep-cb">
            <Alert
              tone="critical"
              title="Couldn't load policies"
              action={
                <Button size="sm" onClick={() => refetch()}>
                  Retry
                </Button>
              }
            >
              {(error as Error).message}
            </Alert>
          </div>
        ) : !policies || policies.length === 0 ? (
          <EmptyState
            icon={MailX}
            title="No email attachment policies yet"
            action={
              <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
                New policy
              </Button>
            }
          >
            Create a policy, choose the PII categories to block, then assign it to mailboxes.
          </EmptyState>
        ) : (
          <div className="app-table-scroll">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Policy</th>
                  <th scope="col">Status</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Categories
                  </th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Assigned mailboxes
                  </th>
                  <th scope="col">
                    <span className="app-vh">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr key={p.id} className={`app-clickable ${p.id === selectedId ? "ep-sel" : ""}`} onClick={() => setSelectedId(p.id)}>
                    <td className="ep-host">
                      <b>{p.name}</b>
                      {p.description && <span className="app-row-sub">{p.description}</span>}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <span title="Enabled — a disabled policy's categories never apply to any mailbox">
                        <Switch
                          checked={p.enabled}
                          onChange={(enabled) => toggleEnabled(p.id, enabled)}
                          label={p.enabled ? "Enabled" : "Paused"}
                        />
                      </span>
                    </td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {p.ruleCount}
                    </td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {p.assignedEmailCount}
                    </td>
                    <td>
                      <div className="app-cell-actions">
                        <RowMenu
                          label={`Actions for ${p.name}`}
                          items={[
                            { label: "Open policy", icon: Pencil, onSelect: () => setSelectedId(p.id) },
                            {
                              label: "Delete policy",
                              icon: Trash2,
                              danger: true,
                              dividerBefore: true,
                              disabled: deletePolicy.isPending,
                              onSelect: () => handleDelete(p.id, p.name),
                            },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {policy && (
        <PolicyDetail
          policyId={policy.id}
          name={policy.name}
          enabled={policy.enabled}
          meta={`${policy.rules.length} ${policy.rules.length === 1 ? "category" : "categories"}`}
          onClose={() => setSelectedId(undefined)}
          tabs={[
            { value: "rules", label: "Blocked categories", content: <RulesPanel policy={policy} /> },
            { value: "assignment", label: "Assignment", content: <AssignmentPanel policyId={policy.id} /> },
            { value: "activity", label: "Recent activity", content: <EventsPanel policyId={policy.id} /> },
            { value: "settings", label: "Settings", content: <SettingsPanel policy={policy} /> },
          ]}
        />
      )}

      {creating && (
        <NewPolicyDialog
          onClose={() => setCreating(false)}
          pending={createPolicy.isPending}
          error={createPolicy.error}
          onCreate={(values) => createPolicy.mutateAsync(values).then((result) => setSelectedId(result.id))}
        />
      )}
    </>
  );
}
