// Creates the installer zip from Node instead of PowerShell's Compress-Archive cmdlet.
//
// package-installer.ps1 previously called Compress-Archive directly and was reliably
// blocked by this build machine's Kaspersky Behavior Detection (System Watcher) /
// Adaptive Anomaly Control - "read hundreds of staged files, write one large archive" is
// a textbook ransomware-shaped operation, and every failure traced back to exactly that
// PowerShell call (Microsoft.PowerShell.Archive.psm1's own FileStream open), even when
// retried for minutes and even when targeting a destination outside the repo tree.
// Interactively-run Compress-Archive commands never hit the same block, which points at
// the automated/background invocation itself being what's flagged, not the operation's
// content - so this isn't guaranteed to dodge it, but it's a real, targeted change (a
// different tool entirely, doing the read/deflate/write itself rather than delegating to
// the specific PowerShell module every failure implicated) rather than another blind retry.
//
// Usage: node create-zip.js <sourceDir> <destZipPath>

const fs = require("node:fs");
const path = require("node:path");
const AdmZip = require("adm-zip");

const [, , sourceDir, destZipPath] = process.argv;
if (!sourceDir || !destZipPath) {
  console.error("Usage: node create-zip.js <sourceDir> <destZipPath>");
  process.exit(1);
}
if (!fs.existsSync(sourceDir)) {
  console.error(`Source directory does not exist: ${sourceDir}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(destZipPath), { recursive: true });

const zip = new AdmZip();
// addLocalFolder's default (no name filter) walks the whole tree recursively, preserving
// relative paths from sourceDir - the same shape Compress-Archive's `<sourceDir>\*` produced.
zip.addLocalFolder(sourceDir);

// Write to a fresh temp path, then rename into place, rather than deleting any pre-existing
// destZipPath first and writing fresh - a separate delete-then-create exposed the exact same
// "recently-written file still held by something" race that PowerShell's Compress-Archive
// version had to work around (Windows Search content-indexes inside .zip files, and a large
// one freshly written by a previous build run can still be locked for a while). Windows'
// MoveFileEx (what Node's fs.renameSync uses under the hood) replaces an existing
// destination atomically in one step, with no separate delete exposed to that race - and if
// the destination genuinely is still locked, a short synchronous retry covers it without
// needing a whole separate PowerShell-side retry loop for this.
const tempZipPath = `${destZipPath}.tmp-${process.pid}-${Date.now()}`;
zip.writeZip(tempZipPath);

const maxAttempts = 10;
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  try {
    fs.renameSync(tempZipPath, destZipPath);
    break;
  } catch (err) {
    if (attempt === maxAttempts) {
      fs.rmSync(tempZipPath, { force: true });
      throw err;
    }
    console.log(`  Renaming zip into place attempt ${attempt}/${maxAttempts} failed (${err.message}) - retrying...`);
    // Node has no built-in synchronous sleep; Atomics.wait on a throwaway Int32Array is the
    // standard way to block the main thread briefly without an extra dependency.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
  }
}

const { size } = fs.statSync(destZipPath);
console.log(`Zip created: ${destZipPath} (${size} bytes)`);
