import { useEffect, useState, type FormEvent } from "react";
import { useAgents, useConsentNotice, useMe, useSaveConsentNotice } from "../api/hooks";
import type { ConsentNoticeView } from "../api/types";
import { Alert, Button, Card, Field, FormFooter, Kpi, KpiStrip, PageHeader, Skeleton, Switch } from "../components/ui";
import { formatDateTime } from "../format";

// Endpoint user consent (DPDP): the notice each Windows user sees in the Endpoint IQ tray app, and
// whether it's asked. Until every user signed in to an endpoint agrees, the endpoint sends no
// monitoring data (inventory, usage, screen captures, DLP, AI Guard...) - only its check-ins - and
// keeps applying security policies.
export default function UserConsentPage() {
  const { data, isLoading, error } = useConsentNotice();
  return (
    <>
      <PageHeader
        title="User Consent"
        description="Under the Digital Personal Data Protection Act, 2023, ask each Windows user to agree before their data is collected. The Endpoint IQ tray app shows this notice at sign-in; until every signed-in user agrees, the endpoint sends only its check-ins and keeps applying security policies."
      />
      {error ? (
        <Alert tone="critical">{(error as Error).message}</Alert>
      ) : isLoading || !data ? (
        <Skeleton lines={8} />
      ) : (
        <>
          <ConsentSummary />
          <NoticeForm key={`${data.version}-${data.required}`} notice={data} />
        </>
      )}
    </>
  );
}

function ConsentSummary() {
  const { data: agents } = useAgents();
  const asked = (agents ?? []).filter((a) => a.consent?.state);
  if (asked.length === 0) return null;
  const count = (f: (a: (typeof asked)[number]) => boolean) => asked.filter(f).length;
  return (
    <>
    <KpiStrip>
      <Kpi label="Active (all users agreed)" value={count((a) => a.consent!.state === "ACTIVE" && !a.consent!.needsAgentUpdate)} />
      <Kpi label="Consent pending" value={count((a) => a.consent!.state === "PENDING" && !a.consent!.needsAgentUpdate)} />
      <Kpi label="Inactive (declined)" value={count((a) => a.consent!.state === "DECLINED" && !a.consent!.needsAgentUpdate)} />
      <Kpi label="Agent update needed" value={count((a) => a.consent!.needsAgentUpdate)} />
    </KpiStrip>
    </>
  );
}

function NoticeForm({ notice }: { notice: ConsentNoticeView }) {
  const { data: me } = useMe();
  const canEdit = me?.role === "SUPER_ADMIN";
  const save = useSaveConsentNotice();
  const [required, setRequired] = useState(notice.required);
  const [title, setTitle] = useState(notice.title);
  const [body, setBody] = useState(notice.body);
  const [contact, setContact] = useState(notice.grievanceContact);
  const [saved, setSaved] = useState(false);
  useEffect(() => setSaved(false), [required, title, body, contact]);

  const textChanged = title.trim() !== notice.title || body.trim() !== notice.body || contact.trim() !== notice.grievanceContact;
  const dirty = textChanged || required !== notice.required || !notice.saved;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ required, title: title.trim(), body: body.trim(), grievanceContact: contact.trim() }, { onSuccess: () => setSaved(true) });
  }

  return (
    <Card title="Consent Notice" hint={notice.saved ? `Version ${notice.version}${notice.updatedAt ? ` · saved ${formatDateTime(notice.updatedAt)}` : ""}` : "Not saved yet"}>
      <form onSubmit={handleSubmit} className="app-stack">
        {!notice.saved && (
          <Alert tone="info" title="Review the starting text">
            This is a starting text. Check it with your legal or HR team, complete it for your organisation, add the grievance contact
            and save it. Nothing is shown to users until you switch on Ask endpoint users for consent and save.
          </Alert>
        )}
        <Switch
          checked={required}
          onChange={setRequired}
          disabled={!canEdit}
          label="Ask endpoint users for consent"
          title="When on, each Windows user is asked in the tray app; endpoints send monitoring data only once every signed-in user has agreed"
        />
        <Field label="Title" htmlFor="consent-title" required>
          <input id="consent-title" className="ep-input" value={title} maxLength={200} disabled={!canEdit} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Notice" htmlFor="consent-body" required help="What data is collected, why, how it's handled, and the user's rights. Plain text; blank lines separate paragraphs.">
          <textarea id="consent-body" className="ep-textarea" rows={18} value={body} maxLength={20000} disabled={!canEdit} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <Field
          label="Grievance contact"
          htmlFor="consent-contact"
          required={required}
          help="The person users contact about their data (your grievance officer or data protection officer): name, email and phone. Shown under the notice."
        >
          <input id="consent-contact" className="ep-input" value={contact} maxLength={500} disabled={!canEdit} onChange={(e) => setContact(e.target.value)} />
        </Field>
        {notice.saved && textChanged && (
          <Alert tone="warn">Saving a changed title, notice or grievance contact makes version {notice.version + 1}: every user is asked again, and endpoints show Consent pending until they answer.</Alert>
        )}
        {!canEdit && <Alert tone="info">Only super admins can change the consent notice.</Alert>}
        {!!save.error && <Alert tone="critical">{(save.error as Error).message}</Alert>}
        {canEdit && (
          <FormFooter>
            {saved && !save.isPending && <span className="app-saved">Saved</span>}
            <Button variant="primary" type="submit" disabled={save.isPending || !dirty || !title.trim() || !body.trim()}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </FormFooter>
        )}
      </form>
    </Card>
  );
}
