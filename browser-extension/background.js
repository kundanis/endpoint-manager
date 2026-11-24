// Endpoint IQ Browser Guard - service worker (email: Mail Guard; AI websites: AI Guard, further down). The content script (gmail.js) can't call the server
// itself (Gmail's page rules and mixed-content blocking apply to it), so every server call goes
// through here. Only two calls exist, the same as the Outlook add-in's:
//   GET  /api/email-addin/policy?email=...  -> which personal-data categories to check for this mailbox,
//                                              and the trusted recipient domains that skip the checks
//   POST /api/email-addin/event             -> after a block: file name and category labels only,
//                                              never the file or the matched text
// The server URL comes only from browser policy, which the Endpoint IQ agent writes (HKLM, so the
// endpoint user can't change it). With no address set the extension does nothing.
//
// The extension has no standing access to other sites: the two calls are ordinary cross-origin
// requests, which the server allows for /api/email-addin/* (as for the Outlook add-in). Access to
// the server's own address only (optional_host_permissions) can be given from the options page,
// for a browser that won't let the extension reach a private network address without it.

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
  if (!base) return { ok: false, reason: "no-server", patternKeys: [], trustedDomains: [] };
  const res = await fetch(`${base}/api/email-addin/policy?email=${encodeURIComponent(email)}`, { cache: "no-store" });
  if (!res.ok) return { ok: false, reason: `http-${res.status}`, patternKeys: [], trustedDomains: [] };
  const body = await res.json();
  return {
    ok: true,
    patternKeys: Array.isArray(body.patternKeys) ? body.patternKeys : [],
    trustedDomains: Array.isArray(body.trustedDomains) ? body.trustedDomains : [],
  };
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

// ---- AI Guard prompt protection (aiguard.js on AI websites) ----------------------------------
// The agent writes this endpoint's id and key into browser policy next to serverUrl; they only
// let the extension read this endpoint's AI prompt settings and report prompt events.

async function endpointIdentity() {
  try {
    const managed = await chrome.storage.managed.get(["endpointId", "endpointKey"]);
    if (managed && managed.endpointId && managed.endpointKey) return { id: String(managed.endpointId), key: String(managed.endpointKey) };
  } catch (e) {
    // no policy on this browser
  }
  return null;
}

const AI_OFF = { enabled: false, action: "WARN", patternKeys: [], keywordTypes: [], fileTypes: [], appName: null, policyId: null };

async function getAiPolicy(host) {
  const base = await serverUrl();
  const who = await endpointIdentity();
  if (!base || !who || !host) return AI_OFF;
  const res = await fetch(`${base}/api/ai-guard-ext/policy?host=${encodeURIComponent(host)}`, {
    cache: "no-store",
    headers: { "X-EIQ-Endpoint": who.id, "X-EIQ-Key": who.key },
  });
  if (!res.ok) return AI_OFF;
  const body = await res.json();
  return {
    enabled: body.enabled === true,
    action: ["WARN", "BLOCK", "REDACT"].includes(body.action) ? body.action : "WARN",
    patternKeys: Array.isArray(body.patternKeys) ? body.patternKeys : [],
    keywordTypes: Array.isArray(body.keywordTypes) ? body.keywordTypes : [],
    fileTypes: Array.isArray(body.fileTypes) ? body.fileTypes : [],
    appName: typeof body.appName === "string" ? body.appName : null,
    policyId: typeof body.policyId === "string" ? body.policyId : null,
  };
}

async function reportAiEvent(payload) {
  const base = await serverUrl();
  const who = await endpointIdentity();
  if (!base || !who) return;
  await fetch(`${base}/api/ai-guard-ext/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-EIQ-Endpoint": who.id, "X-EIQ-Key": who.key },
    body: JSON.stringify(payload),
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "aiPolicy") {
    getAiPolicy(msg.host)
      .then(sendResponse)
      .catch(() => sendResponse(AI_OFF));
    return true;
  }
  if (msg && msg.type === "aiEvent") {
    reportAiEvent(msg.payload).catch(() => {});
    return false;
  }
  if (msg && msg.type === "policy") {
    getPolicy(msg.email)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, reason: String(e), patternKeys: [], trustedDomains: [] }));
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
        const origin = `${new URL(base).origin}/*`;
        const granted = await chrome.permissions.contains({ origins: [origin] }).catch(() => false);
        // /health isn't open to other origins: without access to the server's address, an opaque
        // (no-cors) answer still shows the server can be reached.
        const res = await fetch(`${base}/health`, { cache: "no-store", mode: granted ? "cors" : "no-cors" });
        const ok = res.ok || res.type === "opaque";
        sendResponse({ ok, server: base, origin, granted, message: ok ? `Connected to ${base}` : `Server answered ${res.status}` });
      })
      .catch((e) => sendResponse({ ok: false, message: `Can't reach the server: ${e}` }));
    return true;
  }
  return false;
});
