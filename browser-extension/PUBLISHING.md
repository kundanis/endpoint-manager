# Publishing Endpoint IQ Mail Guard

Mail Guard is published once to the **Chrome Web Store** and once to **Microsoft Edge Add-ons**,
as an **unlisted** item: it doesn't appear in search and can only be installed by its ID. The
Endpoint IQ agent then installs it in Chrome and Edge on each endpoint, and users can't remove or
disable it, as long as at least one Email attachment blocking policy is in use. On PCs that
aren't joined to a domain, the browsers only allow this for extensions from their own store.

Each store gives the extension its own ID when it's first submitted. Send both IDs to the
development team. Until they're added to the product (`packages/shared/src/data/mailGuard.ts`)
and released, the agent installs nothing.

## Before you start

- **Accounts.** Both must be company accounts, not personal ones. The publisher name is shown on
  the store page.
  - Google: register at <https://chrome.google.com/webstore/devconsole>. The fee is US$5, paid
    once, and the account needs 2-Step Verification.
  - Microsoft: register for the Microsoft Edge program in Partner Center at
    <https://partner.microsoft.com/dashboard/microsoftedge>. It's free.
- **Package.** Run `node browser-extension/pack.mjs` and upload
  `release/endpoint-iq-mail-guard-<version>-store.zip` (the `-store` file, not the other one).
- **Privacy policy.** Both stores require a public web page. Put the text from
  [Privacy policy text](#privacy-policy-text) on the company website and use that URL.
- **Screenshot.** You need at least one, 1280×800 pixels. Use Gmail in a test account showing the
  red "Attachment blocked" message.
- **Icon.** `browser-extension/icons/icon-128.png`.

## Chrome Web Store

1. In the developer dashboard, select **New item** and upload the `-store` zip.
2. On the **Store listing** tab, fill in:
   - Description: see [Listing text](#listing-text).
   - Category: Workflow & Planning.
   - Language: English.
   - Icon and screenshot.
3. On the **Privacy** tab, fill in:
   - Single purpose: see [Listing text](#listing-text).
   - A justification for each permission: see [Permission justifications](#permission-justifications).
   - Remote code: **No, I am not using remote code**.
   - Data usage: tick **Personally identifiable information** and **Website content**, and tick
     all three certifications.
   - Privacy policy URL.
4. On the **Distribution** tab, fill in:
   - Visibility: **Unlisted**.
   - Regions: all regions.
5. Select **Submit for review**. Expect a few days, possibly more, because the extension can
   reach any web address (see the justification).
6. Copy the **Item ID**: 32 lowercase letters, shown at the top of the item and in its store
   address. Send it to the development team.

## Microsoft Edge Add-ons

1. In Partner Center, select **Create new extension** and upload the same `-store` zip.
2. Under **Availability**, set visibility to **Hidden** (Edge's word for unlisted) and include
   all markets.
3. Under **Properties**, fill in:
   - Category: Productivity.
   - Privacy policy: Yes, then the URL.
   - Website: the company website.
   - Support contact: a support email address.
4. Under **Store listings**, add English with the description, icon and screenshot.
5. In **Submit**, the notes for certification can reuse the
   [Permission justifications](#permission-justifications) text. Then submit. Review usually
   takes up to 7 working days.
6. Copy the **Extension ID**, shown on the extension's overview page after submission. Send it
   to the development team.

## Listing text

**Name:** Endpoint IQ Mail Guard

**Single purpose:** Stops personal data, such as card numbers or PAN, from being sent from Gmail
when the user's organization has a policy against it.

**Description:**

> Endpoint IQ Mail Guard is for organizations that use Endpoint IQ. It is installed and set up by
> your organization's IT team, and does nothing on its own.
>
> When your organization's Email attachment blocking policy covers your Gmail address, Mail Guard
> checks attachments (text, Word, Excel, PowerPoint and PDF files) and the text of your message for
> the kinds of personal data the policy protects, such as card numbers, PAN, Aadhaar or bank
> details. If it finds any, the attachment or email is stopped and you're told why.
>
> Everything is checked on your computer. Your emails and files are never sent anywhere. When
> something is blocked, only the file name and the kind of data found are reported to your
> organization's own Endpoint IQ server.

## Permission justifications

- **storage:** Reads the address of the organization's Endpoint IQ server, which the
  organization's IT sets through browser policy.
- **scripting:** Loads the PDF reader into the Gmail tab, only when a PDF is attached, so the PDF
  can be checked on the device.
- **Host permission, mail.google.com:** Checks attachments and message text in Gmail before
  they're sent.
- **Optional host permission, http and https addresses:** Not granted at install. The extension
  reads its policy from and reports blocks to the organization's own Endpoint IQ server, through
  ordinary cross-origin requests the server allows. Every organization runs its own server at its
  own address (often a private network address), which isn't known when the extension is
  published; if a browser needs it, the options page asks for access to that one address only.
  No other site is contacted.

## Privacy policy text

> **Endpoint IQ Mail Guard — Privacy policy**
>
> Endpoint IQ Mail Guard is a browser extension installed by organizations that use Endpoint IQ.
>
> **What it reads:** In Gmail, it reads the attachments you add and the subject and text of
> emails you write. It checks them on your computer for kinds of personal data your organization
> has chosen to protect.
>
> **What it sends, and where:** It sends data only to your organization's own Endpoint IQ server.
> Your organization runs that server; we don't.
> - When Gmail is open, it sends your Gmail address, to find out which policy applies to you.
> - When it blocks something, it sends your Gmail address, the file name (or "Message text"), and
>   the kind of data found, such as "PAN".
>
> It never sends the content of your emails or files, or the data it found.
>
> **What it doesn't do:** It doesn't sell or share data, show advertising, track browsing, or act on
> any site other than Gmail.
>
> **Questions:** Contact your organization's IT team, who manage Endpoint IQ, or <support email>.

## Releasing a new version later

1. Raise `version` in `browser-extension/manifest.json`, then run `node browser-extension/pack.mjs`.
2. In both dashboards, upload the new `-store` zip to the existing item and submit it for review.
   The IDs don't change.
3. After approval, browsers update the extension by themselves within a few hours. Nothing is
   needed on the endpoints.
