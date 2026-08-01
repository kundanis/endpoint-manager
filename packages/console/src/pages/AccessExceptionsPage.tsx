import { useState, type FormEvent } from "react";
import {
  useAgents,
  useApprovePolicyAccessException,
  useAppControlPolicies,
  useCommandBlockPolicies,
  useCreatePolicyAccessException,
  useDlpPolicies,
  useIpBlockPolicies,
  usePolicyAccessExceptions,
  useRejectPolicyAccessException,
  useUsbControlPolicies,
  useWebBlockPolicies,
} from "../api/hooks";
import type { PolicyAccessExceptionType } from "@em/shared";
import StatusBadge from "../components/StatusBadge";

const POLICY_TYPE_LABELS: Record<PolicyAccessExceptionType, string> = {
  APP_CONTROL: "Application Control",
  WEB_BLOCK: "Web & Email Blocking",
  COMMAND_BLOCK: "Command Blocking",
  IP_BLOCK: "IP Blocking",
  USB_CONTROL: "USB Device Control",
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

function usePoliciesForType(policyType: PolicyAccessExceptionType) {
  const appControl = useAppControlPolicies();
  const webBlock = useWebBlockPolicies();
  const commandBlock = useCommandBlockPolicies();
  const ipBlock = useIpBlockPolicies();
  const usbControl = useUsbControlPolicies();
  const dlp = useDlpPolicies();

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
  }
}

function RequestForm() {
  const { data: agents } = useAgents();
  const createRequest = useCreatePolicyAccessException();

  const [policyType, setPolicyType] = useState<PolicyAccessExceptionType>("APP_CONTROL");
  const [policyId, setPolicyId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [reason, setReason] = useState("");

  const policies = usePoliciesForType(policyType);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createRequest.mutate(
      { policyType, policyId, agentId, durationMinutes, reason },
      {
        onSuccess: () => {
          setPolicyId("");
          setAgentId("");
          setReason("");
        },
      },
    );
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <h2>New access exception request</h2>
      <p>
        Temporarily carve out one endpoint from one EPM or DLP policy's enforcement, for a fixed window. Nothing
        takes effect until an admin approves it below.
      </p>
      <label>
        Module
        <select
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
      </label>
      <label>
        Policy
        <select value={policyId} onChange={(e) => setPolicyId(e.target.value)} required>
          <option value="">Select a policy…</option>
          {policies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Endpoint
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} required>
          <option value="">Select an endpoint…</option>
          {agents?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.hostname}
            </option>
          ))}
        </select>
      </label>
      <label>
        Duration
        <select value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))}>
          {DURATION_OPTIONS.map((d) => (
            <option key={d.minutes} value={d.minutes}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Reason
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Contractor needs temporary access to a blocked site for a vendor demo"
          required
        />
      </label>
      {createRequest.isError && <p className="error-text">{(createRequest.error as Error).message}</p>}
      <button type="submit" disabled={createRequest.isPending || !policyId || !agentId || !reason.trim()}>
        {createRequest.isPending ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}

export default function AccessExceptionsPage() {
  const { data: requests } = usePolicyAccessExceptions();
  const approve = useApprovePolicyAccessException();
  const reject = useRejectPolicyAccessException();

  return (
    <div>
      <h1>Access Exceptions</h1>
      <p>
        Time-bound, admin-approved carve-outs from an EPM or DLP policy's enforcement for one endpoint — the
        exception filter is applied server-side, so it takes effect the next time that endpoint syncs, and expires
        automatically with no separate revert step.
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <th>Module</th>
            <th>Policy</th>
            <th>Endpoint</th>
            <th>Reason</th>
            <th>Duration</th>
            <th>Status</th>
            <th>Expires</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {requests?.map((r) => (
            <tr key={r.id}>
              <td>{POLICY_TYPE_LABELS[r.policyType]}</td>
              <td>{r.policyName}</td>
              <td>{r.hostname ?? "—"}</td>
              <td>{r.reason}</td>
              <td>{r.durationMinutes} min</td>
              <td>
                {r.status === "PENDING" && <StatusBadge kind="warn" label="Pending" />}
                {r.status === "APPROVED" && (r.isActive ? <StatusBadge kind="pass" label="Active" /> : <StatusBadge kind="lock" label="Expired" />)}
                {r.status === "REJECTED" && <StatusBadge kind="fail" label="Rejected" />}
              </td>
              <td>{r.expiresAt ? new Date(r.expiresAt).toLocaleString() : "—"}</td>
              <td>
                {r.status === "PENDING" && (
                  <>
                    <button type="button" onClick={() => approve.mutate({ id: r.id })} disabled={approve.isPending}>
                      Approve
                    </button>{" "}
                    <button type="button" onClick={() => reject.mutate({ id: r.id })} disabled={reject.isPending}>
                      Reject
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {requests?.length === 0 && (
            <tr>
              <td colSpan={8}>No access exception requests yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      <RequestForm />
    </div>
  );
}
