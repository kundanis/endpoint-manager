import { Check as CheckIcon, RefreshCw, X } from "lucide-react";
import type { LicenseChangeNoticeView, LicenseTermsView } from "../api/types";
import { useAcceptLicenseChange, useCheckLicenseChanges, useLicenseChangeNotices, useRejectLicenseChange } from "../api/hooks";
import { LICENSE_MODULE_LABELS } from "../navConfig";
import { Alert, Badge, Button, Card, EmptyState, Pill, useConfirm, usePrompt, useToast } from "./ui";
import { formatDate, formatDateTime } from "../format";
// From source (see licenseFeatures.tsx): featureCatalog.ts has no runtime dependencies.
import { featureChanges, licenseFeature } from "../../../license-shared/src/featureCatalog";

// Licence change requests the License Server sent (see the server's licenseChange.service.ts):
// what is asked, what changes on this deployment, and Accept / Reject for a super admin.
// Additions apply only when accepted; a reduction applies by itself at its deadline.

const label = (m: string) => LICENSE_MODULE_LABELS[m as keyof typeof LICENSE_MODULE_LABELS] ?? m;
const until = (iso: string | null) => (iso ? formatDate(iso) : "no end date (perpetual)");

interface Change {
  what: string;
  impact: string;
  reduces: boolean;
}

// One line per change, each with what it means for this deployment. With licence enforcement
// off, module and endpoint limits aren't enforced here, so the impact says so.
function describeChanges(cur: LicenseTermsView, next: LicenseTermsView, enforced: boolean, enrolled: number): Change[] {
  const out: Change[] = [];
  for (const m of next.modules.filter((x) => !cur.modules.includes(x))) {
    out.push({
      what: `Add module: ${label(m)}`,
      impact: enforced
        ? `${label(m)} becomes available in the menu and can be given to administrators. Nothing else changes.`
        : `${label(m)} is added to your licence. This server doesn't enforce licence modules, so the menu doesn't change.`,
      reduces: false,
    });
  }
  for (const m of cur.modules.filter((x) => !next.modules.includes(x))) {
    out.push({
      what: `Remove module: ${label(m)}`,
      impact: enforced
        ? `${label(m)} is hidden from every administrator and its policies stop applying on endpoints. Its data is kept, and everything comes back if it's licensed again.`
        : `${label(m)} is removed from your licence. This server doesn't enforce licence modules, so the menu doesn't change.`,
      reduces: true,
    });
  }
  // Features within modules that stay (a module added or removed is described above).
  const both = (k: string) => {
    const m = licenseFeature(k)?.module;
    return !!m && cur.modules.includes(m) && next.modules.includes(m);
  };
  const { added, removed } = featureChanges(cur, next);
  for (const k of added.filter(both)) {
    out.push({
      what: `Add feature: ${label(licenseFeature(k)!.module)} › ${licenseFeature(k)!.label}`,
      impact: enforced
        ? `${licenseFeature(k)!.label} unlocks: it can be opened and its policies apply on endpoints.`
        : `${licenseFeature(k)!.label} is added to your licence. This server doesn't enforce licence features, so nothing changes.`,
      reduces: false,
    });
  }
  for (const k of removed.filter(both)) {
    out.push({
      what: `Remove feature: ${label(licenseFeature(k)!.module)} › ${licenseFeature(k)!.label}`,
      impact: enforced
        ? `${licenseFeature(k)!.label} is locked: nobody can open or change it, and its policies stop applying on endpoints. Its data is kept, and it comes back if it's licensed again.`
        : `${licenseFeature(k)!.label} is removed from your licence. This server doesn't enforce licence features, so nothing changes.`,
      reduces: true,
    });
  }
  if (next.maxAgents !== cur.maxAgents) {
    const more = next.maxAgents > cur.maxAgents;
    out.push({
      what: `Endpoints: ${cur.maxAgents} → ${next.maxAgents}`,
      impact: more
        ? `Up to ${next.maxAgents} endpoints can be enrolled (${enrolled} enrolled now).`
        : next.maxAgents < enrolled
          ? `${enrolled} endpoints are enrolled, more than the new limit of ${next.maxAgents}. They keep working, but ${enforced ? "no new endpoint can enroll" : "the licence is exceeded"} until some are removed.`
          : `The limit drops to ${next.maxAgents} (${enrolled} enrolled now, so nothing stops working).`,
      reduces: !more,
    });
  }
  const a = cur.validUntil ? Date.parse(cur.validUntil) : Infinity;
  const b = next.validUntil ? Date.parse(next.validUntil) : Infinity;
  if (a !== b) {
    out.push({
      what: `Valid until: ${until(cur.validUntil)} → ${until(next.validUntil)}`,
      impact:
        b > a
          ? `The licence stays valid until ${until(next.validUntil)}.`
          : `The licence ends on ${until(next.validUntil)}${enforced ? "; after that, new endpoints can't enroll and licensed modules lock" : ""}.`,
      reduces: b < a,
    });
  }
  return out;
}

