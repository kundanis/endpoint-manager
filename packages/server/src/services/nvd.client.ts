import { NVD_API_BASE_URL, NVD_MAX_DATE_RANGE_DAYS, NVD_RESULTS_PER_PAGE, NVD_UNAUTH_DELAY_MS } from "@em/shared";
import { config } from "../config";
import { logger } from "../logger";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const requestDelayMs = config.nvdApiKey ? config.nvdRequestDelayMs : NVD_UNAUTH_DELAY_MS;

export interface ParsedCveCpeMatch {
  criteria: string;
  part: string;
  vendorNormalized: string;
  productNormalized: string;
  productCompact: string;
  versionExact: string | null;
  versionStartIncluding: string | null;
  versionStartExcluding: string | null;
  versionEndIncluding: string | null;
  versionEndExcluding: string | null;
  vulnerable: boolean;
}

export interface ParsedCve {
  cveId: string;
  description: string;
  cvssVersion: string | null;
  cvssBaseScore: number | null;
  cvssSeverity: string | null;
  cvssVector: string | null;
  publishedAt: string;
  lastModifiedAt: string;
  cpeMatches: ParsedCveCpeMatch[];
}

// Splits a CPE 2.3 criteria string on unescaped ':' — good enough for a heuristic matcher;
// full CPE binding-escape fidelity isn't needed since we only read vendor/product/version.
function splitCpeCriteria(criteria: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < criteria.length; i++) {
    if (criteria[i] === "\\" && i + 1 < criteria.length) {
      current += criteria[i + 1];
      i++;
    } else if (criteria[i] === ":") {
      parts.push(current);
      current = "";
    } else {
      current += criteria[i];
    }
  }
  parts.push(current);
  return parts;
}

function normalizeToken(raw: string | undefined): string {
  if (!raw || raw === "*" || raw === "-") return "";
  return raw.replace(/_/g, " ").toLowerCase().trim();
}

interface CvssPick {
  version: string;
  score: number;
  severity: string | null;
  vector: string | null;
}

// Fallback precedence v3.1 -> v3.0 -> v4.0 -> v2: v3.1 remains the most consistently
// populated historical record; v4.0 isn't retroactively backfilled onto older CVEs.
function pickBestCvss(metrics: Record<string, unknown> | undefined): CvssPick | null {
  const order: Array<[string, string]> = [
    ["cvssMetricV31", "3.1"],
    ["cvssMetricV30", "3.0"],
    ["cvssMetricV40", "4.0"],
    ["cvssMetricV2", "2.0"],
  ];

  for (const [key, version] of order) {
    const arr = metrics?.[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const entry = arr.find((m: { type?: string }) => m.type === "Primary") ?? arr[0];
    const data = entry?.cvssData;
    if (!data) continue;
    return {
      version,
      score: data.baseScore,
      severity: data.baseSeverity ?? entry.baseSeverity ?? null,
      vector: data.vectorString ?? null,
    };
  }
  return null;
}

export function parseCveItem(item: any): ParsedCve {
  const cve = item.cve;
  const description = (cve.descriptions ?? []).find((d: { lang: string }) => d.lang === "en")?.value ?? "";
  const cvss = pickBestCvss(cve.metrics);

  const cpeMatches: ParsedCveCpeMatch[] = [];
  for (const configuration of cve.configurations ?? []) {
    for (const node of configuration.nodes ?? []) {
      for (const match of node.cpeMatch ?? []) {
        const parts = splitCpeCriteria(match.criteria ?? "");
        const part = parts[2] || "a";
        const vendorNormalized = normalizeToken(parts[3]);
        const productNormalized = normalizeToken(parts[4]);
        const versionField = parts[5];
        if (!productNormalized) continue;

        cpeMatches.push({
          criteria: match.criteria,
          part,
          vendorNormalized,
          productNormalized,
          productCompact: productNormalized.replace(/[^a-z0-9]/g, ""),
          versionExact: versionField && versionField !== "*" && versionField !== "-" ? versionField : null,
          versionStartIncluding: match.versionStartIncluding ?? null,
          versionStartExcluding: match.versionStartExcluding ?? null,
          versionEndIncluding: match.versionEndIncluding ?? null,
          versionEndExcluding: match.versionEndExcluding ?? null,
          vulnerable: match.vulnerable !== false,
        });
      }
    }
  }

  return {
    cveId: cve.id,
    description,
    cvssVersion: cvss?.version ?? null,
    cvssBaseScore: cvss?.score ?? null,
    cvssSeverity: cvss?.severity ?? null,
    cvssVector: cvss?.vector ?? null,
    publishedAt: cve.published,
    lastModifiedAt: cve.lastModified,
    cpeMatches,
  };
}

async function fetchPage(params: URLSearchParams, attempt = 1): Promise<any> {
  const res = await fetch(`${NVD_API_BASE_URL}?${params.toString()}`, {
    headers: config.nvdApiKey ? { apiKey: config.nvdApiKey } : {},
  });

  if (res.status === 429 || res.status === 403) {
    if (attempt > 5) throw new Error(`NVD API rate-limited after ${attempt} attempts`);
    const backoffMs = requestDelayMs * 2 ** attempt;
    logger.warn({ status: res.status, attempt, backoffMs }, "NVD API rate limited, backing off");
    await sleep(backoffMs);
    return fetchPage(params, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(`NVD API request failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function* chunkDateRange(start: Date, end: Date): Generator<[Date, Date]> {
  let cursor = new Date(start);
  const maxMs = (NVD_MAX_DATE_RANGE_DAYS - 1) * 86_400_000; // stay under the 120-day limit
  while (cursor < end) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + maxMs, end.getTime()));
    yield [cursor, chunkEnd];
    cursor = chunkEnd;
  }
}

export interface CvePage {
  cves: ParsedCve[];
  totalResults: number;
  fetchedSoFar: number;
}

export async function* iterateCves(opts: {
  mode: "PUBLISHED" | "LAST_MODIFIED";
  startAt: Date;
  endAt: Date;
}): AsyncGenerator<CvePage> {
  for (const [chunkStart, chunkEnd] of chunkDateRange(opts.startAt, opts.endAt)) {
    let startIndex = 0;
    let totalResults = Infinity;

    while (startIndex < totalResults) {
      const params = new URLSearchParams({
        resultsPerPage: String(NVD_RESULTS_PER_PAGE),
        startIndex: String(startIndex),
        ...(opts.mode === "PUBLISHED"
          ? { pubStartDate: chunkStart.toISOString(), pubEndDate: chunkEnd.toISOString() }
          : { lastModStartDate: chunkStart.toISOString(), lastModEndDate: chunkEnd.toISOString() }),
      });

      const page = await fetchPage(params);
      totalResults = page.totalResults ?? 0;
      const cves = (page.vulnerabilities ?? []).map(parseCveItem);

      startIndex += NVD_RESULTS_PER_PAGE;
      yield { cves, totalResults, fetchedSoFar: Math.min(startIndex, totalResults) };

      if (startIndex < totalResults) await sleep(requestDelayMs);
    }
  }
}
