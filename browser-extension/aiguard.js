// Endpoint IQ Browser Guard - AI Guard prompt protection, on AI websites (ChatGPT, Gemini, Claude,
// DeepSeek and the other AI tools in the AI Guard catalogue).
//
// Checks what the user pastes into, sends to or uploads to the AI tool against this endpoint's AI
// Guard policy (personal data such as card or Aadhaar numbers, and the organisation's keyword data
// types), and then - as the policy says - warns (the user may continue), blocks, or masks the
// sensitive part. Everything is checked here in the browser: the prompt is never sent to the
// Endpoint IQ server, only the kind of data found and a masked sample when something is caught.
//
// The policy comes from the Endpoint IQ server through the service worker (background.js), which
// identifies this endpoint with the id/key the Endpoint IQ agent put in browser policy. With no
// policy, or prompt protection off, nothing is checked.

/* global EmailGuardScanner */
(function () {
  "use strict";

  if (window.top !== window) return;

  const POLICY_REFRESH_MS = 5 * 60 * 1000;
  const SEND_AGAIN_MS = 20 * 1000;
  const passThrough = new WeakSet();
  let policy = null;
  let policyAt = 0;
  let allowSendUntil = 0;

  // ---- Policy ---------------------------------------------------------------------------------

  function loadPolicy() {
    try {
      chrome.runtime.sendMessage({ type: "aiPolicy", host: location.hostname }, (p) => {
        if (chrome.runtime.lastError) return;
        policy = p && p.enabled ? p : null;
        policyAt = Date.now();
      });
    } catch (e) {
      // extension reloaded: this page keeps the last policy until it reloads too
    }
  }

  function currentPolicy() {
    if (Date.now() - policyAt > POLICY_REFRESH_MS) loadPolicy();
    return policy;
  }

  loadPolicy();

  function scan(text) {
    const p = currentPolicy();
    if (!p || !text) return null;
    const r = EmailGuardScanner.scanPrompt(text, p.patternKeys || [], p.keywordTypes || []);
    return r.labels.length > 0 ? r : null;
  }

  function report(channel, action, labels, sample, fileName) {
    try {
      chrome.runtime.sendMessage({
        type: "aiEvent",
        payload: {
          host: location.hostname,
          channel,
          action,
          dataTypes: labels.slice(0, 20),
          maskedSample: sample || null,
          fileName: fileName || null,
          policyId: policy ? policy.policyId : null,
        },
      });
    } catch (e) {
      // reporting never affects the decision
    }
  }

  // ---- UI -------------------------------------------------------------------------------------

  const COLORS = { block: "#b3261e", warn: "#8a5300", info: "#1f4e8c" };

  function notice(text, tone) {
    const id = "eiq-aiguard-notice";
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
      background: COLORS[tone] || COLORS.block,
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

  // A modal question; resolves true for "continue".
  function ask(title, body, continueLabel) {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      Object.assign(backdrop.style, { position: "fixed", inset: "0", background: "rgba(0,0,0,.45)", zIndex: "2147483647", display: "flex", alignItems: "center", justifyContent: "center" });
      const box = document.createElement("div");
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      Object.assign(box.style, { background: "#fff", color: "#1d1d1f", maxWidth: "480px", padding: "20px 24px", borderRadius: "10px", font: "14px/1.5 Arial, sans-serif", boxShadow: "0 8px 32px rgba(0,0,0,.35)" });
      const h = document.createElement("div");
      h.textContent = title;
      Object.assign(h.style, { fontWeight: "bold", fontSize: "16px", marginBottom: "8px" });
      const p = document.createElement("div");
      p.textContent = body;
      const row = document.createElement("div");
      Object.assign(row.style, { display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "16px" });
      const cancel = document.createElement("button");
      cancel.textContent = "Cancel";
      const go = document.createElement("button");
      go.textContent = continueLabel;
      for (const b of [cancel, go]) Object.assign(b.style, { padding: "8px 14px", borderRadius: "6px", border: "1px solid #c4c4c4", cursor: "pointer", font: "14px Arial, sans-serif", background: "#fff", color: "#1d1d1f" });
      Object.assign(go.style, { background: COLORS.warn, color: "#fff", borderColor: COLORS.warn });
      const done = (value) => {
        backdrop.remove();
        resolve(value);
      };
      cancel.onclick = () => done(false);
      go.onclick = () => done(true);
      backdrop.addEventListener("keydown", (e) => {
        if (e.key === "Escape") done(false);
      });
      row.append(cancel, go);
      box.append(h, p, row);
      backdrop.appendChild(box);
      (document.body || document.documentElement).appendChild(backdrop);
      cancel.focus();
    });
  }

  const list = (labels) => labels.join(", ");

  // ---- Editors --------------------------------------------------------------------------------

  function editableOf(el) {
    if (!el || !(el instanceof Element)) return null;
    if (el instanceof HTMLTextAreaElement) return el;
    if (el instanceof HTMLInputElement && (el.type === "text" || el.type === "search")) return el;
    const ce = el.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]');
    return ce || null;
  }

  // Some AI sites (Gemini among them) build the prompt box inside web components: an event's
  // target and document.activeElement then point at the component, not the editor inside it.
  // These look through open shadow roots.
  function deepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  function editableInPath(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    for (const node of path) {
      const e = editableOf(node);
      if (e) return e;
    }
    return null;
  }

  const EDITOR_SELECTOR = 'textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]';

  function findEditorIn(root) {
    const direct = root.querySelector(EDITOR_SELECTOR);
    if (direct) return editableOf(direct);
    for (const host of root.querySelectorAll("*")) {
      if (host.shadowRoot) {
        const inner = findEditorIn(host.shadowRoot);
        if (inner) return inner;
      }
    }
    return null;
  }

  // The prompt box the user is sending from: the focused editor, else the one in the same form,
  // else the page's main one.
  function promptEditor(from) {
    const focused = editableOf(deepActiveElement());
    if (focused) return focused;
    const scope = (from && from.closest && from.closest("form")) || document;
    return findEditorIn(scope) || (scope !== document ? findEditorIn(document) : null);
  }

  function textOf(editor) {
    if (!editor) return "";
    return "value" in editor ? editor.value : editor.innerText || "";
  }

  function saveSelection(editor) {
    if (!editor) return null;
    if ("selectionStart" in editor) return { start: editor.selectionStart, end: editor.selectionEnd };
    const sel = window.getSelection();
    return sel && sel.rangeCount > 0 ? { range: sel.getRangeAt(0).cloneRange() } : null;
  }

  function restoreSelection(editor, saved) {
    if (!editor) return;
    editor.focus();
    if (!saved) return;
    if (saved.range) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(saved.range);
    } else if ("setSelectionRange" in editor) {
      editor.setSelectionRange(saved.start, saved.end);
    }
  }

  // Inserts text the way typing would, so the AI site's own editor (React, ProseMirror) sees it.
  function insertText(editor, text) {
    if (!editor) return;
    editor.focus();
    if (!document.execCommand("insertText", false, text) && "value" in editor) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), "value").set;
      const start = editor.selectionStart ?? editor.value.length;
      setter.call(editor, editor.value.slice(0, start) + text + editor.value.slice(editor.selectionEnd ?? start));
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function replaceAll(editor, text) {
    if (!editor) return;
    editor.focus();
    if ("select" in editor) editor.select();
    else document.execCommand("selectAll", false);
    insertText(editor, text);
  }

  function blockEvent(event) {
    event.stopImmediatePropagation();
    event.preventDefault();
  }

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

  // ---- Files: one decision for a set of files; resolves true when they may go through --------

  // A file of a type the policy protects (its file-type data types), whatever it contains.
  function fileTypeOf(file, p) {
    const name = (file.name || "").toLowerCase();
    const dot = name.lastIndexOf(".");
    if (dot === -1) return null;
    const ext = name.slice(dot);
    return (p.fileTypes || []).find((t) => (t.extensions || []).includes(ext)) || null;
  }

  async function allowFiles(files) {
    const p = currentPolicy();
    if (!p) return true;
    const byType = [];
    const rest = [];
    for (const f of files) {
      const t = fileTypeOf(f, p);
      if (t) byType.push({ name: f.name || "file", labels: [t.label], sample: "" });
      else rest.push(f);
    }
    const hits = [...byType, ...(rest.length ? await EmailGuardScanner.scanPromptFiles(rest, p.patternKeys || [], p.keywordTypes || []) : [])];
    if (hits.length === 0) return true;
    const labels = [...new Set(hits.flatMap((h) => h.labels))];
    const names = hits.map((h) => h.name).join(", ");
    // "notes.sql (Databases and backups), cv.docx (PAN (Permanent Account Number))"
    const reasons = hits.map((h) => `${h.name} (${h.labels.join(", ")})`).join("; ");
    const sample = hits.map((h) => h.sample).filter(Boolean).join(", ").slice(0, 300);
    if (p.action === "WARN") {
      const go = await ask(
        "Sensitive Data in This File",
        `Protected by your organisation's AI policy: ${reasons}. It asks you not to share this with ${p.appName || "AI tools"}.`,
        "Upload anyway",
      );
      report("UPLOAD", go ? "WARNED_CONTINUED" : "WARNED_CANCELLED", labels, sample, names);
      return go;
    }
    // A file can't be masked, so masking blocks it too.
    notice(`Upload blocked - ${reasons}. Your organisation's AI policy doesn't allow sharing this with ${p.appName || "AI tools"}.`, "block");
    report("UPLOAD", "BLOCKED", labels, sample, names);
    return false;
  }

  // ---- 1. Paste -------------------------------------------------------------------------------

  window.addEventListener(
    "paste",
    (event) => {
      if (passThrough.has(event) || !event.clipboardData || !currentPolicy()) return;
      const files = filesOf(event.clipboardData.files, event.clipboardData.items);
      const target = event.target;
      if (files.length > 0) {
        blockEvent(event);
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
        return;
      }
      const text = event.clipboardData.getData("text/plain");
      const found = scan(text);
      if (!found) return;
      blockEvent(event);
      const p = currentPolicy();
      const editor = editableInPath(event) || promptEditor(target);
      if (p.action === "BLOCK") {
        notice(`Paste blocked: it contains ${list(found.labels)}. Your organisation's AI policy doesn't allow sharing this with ${p.appName || "AI tools"}.`, "block");
        report("PASTE", "BLOCKED", found.labels, found.sample);
      } else if (p.action === "REDACT") {
        insertText(editor, EmailGuardScanner.redactText(text, found.matches));
        notice(`Masked before pasting: ${list(found.labels)}. The rest of the text was pasted.`, "warn");
        report("PASTE", "REDACTED", found.labels, found.sample);
      } else {
        const saved = saveSelection(editor);
        ask(
          "Sensitive Data in What You're Pasting",
          `It contains ${list(found.labels)}. Your organisation's AI policy asks you not to share this with ${p.appName || "AI tools"}.`,
          "Paste anyway",
        ).then((go) => {
          if (go) {
            restoreSelection(editor, saved);
            insertText(editor, text);
          }
          report("PASTE", go ? "WARNED_CONTINUED" : "WARNED_CANCELLED", found.labels, found.sample);
        });
      }
    },
    true,
  );

  // ---- 2. Send (Enter in the prompt box, or the send button) ----------------------------------

  function looksLikeSendButton(el) {
    const b = el && el.closest && el.closest("button, [role='button']");
    if (!b) return null;
    const label = `${b.getAttribute("aria-label") || ""} ${b.getAttribute("data-testid") || ""} ${b.getAttribute("title") || ""}`.toLowerCase();
    if (b.getAttribute("type") === "submit" || /\bsend\b|submit|send-button|sendbutton/.test(label)) return b;
    return null;
  }

  // True when the send was stopped.
  function checkSend(event, from) {
    if (Date.now() < allowSendUntil || !currentPolicy()) return false;
    const editor = editableOf(from) || promptEditor(from);
    const text = textOf(editor);
    const found = scan(text);
    if (!found) return false;
    blockEvent(event);
    const p = currentPolicy();
    if (p.action === "BLOCK") {
      notice(`Not sent: your prompt contains ${list(found.labels)}. Remove it and send again - your organisation's AI policy doesn't allow sharing this with ${p.appName || "AI tools"}.`, "block");
      report("SEND", "BLOCKED", found.labels, found.sample);
    } else if (p.action === "REDACT") {
      replaceAll(editor, EmailGuardScanner.redactText(text, found.matches));
      notice(`Masked: ${list(found.labels)}. Check the prompt, then press Send again.`, "warn");
      report("SEND", "REDACTED", found.labels, found.sample);
    } else {
      ask(
        "Sensitive Data in Your Prompt",
        `It contains ${list(found.labels)}. Your organisation's AI policy asks you not to share this with ${p.appName || "AI tools"}.`,
        "Send anyway",
      ).then((go) => {
        if (go) {
          allowSendUntil = Date.now() + SEND_AGAIN_MS;
          notice("Press Send again to send it.", "info");
          if (editor) editor.focus();
        }
        report("SEND", go ? "WARNED_CONTINUED" : "WARNED_CANCELLED", found.labels, found.sample);
      });
    }
    return true;
  }

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.altKey || event.isComposing) return;
      const editor = editableInPath(event);
      if (!editor) return;
      checkSend(event, editor);
    },
    true,
  );

  window.addEventListener(
    "click",
    (event) => {
      const origin = (typeof event.composedPath === "function" && event.composedPath()[0]) || event.target;
      const button = looksLikeSendButton(origin instanceof Element ? origin : event.target);
      if (button) checkSend(event, button);
    },
    true,
  );

  // ---- 3. Uploads (file picker and drag-and-drop) ---------------------------------------------

  window.addEventListener(
    "change",
    (event) => {
      const input = event.target;
      if (passThrough.has(event) || !(input instanceof HTMLInputElement) || input.type !== "file" || !input.files || input.files.length === 0) return;
      if (!currentPolicy()) return;
      const files = Array.from(input.files);
      blockEvent(event);
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

  window.addEventListener(
    "drop",
    (event) => {
      if (passThrough.has(event) || !event.dataTransfer || !currentPolicy()) return;
      const files = filesOf(event.dataTransfer.files, event.dataTransfer.items);
      if (files.length === 0) return;
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
          target.dispatchEvent(replay);
        });
    },
    true,
  );
})();