const STATUS: Record<LicenseChangeNoticeView["status"], { text: string; tone: "ok" | "neutral" | "warn" | "critical" }> = {
  PENDING: { text: "Waiting for your answer", tone: "warn" },
  ACCEPTED: { text: "Accepted", tone: "ok" },
  REJECTED: { text: "Rejected", tone: "neutral" },
  AUTO_APPLIED: { text: "Applied automatically", tone: "neutral" },
  CANCELLED: { text: "Withdrawn by the vendor", tone: "neutral" },
  APPLIED: { text: "Applied", tone: "critical" },
};

function daysLeft(iso: string): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));
}

export default function LicenseRequestsPanel({
  isSuperAdmin,
  enforcementEnabled,
  enrolledCount,
}: {
  isSuperAdmin: boolean;
  enforcementEnabled: boolean;
  enrolledCount: number;
}) {
  const { data: notices, isLoading, error } = useLicenseChangeNotices();
  const check = useCheckLicenseChanges();
  const accept = useAcceptLicenseChange();
  const reject = useRejectLicenseChange();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const toast = useToast();

  const open = (notices ?? []).filter((n) => n.canAccept);
  const busy = accept.isPending || reject.isPending;

  async function handleAccept(n: LicenseChangeNoticeView) {
    const changes = n.current && n.proposed ? describeChanges(n.current, n.proposed, enforcementEnabled, enrolledCount) : [];
    const ok = await confirm({
      title: "Accept This Licence Change?",
      body: (
        <ul className="app-stack">
          {changes.map((c) => (
            <li key={c.what}>
              <b>{c.what}.</b> {c.impact}
            </li>
          ))}
        </ul>
      ),
      confirmLabel: "Accept change",
      tone: changes.some((c) => c.reduces) ? "danger" : undefined,
    });
    if (!ok) return;
    accept.mutate(n.id, {
      onSuccess: () => toast("Licence change accepted and applied."),
      onError: (err) => toast(`Couldn't accept: ${(err as Error).message}`),
    });
  }

  async function handleReject(n: LicenseChangeNoticeView) {
    const reason = await prompt({
      title: "Reject This Licence Change?",
      body:
        n.kind === "REDUCTION" && n.autoApplyAt
          ? `Your reason goes back to the vendor. This is a reduction: it still applies automatically on ${formatDate(n.autoApplyAt)} unless the vendor withdraws it.`
          : "Your reason goes back to the vendor. Nothing changes on this server.",
      label: "Reason (optional)",
      confirmLabel: "Reject change",
    });
    if (reason === null) return;
    reject.mutate(
      { id: n.id, reason: reason.trim() || undefined },
      {
        onSuccess: () => toast("Licence change rejected."),
        onError: (err) => toast(`Couldn't reject: ${(err as Error).message}`),
      },
    );
  }

  function handleCheck() {
    check.mutate(undefined, {
      onSuccess: (r) => toast(r.open > 0 ? `${r.open} licence request(s) waiting.` : "No new licence requests."),
      onError: (err) => toast(`Couldn't check: ${(err as Error).message}`),
    });
  }

  return (
    <Card
      title="Licence Requests"
      hint="changes the vendor's License Server sent to this server"
      actions={
        isSuperAdmin && (
          <Button size="sm" icon={RefreshCw} onClick={handleCheck} disabled={check.isPending}>
            {check.isPending ? "Checking…" : "Check for licence requests"}
          </Button>
        )
      }
    >
      <div className="app-stack">
        {open.length > 0 && (
          <Alert tone="warn" title={`The License Server sent ${open.length} licence change request${open.length === 1 ? "" : "s"}`}>
            Nothing changes until {isSuperAdmin ? "you accept" : "a super admin accepts"}, except a reduction, which applies by itself
            on its date.
          </Alert>
        )}
        {error ? (
          <Alert tone="critical">{(error as Error).message}</Alert>
        ) : isLoading ? null : !notices || notices.length === 0 ? (
          <EmptyState icon={RefreshCw} title="No licence requests">
            When the vendor changes your licence, the request appears here for a super admin to accept or reject. If the License
            Server can't reach this server, use Check for licence requests when the vendor tells you one was sent.
          </EmptyState>
        ) : (
          notices.map((n) => {
            if (n.kind === "REVOKE") {
              return (
                <Alert key={n.id} tone="critical" title={`Licence revoked by the vendor on ${formatDateTime(n.requestedAt)}`}>
                  {enforcementEnabled
                    ? "New endpoints can't be enrolled and licensed modules are locked. Endpoints already enrolled keep checking in. Contact the vendor for a new key."
                    : "The licence is no longer valid. This server doesn't enforce licensing, so nothing is locked, but contact the vendor for a new key."}
                </Alert>
              );
            }
            const changes = n.current && n.proposed ? describeChanges(n.current, n.proposed, enforcementEnabled, enrolledCount) : [];
            const st = STATUS[n.status];
            const pendingReduction = n.kind === "REDUCTION" && n.autoApplyAt && !n.appliedAt && (n.status === "PENDING" || n.status === "REJECTED");
            return (
              <div key={n.id} className="ep-card" style={{ padding: 16 }}>
                <div className="app-stack">
                  <div className="app-badge-row">
                    <b>{n.kind === "ADDITION" ? "Licence addition" : "Licence reduction"}</b>
                    <Pill tone={st.tone}>{st.text}</Pill>
                    {n.kind === "REDUCTION" && <Badge tone="high">Reduction</Badge>}
                    <span className="app-muted">Sent {formatDateTime(n.requestedAt)}</span>
                  </div>
                  {n.message && (
                    <div>
                      <span className="app-muted">Message from the vendor: </span>
                      {n.message}
                    </div>
                  )}
                  <ul className="app-stack">
                    {changes.map((c) => (
                      <li key={c.what}>
                        <b>{c.what}</b>
                        <span className="app-row-sub">Impact: {c.impact}</span>
                      </li>
                    ))}
                  </ul>
                  {pendingReduction && (
                    <Alert tone="warn">
                      Applies automatically on {formatDate(n.autoApplyAt!)} ({daysLeft(n.autoApplyAt!)} day
                      {daysLeft(n.autoApplyAt!) === 1 ? "" : "s"} left) unless the vendor withdraws it.
                    </Alert>
                  )}
                  {n.respondedAt && (
                    <span className="app-muted">
                      {n.status === "ACCEPTED" ? "Accepted" : "Rejected"} {formatDateTime(n.respondedAt)}
                      {n.respondedByEmail ? ` by ${n.respondedByEmail}` : ""}
                      {n.responseReason ? ` · Reason: ${n.responseReason}` : ""}
                    </span>
                  )}
                  {isSuperAdmin && (n.canAccept || n.canReject) && (
                    <div className="app-badge-row">
                      {n.canAccept && (
                        <Button variant="primary" size="sm" icon={CheckIcon} disabled={busy} onClick={() => handleAccept(n)}>
                          Accept
                        </Button>
                      )}
                      {n.canReject && (
                        <Button size="sm" icon={X} disabled={busy} onClick={() => handleReject(n)}>
                          Reject
                        </Button>
                      )}
                    </div>
                  )}
                  {!isSuperAdmin && n.canAccept && <span className="app-muted">Only a super admin can accept or reject licence requests.</span>}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
