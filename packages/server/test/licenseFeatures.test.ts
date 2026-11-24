// Licensing below the module (@license/shared features). Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import { LICENSE_FEATURES, allFeaturesOf, featureChanges, isFeatureLicensed, normalizeFeatures } from "@license/shared";

const DG = ["DATA_MANAGER"];

test("the catalogue is a well-formed tree", () => {
  const keys = new Set<string>();
  for (const f of LICENSE_FEATURES) {
    assert.ok(!keys.has(f.key), `duplicate ${f.key}`);
    keys.add(f.key);
    assert.ok(f.key.length <= 40);
  }
  for (const f of LICENSE_FEATURES) {
    if (!f.parent) continue;
    const parent = LICENSE_FEATURES.find((p) => p.key === f.parent);
    assert.ok(parent, `${f.key}: unknown parent`);
    assert.equal(parent!.module, f.module, `${f.key}: parent in another module`);
  }
});

test("no feature list means everything in the licensed modules, nothing outside them", () => {
  assert.equal(isFeatureLicensed("EPM_USB", DG, null), true);
  assert.equal(isFeatureLicensed("EPM_USB", ["SECURITY_MANAGER"], null), false);
  assert.equal(isFeatureLicensed("DG_DATA_TYPES", DG, []), true, "core comes with the module");
});

test("a feature needs itself and every sellable feature above it", () => {
  assert.equal(isFeatureLicensed("EPM_USB", DG, ["EPM", "EPM_USB"]), true);
  assert.equal(isFeatureLicensed("EPM_USB", DG, ["EPM_USB"]), false, "EPM itself not sold");
  assert.equal(isFeatureLicensed("EPM_IP", DG, ["EPM", "EPM_USB"]), false);
  assert.equal(isFeatureLicensed("EPM_APP_BLOCK", DG, ["EPM", "EPM_APP"]), true, "core part of App Control");
  assert.equal(isFeatureLicensed("EPM_ALLOWLIST", DG, ["EPM", "EPM_APP"]), false);
});

test("stored lists are cleaned up, and a full list is stored as everything", () => {
  assert.equal(normalizeFeatures(DG, allFeaturesOf(DG)), null);
  assert.equal(normalizeFeatures(DG, null), null);
  // Unknown, core, other-module and orphaned keys go.
  assert.deepEqual(normalizeFeatures(DG, ["EPM", "EPM_USB", "NOPE", "DG_DATA_TYPES", "SP_ZERO_TRUST", "DG_DLP_PII"]), ["EPM", "EPM_USB"]);
});

test("changes are found feature by feature", () => {
  const all = { modules: DG, features: null };
  const less = { modules: DG, features: allFeaturesOf(DG).filter((k) => k !== "EPM_USB") };
  assert.deepEqual(featureChanges(all, less), { added: [], removed: ["EPM_USB"] });
  assert.deepEqual(featureChanges(less, all), { added: ["EPM_USB"], removed: [] });
  assert.deepEqual(featureChanges(all, all), { added: [], removed: [] });
});
