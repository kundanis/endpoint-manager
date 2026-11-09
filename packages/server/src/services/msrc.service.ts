import { prisma } from "../db";
import { logger } from "../logger";
import { MSRC_MAPPING_VERSION, msrcFamilyOf } from "../data/softwareProductMap";

// Microsoft Security Update Guide (public CVRF API, no key needed). One document per month;
// each lists, per CVE, the products affected and - for most products - the build that fixes it.
// We keep only the fixes for products we can recognise on an endpoint (msrcFamilyOf), which is
// a few thousand rows rather than the millions of per-Windows-SKU rows in the feed.
const MSRC_BASE_URL = "https://api.msrc.microsoft.com/cvrf/v3.0";

// Documents before this are not read. Software older than this is still caught: every later
// CVE's fixed build is above its version too.
const MSRC_FIRST_DOCUMENT_YEAR = 2022;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface MsrcUpdateListing {
  ID: string;
  CurrentReleaseDate: string;
}

async function fetchJson(url: string, attempt = 1): Promise<any> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(300_000) });
    if (!res.ok) throw new Error(`Microsoft security update API answered ${res.status} for ${url}`);
    return await res.json();
  } catch (err) {
    if (attempt >= 3) throw err;
    await new Promise((r) => setTimeout(r, attempt * 5000));
    return fetchJson(url, attempt + 1);
  }
}

function documentIsInScope(id: string): boolean {
  const m = id.match(/^(\d{4})-([A-Za-z]{3})$/);
  return !!m && Number(m[1]) >= MSRC_FIRST_DOCUMENT_YEAR && MONTHS.includes(m[2]);
}

function severityFromScore(score: number | null): string | null {
  if (score === null) return null;
  if (score >= 9) return "CRITICAL";
  if (score >= 7) return "HIGH";
  if (score >= 4) return "MEDIUM";
  if (score > 0) return "LOW";
  return null;
}

interface ParsedFix {
  cveId: string;
  familyKey: string;
  productName: string;
  fixedBuild: string;
  kbArticle: string | null;
}

interface ParsedCveInfo {
  title: string;
  cvssBaseScore: number | null;
  cvssVector: string | null;
  releasedAt: Date;
}

export function parseMsrcDocument(doc: any): { fixes: ParsedFix[]; cves: Map<string, ParsedCveInfo> } {
  const names = new Map<string, string>();
  for (const p of doc?.ProductTree?.FullProductName ?? []) names.set(p.ProductID, p.Value);
  const familyByProductId = new Map<string, string>();
  for (const [id, name] of names) {
    const family = msrcFamilyOf(name);
    if (family) familyByProductId.set(id, family);
  }

  const fixes: ParsedFix[] = [];
  const cves = new Map<string, ParsedCveInfo>();
  const seen = new Set<string>();
  for (const v of doc?.Vulnerability ?? []) {
    const cveId: string | undefined = v.CVE;
    if (!cveId || !/^CVE-\d{4}-\d+$/.test(cveId)) continue;
    let found = false;
    for (const r of v.Remediations ?? []) {
      if (r.Type !== 2) continue; // 2 = Vendor Fix
      const fixedBuild = String(r.FixedBuild ?? "").trim();
      if (!/^\d+(\.\d+)+$/.test(fixedBuild)) continue; // e.g. Office points to a web page instead
      const kb = String(r.Description?.Value ?? "").trim();
      for (const productId of r.ProductID ?? []) {
        const familyKey = familyByProductId.get(productId);
        if (!familyKey) continue;
        // .NET rows list the SDK release (8.0.427: feature band 4xx) next to the runtime
        // (8.0.32). Endpoints report runtimes, so SDK numbers would make every runtime look old.
        if (/^(dotnet-runtime|aspnetcore)-/.test(familyKey) && Number(fixedBuild.split(".")[2] ?? 0) >= 100) continue;
        const productName = names.get(productId)!;
        const key = `${cveId}|${productName}|${fixedBuild}`;
        if (seen.has(key)) continue;
        seen.add(key);
        fixes.push({ cveId, familyKey, productName, fixedBuild, kbArticle: /^\d{6,8}$/.test(kb) ? kb : null });
        found = true;
      }
    }
    if (!found) continue;
    const scores = (v.CVSSScoreSets ?? []).filter((s: any) => typeof s.BaseScore === "number");
    const best = scores.sort((a: any, b: any) => b.BaseScore - a.BaseScore)[0];
    const released = v.RevisionHistory?.[0]?.Date ?? doc?.DocumentTracking?.InitialReleaseDate;
    cves.set(cveId, {
      title: String(v.Title?.Value ?? cveId),
      cvssBaseScore: best ? best.BaseScore : null,
      cvssVector: best?.Vector ?? null,
      releasedAt: released ? new Date(released) : new Date(),
    });
  }
  return { fixes, cves };
}

// CVEs Microsoft lists that the NVD catalog doesn't have yet (not synced, or newer than the
// last NVD sync) get a catalog entry from Microsoft's own data, so findings can point at them.
// An existing NVD entry is never overwritten.
async function ensureDefinitions(cves: Map<string, ParsedCveInfo>): Promise<Map<string, string>> {
  const ids = [...cves.keys()];
  const byCve = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await prisma.vulnerabilityDefinition.findMany({ where: { cveId: { in: ids.slice(i, i + 1000) } }, select: { id: true, cveId: true } });
    for (const r of rows) byCve.set(r.cveId, r.id);
  }
  for (const cveId of ids) {
    if (byCve.has(cveId)) continue;
    const info = cves.get(cveId)!;
    const created = await prisma.vulnerabilityDefinition.upsert({
      where: { cveId },
      create: {
        cveId,
        description: `${info.title} (from Microsoft's Security Update Guide)`,
        cvssVersion: info.cvssVector?.startsWith("CVSS:3.1") ? "3.1" : info.cvssVector?.startsWith("CVSS:3.0") ? "3.0" : null,
        cvssBaseScore: info.cvssBaseScore,
        cvssSeverity: severityFromScore(info.cvssBaseScore),
        cvssVector: info.cvssVector,
        publishedAt: info.releasedAt,
        lastModifiedAt: info.releasedAt,
      },
      update: {},
      select: { id: true },
    });
    byCve.set(cveId, created.id);
  }
  return byCve;
}

