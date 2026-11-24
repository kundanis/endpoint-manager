// Endpoint IQ Mail Guard browser extension (browser-extension/ at the repo root).
//
// The store IDs are assigned by the Chrome Web Store and Edge Add-ons when the extension is
// first published (see browser-extension/PUBLISHING.md); until they are filled in here the
// agents don't install anything. The development ID is the one fixed by the "key" in
// browser-extension/manifest.json, used when the extension is loaded unpacked for testing.
export const MAIL_GUARD_DEV_EXTENSION_ID = "lkmoggokfmdgjjjbmfachhmjdpbebebc";
export const MAIL_GUARD_CHROME_STORE_ID = "ncghjfmanemplpcikadapjgdmedgncob";
export const MAIL_GUARD_EDGE_STORE_ID = "";

// The stores' update URLs, as browser force-install policy expects them after "<id>;".
export const CHROME_STORE_UPDATE_URL = "https://clients2.google.com/service/update2/crx";
export const EDGE_STORE_UPDATE_URL = "https://edge.microsoft.com/extensionwebstorefront/v1/crx";

// GET /api/agent/mail-guard. install is true while at least one enabled Email attachment
// blocking policy has a mailbox assigned; the extension itself then decides per signed-in
// mailbox. An empty ID means that store's copy isn't published yet.
export interface MailGuardAgentSettings {
  install: boolean;
  chromeExtensionId: string;
  edgeExtensionId: string;
  // AI Guard prompt protection (agent 0.2.32+): this endpoint's id and the key the Browser Guard
  // extension presents to /api/ai-guard-ext - written into the extension's browser policy.
  endpointId?: string;
  endpointKey?: string;
}
