import { useEffect, useState, type FormEvent } from "react";
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
import type { PiiEmailBlockPolicyDetail } from "../api/types";
import StatusBadge from "../components/StatusBadge";

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

  return (
    <div className="panel">
      <h2>Blocked PII categories ({policy.rules.length})</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Regulations</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {policy.rules.map((r) => {
            const def = PII_PATTERN_OPTIONS.find((p) => p.key === r.value);
            return (
              <tr key={r.id}>
                <td>{def?.label ?? r.value}</td>
                <td>{def?.regulations.join(", ") ?? "—"}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => deleteRule.mutate({ policyId: policy.id, ruleId: r.id })}
                    disabled={deleteRule.isPending}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
          {policy.rules.length === 0 && (
            <tr>
              <td colSpan={3}>No PII categories yet — add one below. A policy with no categories never blocks anything.</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="card accent-orange">
        <h3>Add PII category</h3>
        {availablePatterns.length > 0 ? (
          <form onSubmit={handleAdd}>
            <label>
              Category
              <select value={selectedKey} onChange={(e) => setSelectedKey(e.target.value as PiiPatternKey)}>
                {availablePatterns.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label} ({p.regulations.join("/")})
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              Any attachment containing this category triggers the block/warning — matched client-side inside the
              Outlook add-in, before the message leaves the mail client.
            </p>
            {addRule.isError && <p className="error-text">{(addRule.error as Error).message}</p>}
            <button type="submit" disabled={addRule.isPending || !selectedKey}>
              {addRule.isPending ? "Adding…" : "Add category"}
            </button>
          </form>
        ) : (
          <p>Every PII category is already covered by this policy.</p>
        )}
      </div>
    </div>
  );
}

function PolicySettingsPanel({ policy }: { policy: PiiEmailBlockPolicyDetail }) {
  const updatePolicy = useUpdatePiiEmailBlockPolicy();
  const [name, setName] = useState(policy.name);
  const [description, setDescription] = useState(policy.description ?? "");

  useEffect(() => {
    setName(policy.name);
    setDescription(policy.description ?? "");
  }, [policy.id, policy.name, policy.description]);

  function handleSave(e: FormEvent) {
    e.preventDefault();
    updatePolicy.mutate({ id: policy.id, name, description: description.trim() || null });
  }

  return (
    <form className="card accent-blue" onSubmit={handleSave}>
      <h2>Policy settings</h2>
      <label>
        Name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Description
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {updatePolicy.isError && <p className="error-text">{(updatePolicy.error as Error).message}</p>}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <button type="submit" disabled={updatePolicy.isPending || !name.trim()}>
          {updatePolicy.isPending ? "Saving…" : "Save policy"}
        </button>
        {updatePolicy.isSuccess && <span style={{ color: "var(--online)", fontSize: "0.85rem" }}>Saved</span>}
      </div>
    </form>
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

  function handleAssign(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const emailAddresses = splitEmailAddresses(emailsText);
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
    <div className="panel">
      <h2>Assignment</h2>

      <h3>Currently assigned</h3>
      <ul>
        {assignments?.map((a) => (
          <li key={a.id}>
            {a.emailAddress}{" "}
            <button type="button" onClick={() => unassign.mutate({ policyId, assignmentId: a.id })} disabled={unassign.isPending}>
              Remove
            </button>
          </li>
        ))}
        {assignments?.length === 0 && <li>Not assigned to any mailbox yet.</li>}
      </ul>

      <h3>Assign to</h3>
      <form onSubmit={handleAssign}>
        <label>
          Email address(es) — one per line, or comma/semicolon-separated
          <textarea
            rows={3}
            value={emailsText}
            onChange={(e) => setEmailsText(e.target.value)}
            placeholder={"jane.doe@company.com\njohn.smith@company.com"}
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" disabled={assign.isPending || splitEmailAddresses(emailsText).length === 0}>
          {assign.isPending ? "Assigning…" : "Assign"}
        </button>
      </form>
    </div>
  );
}

function EventsPanel({ policyId }: { policyId: string }) {
  const { data: events } = usePiiEmailBlockEvents(policyId);
  const blockedCount = events?.filter((e) => e.action === "BLOCKED").length ?? 0;

  return (
    <div className="panel">
      <h2>Recent activity</h2>
      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
        Reported by the Outlook add-in after every send it evaluated for a mailbox assigned to this policy — the
        matched category names only, never the attachment content itself, since scanning happens entirely inside
        Outlook and content never reaches this server.
      </p>

      <div className="tiles">
        <div className="tile">
          <div className="tile-label">Evaluated sends</div>
          <div className="tile-value">{events?.length ?? 0}</div>
        </div>
        <div className="tile accent-critical">
          <div className="tile-label">Blocked</div>
          <div className="tile-value">{blockedCount}</div>
        </div>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Sender</th>
            <th>Attachment</th>
            <th>Matched categories</th>
            <th>Action</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {events?.map((e) => (
            <tr key={e.id}>
              <td>{e.senderEmail}</td>
              <td>{e.attachmentName}</td>
              <td>{e.matchedCategoryLabels.join(", ") || "—"}</td>
              <td>
                {e.action === "BLOCKED" ? (
                  <StatusBadge kind="fail" label="Blocked" />
                ) : (
                  <StatusBadge kind="warn" label="Allowed (warned)" />
                )}
              </td>
              <td>{new Date(e.occurredAt).toLocaleString()}</td>
            </tr>
          ))}
          {events?.length === 0 && (
            <tr>
              <td colSpan={5}>No sends evaluated yet for this policy.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function EmailAttachmentBlockPage() {
  const { data: policies } = usePiiEmailBlockPolicies();
  const createPolicy = useCreatePiiEmailBlockPolicy();
  const updatePolicy = useUpdatePiiEmailBlockPolicy();
  const deletePolicy = useDeletePiiEmailBlockPolicy();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const { data: policy } = usePiiEmailBlockPolicy(selectedId);

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createPolicy.mutate(
      { name, description: description.trim() || null },
      {
        onSuccess: (result) => {
          setSelectedId(result.id);
          setName("");
          setDescription("");
        },
      },
    );
  }

  function toggleEnabled(id: string, enabled: boolean) {
    updatePolicy.mutate({ id, enabled });
  }

  function handleDelete(id: string) {
    deletePolicy.mutate(id, {
      onSuccess: () => {
        if (selectedId === id) setSelectedId(undefined);
      },
    });
  }

  return (
    <div>
      <h2>Email Attachment Blocking</h2>
      <p>
        Blocks (or warns on) an outgoing email in Outlook — desktop, web, and mobile — when an attachment contains a
        selected category of personal data. Unlike Content &amp; File Policies (and every endpoint-based policy
        module in this product), this one targets individual mailboxes by email address rather than enrolled
        endpoints or groups, since a mailbox has no endpoint agent of its own — scanning happens entirely inside a
        Microsoft 365 add-in installed on the mailbox, not on any managed device.
      </p>
      <p className="hint">
        Setup required once per organization: an admin registers the add-in in the Microsoft 365 admin center
        ("Integrated Apps") so it deploys to Outlook automatically — see <code>docs/email-attachment-blocking.md</code>{" "}
        for the exact steps and the add-in files to upload. Nothing here takes effect until that's done.
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: "3rem" }}>Enabled</th>
            <th>Name</th>
            <th>Categories</th>
            <th>Assigned mailboxes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {policies?.map((p) => (
            <tr key={p.id} className="clickable-row" onClick={() => setSelectedId(p.id)}>
              <td onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onChange={(e) => toggleEnabled(p.id, e.target.checked)}
                  title="Enabled — a disabled policy's categories never apply to any mailbox"
                />
              </td>
              <td>{p.name}</td>
              <td>{p.ruleCount}</td>
              <td>{p.assignedEmailCount}</td>
              <td>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(p.id);
                  }}
                  disabled={deletePolicy.isPending}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {policies?.length === 0 && (
            <tr>
              <td colSpan={5}>No policies yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      <form className="panel" onSubmit={handleCreate}>
        <h2>New policy</h2>
        <label>
          Name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Description
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {createPolicy.isError && <p className="error-text">{(createPolicy.error as Error).message}</p>}
        <button type="submit" disabled={createPolicy.isPending || !name.trim()}>
          {createPolicy.isPending ? "Creating…" : "Create policy"}
        </button>
      </form>

      {policy && (
        <>
          <PolicySettingsPanel policy={policy} />
          <RulesPanel policy={policy} />
          <AssignmentPanel policyId={policy.id} />
          <EventsPanel policyId={policy.id} />
        </>
      )}
    </div>
  );
}
