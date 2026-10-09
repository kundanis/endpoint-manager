import fs from "node:fs/promises";
import path from "node:path";
import type { AxiosInstance } from "axios";
import type {
  AssignedDataDiscoveryPolicyWire,
  DataDiscoveryFileFinding,
  DataDiscoveryScanResultPayload,
  PiiPatternDefinition,
} from "@em/shared";
import {
  DATA_DISCOVERY_ALLOWED_EXTENSIONS,
  DATA_DISCOVERY_MAX_FILES_PER_SCAN,
  DATA_DISCOVERY_MAX_FILE_SIZE_BYTES,
  DATA_DISCOVERY_MAX_SAMPLES_PER_PATTERN,
  DATA_DISCOVERY_MAX_SCAN_DEPTH,
  getPatternsForRegulation,
} from "@em/shared";
import { extractOoxmlText, OOXML_EXTENSIONS } from "./ooxmlText";
import { listUserProfiles, resolveTargetPath } from "./userPaths";

// The server's scan-result schema accepts at most 1000 findings per report (and its
// stale-finding cleanup sends every reported path as a query parameter, under SQL
// Server's 2100 cap) — over that, the whole report would be rejected, so trim instead.
const MAX_FINDINGS_PER_REPORT = 1000;

// Masks a matched value down to a preview — enough to confirm a real match (and spot
// an obvious false positive) without the full sensitive value ever leaving the
// endpoint. Keeps the last few characters visible and blanks the rest, preserving any
// spaces/dashes so grouped formats (card numbers, Aadhaar) still read the same shape.
function maskMatch(patternKey: string, raw: string): string {
  if (patternKey === "EMAIL") {
    const at = raw.indexOf("@");
    if (at <= 0) return maskGeneric(raw);
    const local = raw.slice(0, at);
    const domain = raw.slice(at);
    return `${local[0]}${"*".repeat(Math.max(local.length - 1, 3))}${domain}`;
  }
  if (patternKey === "IP_ADDRESS") {
    const parts = raw.split(".");
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.•`;
    return maskGeneric(raw);
  }
  return maskGeneric(raw);
}

function maskGeneric(raw: string): string {
  const visibleCount = raw.length <= 4 ? 1 : 4;
  const cut = raw.length - visibleCount;
  return raw.slice(0, cut).replace(/[^\s-]/g, "•") + raw.slice(cut);
}

// Standard Luhn checksum — narrows the loose 13-16 digit CREDIT_CARD regex match down
// to numbers that are actually valid card numbers, not just any similarly-shaped digit run.
function luhnValid(digitsOnly: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let i = digitsOnly.length - 1; i >= 0; i--) {
    let n = Number(digitsOnly[i]);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

// Verhoeff checksum — every real Aadhaar number's last digit is one. Without it the
// 12-digit Aadhaar regex also fires on the first 12 digits of any card number, and on
// arbitrary 12-digit IDs, so nearly every card-holding file was also "Aadhaar".
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
function verhoeffValid(digitsOnly: string): boolean {
  let c = 0;
  const reversed = digitsOnly.split("").reverse();
  for (let i = 0; i < reversed.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(reversed[i])]];
  return c === 0;
}

function filterValidMatches(patternKey: string, matches: string[]): string[] {
  if (patternKey === "CREDIT_CARD") return matches.filter((m) => luhnValid(m.replace(/[ -]/g, "")));
  if (patternKey === "AADHAAR") return matches.filter((m) => verhoeffValid(m.replace(/[ -]/g, "")));
  if (patternKey === "IP_ADDRESS") return matches.filter((m) => m.split(".").every((octet) => Number(octet) <= 255));
  return matches;
}

async function collectFiles(root: string, maxFiles: number): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (results.length >= maxFiles || depth > DATA_DISCOVERY_MAX_SCAN_DEPTH) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // inaccessible dir (permissions, junction loop, etc.) — skip, don't fail the whole scan
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && DATA_DISCOVERY_ALLOWED_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
        results.push(full);
      }
    }
  }

  await walk(root, 0);
  return results;
}

// Returns match *counts* plus a capped handful of masked previews per pattern type —
// never the raw matched substrings themselves, so the unmasked personal data this
// scan finds is never what leaves the endpoint.
async function scanFile(filePath: string, patterns: PiiPatternDefinition[]): Promise<DataDiscoveryFileFinding | null> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return null;
  }
  if (stat.size === 0 || stat.size > DATA_DISCOVERY_MAX_FILE_SIZE_BYTES) return null;

  let content: string;
  try {
    if (OOXML_EXTENSIONS.includes(path.extname(filePath).toLowerCase())) {
      // .docx/.xlsx/.pptx are ZIP containers — scan the text inside, not the raw bytes.
      const text = extractOoxmlText(await fs.readFile(filePath));
      if (text === null) return null;
      content = text;
    } else {
      content = await fs.readFile(filePath, "utf8");
    }
  } catch {
    return null; // unreadable/locked (e.g. open in Office with an exclusive lock)
  }

  const matchCounts: Record<string, number> = {};
  const maskedSamples: Record<string, string[]> = {};
  for (const p of patterns) {
    const regex = new RegExp(p.pattern, "g");
    const rawMatches = content.match(regex) ?? [];
    const valid = filterValidMatches(p.key, rawMatches);
    if (valid.length > 0) {
      matchCounts[p.key] = valid.length;
      maskedSamples[p.key] = valid.slice(0, DATA_DISCOVERY_MAX_SAMPLES_PER_PATTERN).map((m) => maskMatch(p.key, m));
    }
  }

  const matchedPatternKeys = Object.keys(matchCounts);
  if (matchedPatternKeys.length === 0) return null;

  return {
    filePath,
    fileSizeBytes: stat.size,
    fileModifiedAt: stat.mtime.toISOString(),
    matchedPatternKeys,
    matchCounts,
    maskedSamples,
  };
}

// Same shape as zeroTrustScanner.ts/securityConfigScanner.ts (fetch assigned policies,
// scan locally, report results) but not a single graded check — this is an open-ended
// file-tree walk, so findings are keyed by file path rather than a fixed rule id, and
// every axis (files/depth/file size) is hard-capped so one large target folder can't
// stall the agent's scan cycle.
export async function runDataDiscoveryScan(client: AxiosInstance): Promise<void> {
  if (process.platform !== "win32") return;

  const { data: assigned } = await client.get<AssignedDataDiscoveryPolicyWire[]>("/api/agent/data-discovery/assigned");
  if (assigned.length === 0) return;

  // Read once per cycle — %USERPROFILE%-style policy paths fan out across every real user
  // on the machine (see userPaths.ts for why the agent's own environment is wrong here).
  const profiles = await listUserProfiles();

  for (const policy of assigned) {
    try {
      const patterns = getPatternsForRegulation(policy.regulation);
      const findings: DataDiscoveryFileFinding[] = [];
      let filesScanned = 0;
      const unresolvedPaths: string[] = [];

      for (const rawPath of policy.targetPaths) {
        if (filesScanned >= DATA_DISCOVERY_MAX_FILES_PER_SCAN) break;
        const roots = await resolveTargetPath(rawPath, profiles);
        if (roots.length === 0) unresolvedPaths.push(rawPath);
        for (const root of roots) {
          if (filesScanned >= DATA_DISCOVERY_MAX_FILES_PER_SCAN) break;
          const files = await collectFiles(root, DATA_DISCOVERY_MAX_FILES_PER_SCAN - filesScanned);
          for (const file of files) {
            filesScanned++;
            const finding = await scanFile(file, patterns);
            if (finding) findings.push(finding);
          }
        }
      }
      // Previously a wrong path silently produced "scanned, 0 files" — at least leave a
      // trace in the agent log for whichever target paths matched no folder at all.
      if (unresolvedPaths.length > 0) {
        console.warn(
          `Data discovery policy ${policy.policyId}: no existing folder for ${unresolvedPaths.join(", ")} ` +
            `(${profiles.length} user profile(s) found)`,
        );
      }

      if (findings.length > MAX_FINDINGS_PER_REPORT) {
        console.warn(
          `Data discovery policy ${policy.policyId}: ${findings.length} matching files, reporting the first ${MAX_FINDINGS_PER_REPORT}`,
        );
      }
      const payload: DataDiscoveryScanResultPayload = {
        scannedAt: new Date().toISOString(),
        policyId: policy.policyId,
        filesScanned,
        findings: findings.slice(0, MAX_FINDINGS_PER_REPORT),
      };
      await client.post("/api/agent/data-discovery/scan-result", payload);
    } catch (err) {
      console.error(`Failed to scan/report data discovery policy ${policy.policyId}`, err);
    }
  }
}
