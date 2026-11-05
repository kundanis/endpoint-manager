// Endpoint IQ Mail Guard - service worker. The content script (gmail.js) can't call the server
// itself (Gmail's page rules and mixed-content blocking apply to it), so every server call goes
// through here. Only two calls exist, the same as the Outlook add-in's:
//   GET  /api/email-addin/policy?email=...  -> which personal-data categories to check for this mailbox
//   POST /api/email-addin/event             -> after a block: file name and category labels only,
//                                              never the file or the matched text
// The server URL comes only from browser policy, which the Endpoint IQ agent writes (HKLM, so the
// endpoint user can't change it). With no address set the extension does nothing.

async function serverUrl() {
  try {
    const managed = await chrome.storage.managed.get("serverUrl");
    if (managed && managed.serverUrl) return String(managed.serverUrl).replace(/\/+$/, "");
  } catch (e) {
    // no policy on this browser
  }
  return "";
}

async function getPolicy(email) {
  const base = await serverUrl();
  if (!base) return { ok: false, reason: "no-server", patternKeys: [] };
  const res = await fetch(`${base}/api/email-addin/policy?email=${encodeURIComponent(email)}`, { cache: "no-store" });
  if (!res.ok) return { ok: false, reason: `http-${res.status}`, patternKeys: [] };
  const body = await res.json();
  return { ok: true, patternKeys: Array.isArray(body.patternKeys) ? body.patternKeys : [] };
}

async function reportEvent(payload) {
  const base = await serverUrl();
  if (!base) return;
  await fetch(`${base}/api/email-addin/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// The PDF reader (pdf.js, ~1.4 MB) is only loaded into a Gmail tab the first time a PDF is
// attached there, into the content script's own isolated world. Loading the worker script too
// makes pdf.js run on the page thread instead of starting a Web Worker, which an extension
// can't do from inside Gmail.
async function loadPdfReader(sender) {
  await chrome.scripting.executeScript({
    target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] },
    files: ["vendor/pdfjs/pdf.worker.min.js", "vendor/pdfjs/pdf.min.js"],
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "policy") {
    getPolicy(msg.email)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, reason: String(e), patternKeys: [] }));
    return true; // async response
  }
  if (msg && msg.type === "event") {
    reportEvent(msg.payload).catch(() => {});
    return false;
  }
  if (msg && msg.type === "loadPdfReader") {
    loadPdfReader(sender)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, reason: String(e) }));
    return true;
  }
  if (msg && msg.type === "health") {
    serverUrl()
      .then(async (base) => {
        if (!base) return sendResponse({ ok: false, message: "Not connected: the Endpoint IQ agent hasn't set a server address on this computer." });
        const res = await fetch(`${base}/health`, { cache: "no-store" });
        sendResponse({ ok: res.ok, server: base, message: res.ok ? `Connected to ${base}` : `Server answered ${res.status}` });
      })
      .catch((e) => sendResponse({ ok: false, message: `Can't reach the server: ${e}` }));
    return true;
  }
  return false;
});
