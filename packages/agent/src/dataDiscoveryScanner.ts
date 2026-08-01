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

function expandEnvVars(rawPath: string): string {
  return rawPath.replace(/%([^%]+)%/g, (match, name: string) => process.env[name] ?? match);
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

function filterValidMatches(patternKey: string, matches: string[]): string[] {
  if (patternKey === "CREDIT_CARD") return matches.filter((m) => luhnValid(m.replace(/[ -]/g, "")));
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
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return null; // unreadable/locked/binary garbage that isn't valid utf8
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

  for (const policy of assigned) {
    try {
      const patterns = getPatternsForRegulation(policy.regulation);
      const findings: DataDiscoveryFileFinding[] = [];
      let filesScanned = 0;

      for (const rawPath of policy.targetPaths) {
        if (filesScanned >= DATA_DISCOVERY_MAX_FILES_PER_SCAN) break;
        const root = expandEnvVars(rawPath);
        const files = await collectFiles(root, DATA_DISCOVERY_MAX_FILES_PER_SCAN - filesScanned);
        for (const file of files) {
          filesScanned++;
          const finding = await scanFile(file, patterns);
          if (finding) findings.push(finding);
        }
      }

      const payload: DataDiscoveryScanResultPayload = {
        scannedAt: new Date().toISOString(),
        policyId: policy.policyId,
        filesScanned,
        findings,
      };
      await client.post("/api/agent/data-discovery/scan-result", payload);
    } catch (err) {
      console.error(`Failed to scan/report data discovery policy ${policy.policyId}`, err);
    }
  }
}
