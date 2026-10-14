// Parser tests for the macOS agent, against output captured in the formats Apple's tools
// print. Run with: npm test -w @em/agent-macos
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSoftwareUpdateList, severityOf } from "../src/softwareUpdate";
import { parseSystemProfilerApps } from "../src/inventory";
import { buildUpdateId, parseUpdateId } from "../src/patchScanner";

const SOFTWAREUPDATE_CURRENT = [
  "Software Update Tool",
  "",
  "Finding available software",
  "Software Update found the following new or updated software:",
  "* Label: macOS Sonoma 14.6.1-23G93",
  "\tTitle: macOS Sonoma 14.6.1, Version: 14.6.1, Size: 1192320KiB, Recommended: YES, Action: restart, ",
  "* Label: Command Line Tools for Xcode-15.3",
  "\tTitle: Command Line Tools for Xcode, Version: 15.3, Size: 703298KiB, Recommended: YES, ",
  "* Label: Safari17.6SonomaAuto-17.6",
  "\tTitle: Safari, Version: 17.6, Size: 158311KiB, Recommended: YES, ",
].join("\n");

// macOS 10.15/11 style: indented label line, "K" sizes.
const SOFTWAREUPDATE_OLDER = [
  "Software Update found the following new or updated software:",
  "   * Label: Security Update 2021-008-10.15.7",
  "\tTitle: Security Update 2021-008, Version: 10.15.7, Size: 1612340K, Recommended: YES, Action: restart, ",
].join("\r\n");

test("parseSoftwareUpdateList reads current-format output", () => {
  const updates = parseSoftwareUpdateList(SOFTWAREUPDATE_CURRENT);
  assert.equal(updates.length, 3);
  assert.deepEqual(updates[0], {
    label: "macOS Sonoma 14.6.1-23G93",
    title: "macOS Sonoma 14.6.1",
    version: "14.6.1",
    sizeBytes: 1192320 * 1024,
    recommended: true,
    restartRequired: true,
  });
  assert.equal(updates[1].label, "Command Line Tools for Xcode-15.3");
  assert.equal(updates[1].restartRequired, false);
  assert.equal(updates[2].title, "Safari");
});

test("parseSoftwareUpdateList reads older-format output with CRLF", () => {
  const [update] = parseSoftwareUpdateList(SOFTWAREUPDATE_OLDER);
  assert.equal(update.label, "Security Update 2021-008-10.15.7");
  assert.equal(update.sizeBytes, 1612340 * 1024);
  assert.equal(update.restartRequired, true);
});

test("parseSoftwareUpdateList returns nothing when no updates are offered", () => {
  assert.deepEqual(parseSoftwareUpdateList("Software Update Tool\n\nFinding available software\nNo new software available.\n"), []);
});

test("parseSoftwareUpdateList keeps a label whose detail line is unrecognised", () => {
  const [update] = parseSoftwareUpdateList("* Label: Something-1.0\n\tunexpected text\n");
  assert.equal(update.label, "Something-1.0");
  assert.equal(update.sizeBytes, null);
});

test("severityOf flags security and recommended macOS updates only", () => {
  const [macos, clt, safari] = parseSoftwareUpdateList(SOFTWAREUPDATE_CURRENT);
  const [security] = parseSoftwareUpdateList(SOFTWAREUPDATE_OLDER);
  assert.equal(severityOf(macos), "HIGH");
  assert.equal(severityOf(security), "HIGH");
  assert.equal(severityOf(clt), null);
  assert.equal(severityOf(safari), null);
});

test("update ids round-trip", () => {
  const id = buildUpdateId("macOS Sonoma 14.6.1-23G93");
  assert.equal(id, "macos:softwareupdate:macOS Sonoma 14.6.1-23G93");
  assert.equal(parseUpdateId(id), "macOS Sonoma 14.6.1-23G93");
  assert.equal(parseUpdateId("KB5034441"), null);
});

const SYSTEM_PROFILER = JSON.stringify({
  SPApplicationsDataType: [
    {
      _name: "Google Chrome",
      version: "129.0.6668.90",
      path: "/Applications/Google Chrome.app",
      lastModified: "2024-10-08T09:12:44Z",
      obtained_from: "identified_developer",
      signed_by: ["Developer ID Application: Google LLC (EQHXZ8M8AV)", "Developer ID Certification Authority", "Apple Root CA"],
    },
    {
      _name: "Terminal",
      version: "2.14",
      path: "/System/Applications/Utilities/Terminal.app",
      lastModified: "2024-09-01T00:00:00Z",
      obtained_from: "apple",
      signed_by: ["Software Signing", "Apple Code Signing Certification Authority", "Apple Root CA"],
    },
    {
      _name: "Slack",
      version: "4.40.128",
      path: "/Applications/Slack.app",
      obtained_from: "mac_app_store",
      signed_by: ["Apple Mac OS Application Signing", "Apple Worldwide Developer Relations Certification Authority", "Apple Root CA"],
    },
    {
      _name: "Notes Helper",
      version: "1.0",
      path: "/Users/alex/Applications/Notes Helper.app",
      obtained_from: "unknown",
    },
    // Helper app inside another app's bundle - not user-visible.
    { _name: "Simulator", version: "15.0", path: "/Applications/Xcode.app/Contents/Developer/Applications/Simulator.app" },
    // Framework helper outside the app folders.
    { _name: "Some Agent", version: "2.0", path: "/Library/Application Support/Vendor/Some Agent.app" },
    // Same app listed twice (e.g. a second copy) - reported once.
    { _name: "Google Chrome", version: "129.0.6668.90", path: "/Users/alex/Applications/Google Chrome.app" },
    { version: "1.0", path: "/Applications/Nameless.app" },
  ],
});

test("parseSystemProfilerApps keeps user-visible apps with publishers", () => {
  const apps = parseSystemProfilerApps(SYSTEM_PROFILER);
  assert.deepEqual(
    apps.map((a) => a.name),
    ["Google Chrome", "Notes Helper", "Slack", "Terminal"],
  );
  const chrome = apps.find((a) => a.name === "Google Chrome")!;
  assert.equal(chrome.publisher, "Google LLC");
  assert.equal(chrome.version, "129.0.6668.90");
  assert.equal(chrome.installDate, "2024-10-08");
  assert.equal(apps.find((a) => a.name === "Terminal")!.publisher, "Apple Inc.");
  assert.equal(apps.find((a) => a.name === "Slack")!.publisher, "Mac App Store");
  assert.equal(apps.find((a) => a.name === "Notes Helper")!.publisher, null);
});

test("parseSystemProfilerApps tolerates bad input", () => {
  assert.deepEqual(parseSystemProfilerApps("not json"), []);
  assert.deepEqual(parseSystemProfilerApps("{}"), []);
});
