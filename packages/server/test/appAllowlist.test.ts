// Allowlist policies (application control): combining policies, rule checks, and reading a program
// file the way Windows does. Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import type { AppControlPolicy, AppControlRule } from "@prisma/client";
import {
  DEFAULT_MICROSOFT_PRODUCTS,
  NotAProgramError,
  appControlRuleProblem,
  createAppControlPolicyRequestSchema,
  readPeFileInfo,
} from "@em/shared";
import { combineAllowlists, expandCatalogRule } from "../src/services/appControlScan.service";
import { APP_CATALOG } from "@em/shared";

const policy = (over: Partial<AppControlPolicy>, rules: Partial<AppControlRule>[] = []) => ({
  id: "p",
  name: "p",
  description: null,
  enabled: true,
  mode: "ALLOWLIST",
  allowlistEnforcement: "AUDIT",
  allowProgramFiles: false,
  exemptAdministrators: false,
  microsoftSigned: "OFF",
  microsoftProducts: null,
  createdByAdminId: null,
  createdAt: new Date(),
  ...over,
  rules: rules.map((r, i) => ({
    id: `r${i}`,
    policyId: "p",
    ruleType: "ALLOW_PATH",
    value: "D:\\Apps",
    label: null,
    publisher: null,
    productName: null,
    fileName: null,
    versionMatch: null,
    version: null,
    fileSize: null,
    createdAt: new Date(),
    ...r,
  })),
});

test("common applications become folder (and known publisher) rules with fixed GUIDs", () => {
  const chrome = expandCatalogRule("chrome");
  assert.ok(chrome.some((r) => r.ruleType === "ALLOW_PATH" && r.value === "%PROGRAMFILES%\\Google\\Chrome\\*"));
  assert.ok(chrome.some((r) => r.ruleType === "ALLOW_PUBLISHER" && r.productName === "Google Chrome"));
  assert.deepEqual(expandCatalogRule("chrome"), chrome);
  for (const r of chrome) assert.match(r.ruleId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(expandCatalogRule("nope"), []);
  // Every catalog folder is under Program Files (only administrators can write there).
  for (const app of APP_CATALOG) for (const p of app.paths) assert.ok(p.startsWith("%PROGRAMFILES%\\"), `${app.key}: ${p}`);
  assert.equal(appControlRuleProblem("ALLOW_CATALOG", "chrome"), null);
  assert.notEqual(appControlRuleProblem("ALLOW_CATALOG", "nope"), null);
  const combined = combineAllowlists([policy({}, [{ ruleType: "ALLOW_CATALOG", value: "chrome" }])])!;
  assert.equal(combined.rules.length, chrome.length);
});

test("allowlists combine: allows add up, and they always block", () => {
  assert.equal(combineAllowlists([]), undefined);
  const a = combineAllowlists([
    policy({ allowProgramFiles: true, microsoftSigned: "SELECTED" }, [{ value: "D:\\Apps" }]),
    policy({ allowlistEnforcement: "ENFORCE", microsoftSigned: "SELECTED", microsoftProducts: JSON.stringify(["Contoso Tool"]) }, [{ value: "d:\\apps" }]),
  ])!;
  assert.equal(a.enforce, true);
  assert.equal(combineAllowlists([policy({})])!.enforce, true, "an allowlist always blocks what it doesn't allow");
  assert.equal(a.allowProgramFiles, true);
  assert.equal(a.exemptAdministrators, false);
  assert.equal(a.microsoftSigned, "SELECTED");
  assert.deepEqual(a.microsoftProducts.sort(), [...DEFAULT_MICROSOFT_PRODUCTS, "Contoso Tool"].sort());
  assert.equal(a.rules.length, 1, "the same path in two policies is one rule");
  assert.equal(combineAllowlists([policy({ microsoftSigned: "SELECTED" }), policy({ microsoftSigned: "ALL" })])!.microsoftSigned, "ALL");
});

test("hash and publisher rule checks; policies default to block lists", () => {
  assert.equal(appControlRuleProblem("ALLOW_HASH", "ab".repeat(32)), null);
  assert.notEqual(appControlRuleProblem("ALLOW_HASH", "abc"), null);
  assert.equal(appControlRuleProblem("ALLOW_PUBLISHER", "O=GOOGLE LLC, L=MOUNTAIN VIEW, S=CALIFORNIA, C=US"), null);
  assert.notEqual(appControlRuleProblem("ALLOW_PUBLISHER", "Google"), null);
  assert.equal(createAppControlPolicyRequestSchema.parse({ name: "x" }).mode, "BLOCK");
});

test("a non-program file is refused", () => {
  assert.throws(() => readPeFileInfo(new Uint8Array(200)), NotAProgramError);
});

// Matches Windows' own reading (Get-AppLockerFileInformation) of Node.js 24.15.0 on the build PC.
const NODE = "C:\\Program Files\\nodejs\\node.exe";
test("program file: signer, product, version and Windows' hash", { skip: !fs.existsSync(NODE) || process.version !== "v24.15.0" }, () => {
  const bytes = new Uint8Array(fs.readFileSync(NODE));
  const info = readPeFileInfo(bytes);
  assert.equal(info.publisher, "O=OPENJS FOUNDATION, L=SAN FRANCISCO, S=CALIFORNIA, C=US");
  assert.equal(info.productName, "Node.js");
  assert.equal(info.originalFileName, "node.exe");
  assert.equal(info.fileVersion, "24.15.0.0");
  const h = createHash("sha256");
  for (const [s, e] of info.hashRanges) h.update(bytes.subarray(s, e));
  assert.equal(h.digest("hex").toUpperCase(), "259992DB5CA633DD99F5114C51B0C669EEF75868B9AC523BB6EDE9DF4D762D9E");
});
