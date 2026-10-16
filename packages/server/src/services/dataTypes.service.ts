import {
  BUILT_IN_DATA_TYPES,
  DATA_TYPE_RULE_TYPES,
  normalizeDataTypeValue,
  targetsForDataType,
  type ApplyDataTypesRequest,
  type CreateDataTypeRequest,
  type DataTypeKind,
  type DataTypeTarget,
  type DataTypeView,
  type UpdateDataTypeRequest,
} from "@em/shared";
import { prisma } from "../db";
import {
  createAppControlPolicyRequestSchema,
  createCommandBlockPolicyRequestSchema,
  createDlpPolicyRequestSchema,
  createPiiBlockPolicyRequestSchema,
  createPiiEmailBlockPolicyRequestSchema,
  createWebBlockPolicyRequestSchema,
} from "@em/shared";
import { createPolicy as createDlpPolicy } from "./dlpPolicy.service";
import { createPolicy as createPiiEmailBlockPolicy } from "./piiEmailBlockPolicy.service";
import { createPolicy as createAppControlPolicy } from "./appControlPolicy.service";
import { createPolicy as createWebBlockPolicy } from "./webBlockPolicy.service";
import { createPolicy as createPiiBlockPolicy } from "./piiBlockPolicy.service";
import { createPolicy as createCommandBlockPolicy } from "./commandBlockPolicy.service";

// Data Governance -> Data types: the built-in catalogue (code) plus admin-defined data types
// (DataType table), and "Add from data type" - turning a data type's values into rules on a
// DLP or EPM policy.

export class DataTypeError extends Error {}

function toView(row: { id: string; name: string; category: string | null; description: string | null; kind: string; values: string }): DataTypeView {
  const kind = row.kind as DataTypeKind;
  return {
    id: row.id,
    name: row.name,
    category: row.category || "Custom",
    description: row.description,
    kind,
    values: JSON.parse(row.values) as string[],
    builtIn: false,
    targets: targetsForDataType({ kind }),
  };
}

export async function listDataTypes(): Promise<DataTypeView[]> {
  const custom = await prisma.dataType.findMany({ orderBy: { name: "asc" } });
  const builtIn: DataTypeView[] = BUILT_IN_DATA_TYPES.map((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    description: d.description,
    kind: d.kind,
    values: d.values,
    builtIn: true,
    targets: targetsForDataType(d),
  }));
  return [...builtIn, ...custom.map(toView)];
}