async function syncDocument(id: string, currentReleaseDate: Date): Promise<number> {
  const doc = await fetchJson(`${MSRC_BASE_URL}/cvrf/${encodeURIComponent(id)}`);
  const { fixes, cves } = parseMsrcDocument(doc);
  const definitionIds = await ensureDefinitions(cves);

  await prisma.$transaction(async (tx) => {
    await tx.msrcProductFix.deleteMany({ where: { documentId: id } });
    for (let i = 0; i < fixes.length; i += 500) {
      await tx.msrcProductFix.createMany({
        data: fixes.slice(i, i + 500).map((f) => ({
          documentId: id,
          cveId: f.cveId,
          vulnerabilityDefinitionId: definitionIds.get(f.cveId)!,
          familyKey: f.familyKey,
          productName: f.productName,
          fixedBuild: f.fixedBuild,
          kbArticle: f.kbArticle,
        })),
      });
    }
    await tx.msrcDocument.upsert({
      where: { id },
      create: { id, currentReleaseDate, mappingVersion: MSRC_MAPPING_VERSION, fixCount: fixes.length },
      update: { currentReleaseDate, mappingVersion: MSRC_MAPPING_VERSION, fixCount: fixes.length, syncedAt: new Date() },
    });
  }, { timeout: 120_000 });
  return fixes.length;
}

// Reads every monthly document that is new, revised by Microsoft since we read it, or read
// under an older product mapping. Progress goes into the VulnerabilitySyncRun row (mode MSRC):
// pagesFetched = documents read, cveUpsertedCount = fixes stored.
export async function runMsrcSync(syncRunId: string): Promise<void> {
  let documents = 0;
  let fixes = 0;
  try {
    const listing = await fetchJson(`${MSRC_BASE_URL}/updates`);
    const updates: MsrcUpdateListing[] = (listing?.value ?? []).filter((u: MsrcUpdateListing) => documentIsInScope(u.ID));
    const known = new Map((await prisma.msrcDocument.findMany()).map((d) => [d.id, d]));

    for (const u of updates) {
      const releasedAt = new Date(u.CurrentReleaseDate);
      const have = known.get(u.ID);
      if (have && have.mappingVersion === MSRC_MAPPING_VERSION && have.currentReleaseDate.getTime() >= releasedAt.getTime()) continue;
      fixes += await syncDocument(u.ID, releasedAt);
      documents++;
      await prisma.vulnerabilitySyncRun.update({ where: { id: syncRunId }, data: { pagesFetched: documents, cveUpsertedCount: fixes } });
    }
    invalidateMsrcCache();
    await prisma.vulnerabilitySyncRun.update({
      where: { id: syncRunId },
      data: { status: "SUCCESS", completedAt: new Date(), pagesFetched: documents, cveUpsertedCount: fixes },
    });
  } catch (err) {
    logger.error({ err, syncRunId }, "Microsoft security update sync failed");
    invalidateMsrcCache();
    await prisma.vulnerabilitySyncRun.update({
      where: { id: syncRunId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        pagesFetched: documents,
        cveUpsertedCount: fixes,
        errorMessage: `${err instanceof Error ? err.message : String(err)}${documents > 0 ? ` (${documents} document(s) read before the error were kept)` : ""}`,
      },
    });
  }
}

export async function triggerMsrcSync(triggeredByAdminId: string): Promise<{ syncRunId: string }> {
  const run = await prisma.vulnerabilitySyncRun.create({
    data: { triggeredByAdminId, windowStartAt: new Date(Date.UTC(MSRC_FIRST_DOCUMENT_YEAR, 0, 1)), windowEndAt: new Date(), mode: "MSRC" },
  });
  void runMsrcSync(run.id);
  return { syncRunId: run.id };
}

// ---- Fixes per product family, cached for matching (every check-in matches an endpoint).

export interface MsrcFix {
  vulnerabilityDefinitionId: string;
  cveId: string;
  productName: string;
  fixedBuild: string;
  kbArticle: string | null;
}

let cache: Map<string, MsrcFix[]> | null = null;
let cacheLoading: Promise<Map<string, MsrcFix[]>> | null = null;

export function invalidateMsrcCache(): void {
  cache = null;
  cacheLoading = null;
}

export async function getMsrcFixesByFamily(): Promise<Map<string, MsrcFix[]>> {
  if (cache) return cache;
  if (!cacheLoading) {
    cacheLoading = (async () => {
      const rows = await prisma.msrcProductFix.findMany({
        select: { familyKey: true, vulnerabilityDefinitionId: true, cveId: true, productName: true, fixedBuild: true, kbArticle: true },
      });
      const map = new Map<string, MsrcFix[]>();
      for (const r of rows) {
        const list = map.get(r.familyKey) ?? [];
        list.push(r);
        map.set(r.familyKey, list);
      }
      cache = map;
      return map;
    })().catch((err) => {
      cacheLoading = null;
      throw err;
    });
  }
  return cacheLoading;
}
