import fs from "node:fs";
import path from "node:path";

// Classic Outlook on Windows runs event-based add-ins in a JavaScript-only runtime: it loads
// the single file the manifest's <Override type="javascript"> names (see emailAddinManifest.ts)
// — no HTML page, so no <script> tags, and no page origin for relative URLs to resolve
// against. So commands.js is served as one self-contained file: vendored JSZip, then this
// server's own base URL, then the add-in code itself. Outlook on the web / new Outlook load
// the exact same file through commands.html, so every client runs identical code.
const ADDIN_DIR = path.resolve(__dirname, "..", "public", "outlook-addin");

let cachedSources: { jszip: string; commands: string } | null = null;

function loadSources() {
  // Read once per process — both files are static for the lifetime of a deployment. In dev,
  // tsx watch restarts the process on edits under src/, not public/, so restart the server
  // after editing commands.js to pick the change up.
  if (!cachedSources) {
    cachedSources = {
      jszip: fs.readFileSync(path.join(ADDIN_DIR, "vendor", "jszip.min.js"), "utf8"),
      commands: fs.readFileSync(path.join(ADDIN_DIR, "commands.js"), "utf8"),
    };
  }
  return cachedSources;
}

// JSZip schedules its async work through setImmediate, polyfilled inside its bundle onto
// `self`/`global` — neither of which a bare JavaScript-only runtime is guaranteed to define,
// in which case every JSZip.loadAsync throws and OOXML attachments silently go unscanned.
// A top-level `var` here creates a real global binding before JSZip loads.
const SET_IMMEDIATE_SHIM = `if (typeof setImmediate === "undefined") {
  var setImmediate = function (fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    return setTimeout(function () { fn.apply(null, args); }, 0);
  };
}`;

export function renderEmailAddinScript(baseUrl: string): string {
  const { jszip, commands } = loadSources();
  const b = baseUrl.replace(/\/$/, "");
  return `${SET_IMMEDIATE_SHIM}\n${jszip}\n;\nvar EM_ADDIN_BASE_URL = ${JSON.stringify(b)};\n${commands}`;
}