// Normalised, de-duplicated (case-insensitively) values for a custom data type.
function cleanValues(kind: DataTypeKind, values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = normalizeDataTypeValue(kind, raw);
    if (!v || v === "." || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  if (out.length === 0) throw new DataTypeError("Add at least one value.");
  return out;
}

async function assertNameFree(name: string, exceptId?: string) {
  if (BUILT_IN_DATA_TYPES.some((d) => d.name.toLowerCase() === name.toLowerCase())) {
    throw new DataTypeError(`"${name}" is the name of a built-in data type - choose another name.`);
  }
  const existing = await prisma.dataType.findFirst({ where: { name } });
  if (existing && existing.id !== exceptId) throw new DataTypeError(`A data type named "${name}" already exists.`);
}

export async function createDataType(params: CreateDataTypeRequest, createdByAdminId: string): Promise<DataTypeView> {
  await assertNameFree(params.name);
  const row = await prisma.dataType.create({
    data: {
      name: params.name,
      category: params.category || null,
      description: params.description || null,
      kind: params.kind,
      values: JSON.stringify(cleanValues(params.kind, params.values)),
      createdByAdminId,
    },
  });
  return toView(row);
}

export async function updateDataType(id: string, params: UpdateDataTypeRequest): Promise<DataTypeView | null> {
  const existing = await prisma.dataType.findUnique({ where: { id } });
  if (!existing) return null;
  if (params.name && params.name !== existing.name) await assertNameFree(params.name, id);
  const kind = (params.kind ?? existing.kind) as DataTypeKind;
  const values = params.values ?? (JSON.parse(existing.values) as string[]);
  const row = await prisma.dataType.update({
    where: { id },
    data: {
      name: params.name ?? undefined,
      category: params.category === undefined ? undefined : params.category || null,
      description: params.description === undefined ? undefined : params.description || null,
      kind,
      values: JSON.stringify(cleanValues(kind, values)),
    },
  });
  return toView(row);
}

export async function deleteDataType(id: string): Promise<boolean> {
  const result = await prisma.dataType.deleteMany({ where: { id } });
  return result.count > 0;
}

// The rule table and policy table for each target (all share { policyId, ruleType, value, label }).
const TARGET_TABLES: Record<DataTypeTarget, { rule: string; policy: string }> = {
  dlp: { rule: "dlpRule", policy: "dlpPolicy" },
  piiEmailBlock: { rule: "piiEmailBlockRule", policy: "piiEmailBlockPolicy" },
  appControl: { rule: "appControlRule", policy: "appControlPolicy" },
  webBlock: { rule: "webBlockRule", policy: "webBlockPolicy" },
  piiBlock: { rule: "piiBlockRule", policy: "piiBlockPolicy" },
  commandBlock: { rule: "commandBlockRule", policy: "commandBlockPolicy" },
};

// A new policy in the given area, with that module's own defaults (DLP and command blocking
// start in alert-only mode; nothing is enforced until the policy is assigned).
async function createTargetPolicy(target: DataTypeTarget, name: string, adminId: string): Promise<string> {
  const base = { name, description: "Created from Data types." };
  const created = await (async () => {
    switch (target) {
      case "dlp":
        return createDlpPolicy(createDlpPolicyRequestSchema.parse(base), adminId);
      case "piiEmailBlock":
        return createPiiEmailBlockPolicy(createPiiEmailBlockPolicyRequestSchema.parse(base), adminId);
      case "appControl":
        return createAppControlPolicy(createAppControlPolicyRequestSchema.parse(base), adminId);
      case "webBlock":
        return createWebBlockPolicy(createWebBlockPolicyRequestSchema.parse(base), adminId);
      case "piiBlock":
        return createPiiBlockPolicy(createPiiBlockPolicyRequestSchema.parse(base), adminId);
      case "commandBlock":
        return createCommandBlockPolicy(createCommandBlockPolicyRequestSchema.parse(base), adminId);
    }
  })();
  if (!created) throw new DataTypeError("The policy could not be created.");
  return (created as { id: string }).id;
}

// Policies in an area, for the "Use in policy" picker.
export async function listTargetPolicies(target: DataTypeTarget): Promise<{ id: string; name: string }[]> {
  const db = prisma as unknown as Record<string, { findMany(args: object): Promise<{ id: string; name: string }[]> }>;
  return db[TARGET_TABLES[target].policy].findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
}

interface RuleDelegate {
  findMany(args: { where: { policyId: string }; select: { ruleType: true; value: true } }): Promise<{ ruleType: string; value: string }[]>;
  createMany(args: { data: { policyId: string; ruleType: string; value: string; label: string }[] }): Promise<unknown>;
}
interface PolicyDelegate {
  findUnique(args: { where: { id: string }; select: { id: true } }): Promise<{ id: string } | null>;
}

// Adds every value of the chosen data types to the policy as rules of the matching type,
// skipping values the policy already has (so applying twice adds nothing). Each rule's label
// is the data type's name, so the policy shows where a rule came from.
export async function applyDataTypes(
  params: ApplyDataTypesRequest,
  // Injectable for tests; defaults to the real database and data type list.
  deps: { db?: Record<string, RuleDelegate & PolicyDelegate>; dataTypes?: DataTypeView[]; adminId?: string } = {},
): Promise<{ added: number; skipped: number; incompatible: string[]; policyId: string }> {
  const tables = TARGET_TABLES[params.target];
  const db = deps.db ?? (prisma as unknown as Record<string, RuleDelegate & PolicyDelegate>);
  const policyId = params.policyId ?? (await createTargetPolicy(params.target, params.newPolicyName!, deps.adminId ?? ""));
  const policy = await db[tables.policy].findUnique({ where: { id: policyId }, select: { id: true } });
  if (!policy) throw new DataTypeError("Policy not found.");

  const all = deps.dataTypes ?? (await listDataTypes());
  const chosen = params.dataTypeIds.map((id) => all.find((d) => d.id === id));
  if (chosen.some((d) => !d)) throw new DataTypeError("One of the chosen data types no longer exists.");

  const existing = await db[tables.rule].findMany({ where: { policyId }, select: { ruleType: true, value: true } });
  const have = new Set(existing.map((r) => `${r.ruleType}|${r.value.toLowerCase()}`));

  const toCreate: { policyId: string; ruleType: string; value: string; label: string }[] = [];
  const incompatible: string[] = [];
  let skipped = 0;
  for (const dt of chosen as DataTypeView[]) {
    const ruleType = dt.targets.includes(params.target) ? DATA_TYPE_RULE_TYPES[params.target][dt.kind] : undefined;
    if (!ruleType) {
      incompatible.push(dt.name);
      continue;
    }
    for (const value of dt.values) {
      const key = `${ruleType}|${value.toLowerCase()}`;
      if (have.has(key)) {
        skipped++;
        continue;
      }
      have.add(key);
      toCreate.push({ policyId, ruleType, value, label: dt.name.slice(0, 200) });
    }
  }
  if (toCreate.length > 0) await db[tables.rule].createMany({ data: toCreate });
  return { added: toCreate.length, skipped, incompatible, policyId };
}
