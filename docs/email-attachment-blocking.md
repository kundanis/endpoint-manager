# Email Attachment Blocking (PII scanning in Outlook)

Blocks an outgoing email in Outlook — desktop, web, and mobile — when an attachment
contains a selected category of personal data (credit card numbers, national IDs, email
addresses, etc.). Manage policies and see block history from **Console → Data Manager →
Email Attachment Blocking**.

## How it works

This is fundamentally different from every other policy module in this product: it has
**no endpoint agent involvement at all**. Instead, it's a small Outlook add-in
(`packages/server/public/outlook-addin/`) that Microsoft 365 loads directly into every
covered mailbox's Outlook client. On every send, the add-in:

1. Fetches which PII categories apply to the signed-in user's own mailbox from this
   server (`GET /api/email-addin/policy?email=...`) — a lightweight policy lookup, not
   attachment content.
2. Reads each attachment's content **entirely inside Outlook's own sandboxed runtime** —
   plain-text formats directly, Office Open XML formats (`.docx`/`.xlsx`/`.pptx`) by
   unzipping them client-side (via JSZip) and reading their text parts. PDFs, legacy
   `.doc`/`.xls`/`.ppt`, images, and cloud-attached (OneDrive/SharePoint link) attachments
   are **not scanned** — see "Known limitations" below.
3. If a match is found, cancels the send and reports the matched category *labels only*
   (never the attachment content or the matched text itself) to
   `POST /api/email-addin/event` for the console's activity log.

**Attachment content never reaches this server or leaves the user's device.** The two
endpoints above are the only network calls involved, and neither carries file content.

## One-time setup (requires a Microsoft 365 Global or Exchange admin — I cannot do this
part; it needs your own tenant credentials)

1. **Put this server on HTTPS with a publicly-trusted certificate first.** Outlook will
   not load an add-in whose URLs aren't HTTPS with a certificate it trusts (a self-signed
   cert will not work here, unlike the agent's own `UEM_SERVER_CA_PATH` trust mechanism —
   see `docs/tls-setup.md`). This server must also be reachable from wherever users run
   Outlook (the public internet for Outlook on the web/mobile, not just your internal
   network), since Microsoft's own servers and users' devices need to reach it.
2. Fetch the add-in manifest from your running server:
   `https://<your-server>/outlook-addin/manifest.xml` — save it locally. It's generated
   on the fly with every URL inside it already pointing at your server; nothing to edit.
3. In the [Microsoft 365 admin center](https://admin.microsoft.com), go to
   **Settings → Integrated apps → Upload custom apps**, and upload that manifest file.
4. Assign it to **specific users or a group**, or to everyone — this is Microsoft's own
   deployment scoping, separate from (and in addition to) the per-email assignment you
   do inside this console. Both must line up: a user needs the add-in *deployed* to them
   by Microsoft 365 **and** an *assigned policy* in this console for scanning to actually
   happen on their sends.
5. Deployment can take up to a few hours to reach every user's Outlook the first time
   (Microsoft's own rollout timing, not something this app controls).

## Known limitations (by design — not bugs)

- **Fail-open on anything unexpected.** A network hiccup reaching this server, a
  corrupted attachment, an unsupported file type — all of these let the email send
  rather than block it. A bug or outage in this feature must never be able to stop an
  entire organization's email.
- **PDFs, legacy Office formats (`.doc`/`.xls`/`.ppt`), images, and cloud-attached files
  are not scanned at all.** Reading text out of a PDF or a OneDrive link reliably from
  inside a lightweight browser-sandboxed add-in needs meaningfully heavier tooling
  (e.g. bundling PDF.js, or calling Microsoft Graph for cloud attachments) that isn't
  included yet. If this matters for your compliance needs, it's a scoped follow-up, not
  a small tweak.
- **No enforcement mode toggle (alert-only vs. block) yet** — a match always blocks the
  send. DLP and Command Blocking both have an alert-only/block distinction; this module
  doesn't yet, but the event log's `action` field is already shaped to support one later.
- **The policy-lookup and event-report endpoints are unauthenticated.** Outlook's add-in
  sandbox can't hold this app's admin session or an agent API key, so these two endpoints
  are deliberately public (rate-limited, like the agent enrollment endpoint). They reveal
  only "is this email address monitored" and accept only category labels — never file
  content — but a determined caller could spam fake events or probe which addresses are
  covered. Hardening this with Office SSO (validating an Azure AD token per request) is
  possible later if that risk matters for your organization.
