// Endpoint IQ Mail Guard - Gmail. Two checks:
//  - Attachments: catches files at the three ways Gmail takes one (the paperclip file picker,
//    drag-and-drop and paste) before Gmail sees them. Each file is scanned on this device; a clean
//    set is handed on to Gmail unchanged, a file with protected personal data is stopped.
//  - Message text: pasted text is checked before it lands in the subject or body, and the subject
//    and body are checked again at Send (button or Ctrl+Enter), so typed text is covered too.
//    Email addresses and phone numbers are checked in attachments only - signatures and replies
//    are full of them, so checking the text for them would block nearly every email.
// Every block tells the user why and is reported (file name or "Message text", plus categories
// only - never the content).
//
// Works only while an Email attachment blocking policy covers the signed-in Gmail address: with
// no policy the extension does nothing. Fails open: if the server can't be reached or a scan
// errors, mail goes through, so a fault never stops anyone's email.

/* global EmailGuardScanner */
(function () {
  "use strict";

  const POLICY_TTL_MS = 60_000;
  const ATTACHMENT_ONLY_KEYS = ["EMAIL", "PHONE_INDIA", "PHONE_GENERIC"];
  const BODY_SELECTOR = 'div[contenteditable="true"][role="textbox"], div[g_editable="true"]';
  let policy = { email: null, patternKeys: [], fetchedAt: 0, pending: null };
  const passThrough = new WeakSet(); // events this script re-dispatched after a clean scan
  let lastTextReportAt = 0;

  function signedInEmail() {
    // Gmail's tab title is "Inbox (3) - someone@example.com - Gmail".
    const m = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i.exec(document.title || "");
    return m ? m[1].toLowerCase() : null;
  }

  function fetchPolicy(email) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "policy", email }, (res) => {
          resolve(res && res.ok ? res.patternKeys : []);
        });
      } catch (e) {
        resolve([]);
      }
    });
  }

  // The categories to check for the signed-in mailbox (cached for a minute).
  async function currentKeys() {
    const email = signedInEmail();
    if (!email) return { email: null, keys: [] };
    const fresh = policy.email === email && Date.now() - policy.fetchedAt < POLICY_TTL_MS;
    if (!fresh) {
      if (!policy.pending || policy.email !== email) {
        policy.email = email;
        policy.pending = fetchPolicy(email).then((keys) => {
          policy = { email, patternKeys: keys, fetchedAt: Date.now(), pending: null };
          return keys;
        });
      }
      await policy.pending;
    }
    return { email, keys: policy.patternKeys };
  }

  // Known with no waiting: true when a policy definitely doesn't apply (so events are left alone).
  function knownNoPolicy() {
    const email = signedInEmail();
    return policy.email === email && Date.now() - policy.fetchedAt < POLICY_TTL_MS && policy.patternKeys.length === 0;
  }

  // The text checks have to decide on the spot (a click or keypress can't be held and replayed),
  // so they use the last policy fetched for this mailbox, which is refreshed every minute.
  function textKeysNow() {
    const email = signedInEmail();
    if (!email || policy.email !== email || policy.fetchedAt === 0) return { email, keys: [] };
    return { email, keys: policy.patternKeys.filter((k) => !ATTACHMENT_ONLY_KEYS.includes(k)) };
  }

  function showBanner(text) {
    const id = "emailguard-banner";
    document.getElementById(id)?.remove();
    const div = document.createElement("div");
    div.id = id;
    div.setAttribute("role", "alert");
    div.textContent = text;
    Object.assign(div.style, {
      position: "fixed",
      top: "16px",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: "2147483647",
      maxWidth: "640px",
      padding: "12px 40px 12px 16px",
      background: "#b3261e",
      color: "#fff",
      font: "14px/1.4 Arial, sans-serif",
      borderRadius: "8px",
      boxShadow: "0 4px 16px rgba(0,0,0,.3)",
    });
    const close = document.createElement("button");
    close.textContent = "×";
    close.setAttribute("aria-label", "Close");
    Object.assign(close.style, { position: "absolute", top: "6px", right: "10px", background: "none", border: "none", color: "#fff", fontSize: "20px", cursor: "pointer" });
    close.onclick = () => div.remove();
    div.appendChild(close);
    (document.body || document.documentElement).appendChild(div);
    setTimeout(() => div.remove(), 15000);
  }

  function report(email, name, labels) {
    try {
      chrome.runtime.sendMessage({ type: "event", payload: { senderEmail: email, attachmentName: name.slice(0, 500), action: "BLOCKED", matchedCategoryLabels: labels } });
    } catch (e) {
      // reporting never affects the decision
    }
  }

  // Scans the files; resolves true when they may go through.
  async function allowFiles(files) {
    const { email, keys } = await currentKeys();
    if (!email || keys.length === 0) return true;
    const hits = await EmailGuardScanner.scanFiles(files, keys);
    if (hits.length === 0) return true;
    const labels = [...new Set(hits.flatMap((h) => h.labels))];
    const names = hits.map((h) => h.name).join(", ");
    showBanner(`Attachment blocked: ${names} appears to contain ${labels.join(", ")}. Your organization's policy doesn't allow this to be emailed. Remove or redact it, then attach it again.`);
    report(email, names, labels);
    return false;
  }

  // Files from a file list, falling back to the item list (some sources, e.g. a file copied in
  // File Explorer, can arrive only as items).
  function filesOf(files, items) {
    const out = files ? Array.from(files).filter((f) => f instanceof File) : [];
    if (out.length === 0 && items) {
      for (const item of Array.from(items)) {
        if (item.kind !== "file") continue;
        const f = item.getAsFile();
        if (f) out.push(f);
      }
    }
    return out;
  }

  // ---- Message text --------------------------------------------------------------------------

  function isComposeField(el) {
    if (!(el instanceof Element)) return false;
    if (el.closest(BODY_SELECTOR)) return true;
    return el instanceof HTMLInputElement && el.name === "subjectbox";
  }

  // The compose window (pop-up or inline reply) an element belongs to: its nearest ancestor
  // holding both a message body and a Send button, else the nearest holding a body.
  function composeRootOf(el) {
    let bodyOnly = null;
    for (let cur = el instanceof Element ? el : null; cur && cur !== document.documentElement; cur = cur.parentElement) {
      if (!cur.querySelector(BODY_SELECTOR)) continue;
      if (cur.querySelector(".aoO")) return cur;
      bodyOnly = bodyOnly || cur;
    }
    return bodyOnly;
  }

  // Subject and the new text of the body - quoted earlier messages in a reply are left out, as
  // the sender didn't write them.
  function composeText(root) {
    const parts = [];
    const subject = root.querySelector('input[name="subjectbox"]');
    if (subject && subject.value) parts.push(subject.value);
    const body = root.querySelector(BODY_SELECTOR);
    if (body) {
      const copy = body.cloneNode(true);
      copy.querySelectorAll(".gmail_quote, blockquote").forEach((q) => q.remove());
      parts.push(copy.innerText || copy.textContent || "");
    }
    return parts.join("\n");
  }

  // Returns the categories found (so the caller blocks), or [] to let it through.
  function checkText(text, what) {
    const { email, keys } = textKeysNow();
    if (!email || keys.length === 0 || !text) return [];
    let labels = [];
    try {
      labels = EmailGuardScanner.scanText(text, keys);
    } catch (e) {
      return [];
    }
    if (labels.length === 0) return [];
    showBanner(
      what === "paste"
        ? `Paste blocked: the text appears to contain ${labels.join(", ")}. Your organization's policy doesn't allow this to be emailed.`
        : `Email not sent: the message appears to contain ${labels.join(", ")}. Your organization's policy doesn't allow this to be emailed. Remove it, then send again.`,
    );
    if (Date.now() - lastTextReportAt > 2000) {
      lastTextReportAt = Date.now();
      report(email, what === "paste" ? "Pasted message text" : "Message text", labels);
    }
    return labels;
  }

  function isSendButton(el) {
    if (!(el instanceof Element)) return null;
    const btn = el.closest('div[role="button"], button');
    if (!btn) return null;
    if (btn.classList.contains("aoO")) return btn; // Gmail's Send button, in every language
    const label = btn.getAttribute("data-tooltip") || btn.getAttribute("aria-label") || "";
    return /^Send(\s*[‪(]|$)/i.test(label.trim()) ? btn : null;
  }

  function blockEvent(event) {
    event.stopImmediatePropagation();
    event.preventDefault();
  }

  // Send button: Gmail may act on any of these, so all three are checked.
  for (const type of ["mousedown", "mouseup", "click"]) {
    window.addEventListener(
      type,
      (event) => {
        const btn = isSendButton(event.target);
        if (!btn) return;
        const root = composeRootOf(btn);
        if (root && checkText(composeText(root), "send").length > 0) blockEvent(event);
      },
      true,
    );
  }

  // Ctrl+Enter (Cmd+Enter on a Mac) from anywhere in the compose window, or Enter/Space on a
  // focused Send button.
  window.addEventListener(
    "keydown",
    (event) => {
      const shortcut = event.key === "Enter" && (event.ctrlKey || event.metaKey);
      const onButton = (event.key === "Enter" || event.key === " ") && isSendButton(event.target);
      if (!shortcut && !onButton) return;
      const root = composeRootOf(event.target);
      if (root && checkText(composeText(root), "send").length > 0) blockEvent(event);
    },
    true,
  );

  // ---- Attachments ---------------------------------------------------------------------------

  // 1. Paperclip / file picker: hold the change event, scan, then replay it or clear the picker.
  window.addEventListener(
    "change",
    (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file" || passThrough.has(event)) return;
      const files = filesOf(input.files);
      if (files.length === 0 || knownNoPolicy()) return;
      event.stopImmediatePropagation();
      allowFiles(files)
        .catch(() => true)
        .then((ok) => {
          if (ok) {
            const replay = new Event("change", { bubbles: true });
            passThrough.add(replay);
            input.dispatchEvent(replay);
          } else {
            input.value = "";
          }
        });
    },
    true,
  );

  // 2. Drag-and-drop onto the message.
  window.addEventListener(
    "drop",
    (event) => {
      if (passThrough.has(event) || !event.dataTransfer) return;
      const files = filesOf(event.dataTransfer.files, event.dataTransfer.items);
      if (files.length === 0 || knownNoPolicy()) return;
      blockEvent(event);
      const target = event.target;
      const init = { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY, screenX: event.screenX, screenY: event.screenY };
      allowFiles(files)
        .catch(() => true)
        .then((ok) => {
          const dt = new DataTransfer();
          if (ok) files.forEach((f) => dt.items.add(f));
          const replay = new DragEvent(ok ? "drop" : "dragleave", { ...init, dataTransfer: dt });
          passThrough.add(replay);
          target.dispatchEvent(replay); // dragleave clears Gmail's "Drop files here" overlay
        });
    },
    true,
  );

  // 3. Paste: a file is held, scanned and replayed like a drop; text pasted into the subject or
  // body is checked on the spot.
  window.addEventListener(
    "paste",
    (event) => {
      if (passThrough.has(event) || !event.clipboardData) return;
      const files = filesOf(event.clipboardData.files, event.clipboardData.items);
      if (files.length === 0) {
        if (!isComposeField(event.target)) return;
        const text = event.clipboardData.getData("text/plain") || event.clipboardData.getData("text/html").replace(/<[^>]+>/g, " ");
        if (checkText(text, "paste").length > 0) blockEvent(event);
        return;
      }
      if (knownNoPolicy()) return;
      blockEvent(event);
      const target = event.target;
      allowFiles(files)
        .catch(() => true)
        .then((ok) => {
          if (!ok) return;
          const dt = new DataTransfer();
          files.forEach((f) => dt.items.add(f));
          const replay = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
          passThrough.add(replay);
          target.dispatchEvent(replay);
        });
    },
    true,
  );

  // Fetch the policy early so the first attachment isn't delayed and the text checks have it.
  const warm = () => currentKeys().catch(() => undefined);
  setTimeout(warm, 3000);
  setInterval(warm, POLICY_TTL_MS);
})();
