// Application control -> Undefined applications: matching installed software to policies.
// Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogAppForSoftware } from "@em/shared";
import { isSystemComponent, ruleCovers, softwareBaseName } from "../src/services/appControlUndefined.service";

test("installed-software names lose their version and architecture", () => {
  assert.equal(softwareBaseName("WinRAR 7.01 (64-bit)"), "WinRAR");
  assert.equal(softwareBaseName("Microsoft Windows Desktop Runtime - 8.0.32 (x64)"), "Microsoft Windows Desktop Runtime");
  assert.equal(softwareBaseName("UltraViewer version 6.6"), "UltraViewer");
  assert.equal(softwareBaseName("Microsoft SQL Server 2019 (64-bit)"), "Microsoft SQL Server 2019");
  assert.equal(softwareBaseName("Google Chrome"), "Google Chrome");
});

test("drivers, runtimes, updates and server parts are hidden by default", () => {
  assert.ok(isSystemComponent({ name: "Realtek Audio Driver", publisher: "Realtek Semiconductor Corp." }));
  assert.ok(isSystemComponent({ name: "Microsoft Visual C++ 2015-2022 Redistributable (x64)", publisher: "Microsoft Corporation" }));
  assert.ok(isSystemComponent({ name: "SQL Server 2019 XEvent", publisher: "Microsoft Corporation" }));
  assert.ok(isSystemComponent({ name: "Intel(R) Management Engine Components", publisher: "Intel Corporation" }));
  assert.ok(!isSystemComponent({ name: "Google Chrome", publisher: "Google LLC" }));
  assert.ok(!isSystemComponent({ name: "SQL Server Management Studio", publisher: "Microsoft Corp." }));
});

test("the common-applications list recognises installed software, longest name first", () => {
  assert.equal(catalogAppForSoftware("Microsoft Visual Studio Code (User)")?.key, "vscode");
  assert.equal(catalogAppForSoftware("Microsoft Visual Studio Tools for Applications 2019")?.key, "ms-visual-studio");
  assert.equal(catalogAppForSoftware("Microsoft 365 Apps for business - en-us")?.key, "ms-office");
  assert.equal(catalogAppForSoftware("Git")?.key, "git");
  assert.equal(catalogAppForSoftware("GitHub Desktop"), undefined);
  assert.equal(catalogAppForSoftware("Python")?.key, "python");
});

test("which rules cover installed software", () => {
  const chrome = { name: "Google Chrome", publisher: "Google LLC" };
  const rule = (ruleType: string, value: string, productName: string | null = null) => ({ ruleType, value, productName });
  assert.ok(ruleCovers(rule("ALLOW_CATALOG", "chrome"), chrome));
  assert.ok(!ruleCovers(rule("ALLOW_CATALOG", "firefox"), chrome));
  assert.ok(ruleCovers(rule("ALLOW_PUBLISHER", "O=GOOGLE LLC, L=MOUNTAIN VIEW, S=CALIFORNIA, C=US"), chrome));
  assert.ok(ruleCovers(rule("ALLOW_PUBLISHER", "O=GOOGLE LLC, L=MOUNTAIN VIEW, S=CALIFORNIA, C=US", "Google Chrome"), chrome));
  assert.ok(!ruleCovers(rule("ALLOW_PUBLISHER", "O=GOOGLE LLC, L=MOUNTAIN VIEW, S=CALIFORNIA, C=US", "Google Drive"), chrome));
  assert.ok(ruleCovers(rule("PUBLISHER", "Google"), chrome));
  assert.ok(ruleCovers(rule("PRODUCT", "Google Chrome"), chrome));
  assert.ok(ruleCovers(rule("PRODUCT", "Google*"), chrome));
  assert.ok(ruleCovers(rule("EXECUTABLE", "AnyDesk.exe"), { name: "AnyDesk", publisher: "AnyDesk Software GmbH" }));
  assert.ok(!ruleCovers(rule("ALLOW_PATH", "C:\\Program Files\\Google\\*"), chrome), "inventory has no paths");
});
