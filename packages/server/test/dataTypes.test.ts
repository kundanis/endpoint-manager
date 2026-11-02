// Data types catalogue and value handling. Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUILT_IN_DATA_TYPES,
  DATA_TYPE_RULE_TYPES,
  PII_PATTERN_KEYS,
  createDataTypeRequestSchema,
  normalizeDataTypeValue,
  targetsForDataType,
} from "@em/shared";

test("built-in catalogue is well formed", () => {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const d of BUILT_IN_DATA_TYPES) {
    assert.ok(d.id.startsWith("builtin:"), d.id);
    assert.ok(!ids.has(d.id) && !names.has(d.name), `duplicate ${d.id}`);
    ids.add(d.id);
    names.add(d.name);
    assert.ok(d.values.length > 0, d.id);
    assert.equal(new Set(d.values.map((v) => v.toLowerCase())).size, d.values.length, `duplicate value in ${d.id}`);
    assert.ok(targetsForDataType(d).length > 0, `${d.id} can't be added anywhere`);
    if (d.kind === "FILE_EXTENSION") for (const v of d.values) assert.match(v, /^\.[a-z0-9]+$/, `${d.id}: ${v}`);
    if (d.kind === "DOMAIN") for (const v of d.values) assert.match(v, /^[a-z0-9.-]+\.[a-z]{2,}$/, `${d.id}: ${v}`);
    if (d.kind === "PII_PATTERN") for (const v of d.values) assert.ok((PII_PATTERN_KEYS as readonly string[]).includes(v), `${d.id}: ${v}`);
    for (const v of d.values) assert.ok(v.length <= 255, `${d.id}: ${v} too long for a rule`);
  }
});

test("file types go to DLP only - executables too (as app control rules they'd stop Windows)", () => {
  const byId = (id: string) => BUILT_IN_DATA_TYPES.find((d) => d.id === id)!;
  assert.deepEqual(targetsForDataType(byId("builtin:office-documents")), ["dlp"]);
  assert.deepEqual(targetsForDataType(byId("builtin:executables-scripts")), ["dlp"]);
  assert.deepEqual(targetsForDataType(byId("builtin:india-pii")).sort(), ["dlp", "piiBlock", "piiEmailBlock"]);
  assert.deepEqual(targetsForDataType(byId("builtin:remote-access-apps")).sort(), ["appControl", "commandBlock"]);
  assert.equal(DATA_TYPE_RULE_TYPES.dlp.PII_PATTERN, "CONTENT_PATTERN");
  assert.equal(DATA_TYPE_RULE_TYPES.appControl.PROCESS_NAME, "EXECUTABLE");
});

test("custom values are normalised", () => {
  assert.equal(normalizeDataTypeValue("FILE_EXTENSION", "*.PY"), ".py");
  assert.equal(normalizeDataTypeValue("FILE_EXTENSION", "xlsx"), ".xlsx");
  assert.equal(normalizeDataTypeValue("DOMAIN", "https://Mail.Example.com/inbox?x=1"), "mail.example.com");
  assert.equal(normalizeDataTypeValue("DOMAIN", "*.example.net"), "example.net");
  assert.equal(normalizeDataTypeValue("PROCESS_NAME", " AnyDesk.exe "), "AnyDesk.exe");
});

test("custom data types can't be personal-data patterns", () => {
  assert.equal(createDataTypeRequestSchema.safeParse({ name: "x", kind: "PII_PATTERN", values: ["AADHAAR"] }).success, false);
  assert.equal(createDataTypeRequestSchema.safeParse({ name: "x", kind: "DOMAIN", values: ["a.com"] }).success, true);
});

test("applying data types adds each value once, as the right rule type", async () => {
  const { applyDataTypes } = await import("../src/services/dataTypes.service");
  const { BUILT_IN_DATA_TYPES: builtIns, targetsForDataType: targets } = await import("@em/shared");
  const views = builtIns.map((d) => ({ ...d, description: d.description, builtIn: true, targets: targets(d) }));
  const created: { ruleType: string; value: string; label: string }[] = [];
  const fakeDb = {
    appControlPolicy: { findUnique: async () => ({ id: "p1" }) },
    appControlRule: {
      // The policy already blocks AnyDesk.
      findMany: async () => [{ ruleType: "EXECUTABLE", value: "anydesk.exe" }],
      createMany: async (args: { data: { ruleType: string; value: string; label: string }[] }) => created.push(...args.data),
    },
  };
  const result = await applyDataTypes(
    { target: "appControl", policyId: "p1", dataTypeIds: ["builtin:remote-access-apps", "builtin:office-documents"] },
    { db: fakeDb as never, dataTypes: views },
  );
  const remote = builtIns.find((d) => d.id === "builtin:remote-access-apps")!;
  assert.equal(result.skipped, 1); // AnyDesk.exe, matched case-insensitively
  assert.equal(result.added, remote.values.length - 1);
  assert.deepEqual(result.incompatible, ["Office documents"]); // documents never go to app control
  assert.ok(created.every((r) => r.ruleType === "EXECUTABLE" && r.label === "Remote access tools"));
  assert.ok(!created.some((r) => r.value === "AnyDesk.exe"));
});

test("applying only the picked values of a data type", async () => {
  const { applyDataTypes } = await import("../src/services/dataTypes.service");
  const { BUILT_IN_DATA_TYPES: builtIns, targetsForDataType: targets } = await import("@em/shared");
  const views = builtIns.map((d) => ({ ...d, description: d.description, builtIn: true, targets: targets(d) }));
  const created: { value: string }[] = [];
  const fakeDb = {
    appControlPolicy: { findUnique: async () => ({ id: "p1" }) },
    appControlRule: {
      findMany: async () => [],
      createMany: async (args: { data: { value: string }[] }) => created.push(...args.data),
    },
  };
  const result = await applyDataTypes(
    { target: "appControl", policyId: "p1", dataTypeIds: ["builtin:remote-access-apps"], values: ["anydesk.exe", "TeamViewer.exe"] },
    { db: fakeDb as never, dataTypes: views },
  );
  assert.equal(result.added, 2);
  assert.deepEqual(created.map((r) => r.value).sort(), ["AnyDesk.exe", "TeamViewer.exe"]);
  await assert.rejects(
    applyDataTypes({ target: "appControl", policyId: "p1", dataTypeIds: ["builtin:remote-access-apps"], values: ["notepad.exe"] }, { db: fakeDb as never, dataTypes: views }),
  );
});
