// Builds the two Mail Guard packages into release/ (Windows; uses the system tar.exe):
//   endpoint-iq-mail-guard-<version>.zip        - for testing: Load unpacked. Keeps the manifest
//                                                  "key", so its ID is the fixed development ID.
//   endpoint-iq-mail-guard-<version>-store.zip  - for uploading to the Chrome Web Store and Edge
//                                                  Add-ons, which refuse a manifest with "key"
//                                                  and assign their own ID.
// Run: node browser-extension/pack.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const releaseDir = path.join(here, "..", "release");
const FILES = ["manifest.json", "managed-schema.json", "background.js", "scanner.js", "gmail.js", "options.html", "options.js", "icons", "vendor"];

const manifest = JSON.parse(fs.readFileSync(path.join(here, "manifest.json"), "utf8"));
fs.mkdirSync(releaseDir, { recursive: true });

function zip(dir, name) {
  const out = path.join(releaseDir, name);
  fs.rmSync(out, { force: true });
  execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", out, ...FILES], { cwd: dir });
  console.log(`${out}`);
}

zip(here, `endpoint-iq-mail-guard-${manifest.version}.zip`);

const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-guard-store-"));
try {
  for (const f of FILES) fs.cpSync(path.join(here, f), path.join(storeDir, f), { recursive: true });
  const { key: _key, ...storeManifest } = manifest;
  fs.writeFileSync(path.join(storeDir, "manifest.json"), `${JSON.stringify(storeManifest, null, 2)}\n`);
  zip(storeDir, `endpoint-iq-mail-guard-${manifest.version}-store.zip`);
} finally {
  fs.rmSync(storeDir, { recursive: true, force: true });
}
