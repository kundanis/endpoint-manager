import fs from "node:fs/promises";
import path from "node:path";
import type { AxiosInstance } from "axios";
import type { AssignedDlpPolicyWire, DlpEventBatchPayload, DlpEventPayload } from "@em/shared";
import { DLP_EVENTS_FILE_NAME, DLP_POLICY_FILE_NAME } from "@em/shared";
import { agentConfig } from "./config";

const MAX_EVENTS_PER_REQUEST = 200; // matches dlpEventBatchPayloadSchema's cap

function policyFilePath(): string {
  return path.join(agentConfig.stateDir, DLP_POLICY_FILE_NAME);
}

function eventsFilePath(): string {
  return path.join(agentConfig.stateDir, DLP_EVENTS_FILE_NAME);
}

// Phase 1 plumbing only — no native sidecar exists yet to read/write these files. This
// agent never inspects file content itself; it just relays policy to, and events from,
// whatever native process (Phase 2) does the actual real-time interception. A plain
// local-file handoff rather than a socket/named pipe: simplest to implement, and easy
// to hand-simulate for testing (append a line by hand) before that sidecar exists.
export async function syncDlpPolicy(client: AxiosInstance): Promise<void> {
  const { data: assigned } = await client.get<AssignedDlpPolicyWire[]>("/api/agent/dlp/assigned");
  await fs.mkdir(agentConfig.stateDir, { recursive: true });
  await fs.writeFile(policyFilePath(), JSON.stringify(assigned, null, 2), "utf8");
}

// Rotates the events file via rename before reading, rather than read-then-truncate —
// an atomic rename means a concurrently-writing sidecar (expected to open, append one
// line, and close per event rather than hold a long-lived handle) simply starts a fresh
// file on its next write instead of racing us for the same file handle, so no event
// gets silently dropped in the gap between our read and our clear.
export async function flushDlpEvents(client: AxiosInstance): Promise<void> {
  const current = eventsFilePath();
  const rotated = `${current}.flushing`;

  try {
    await fs.rename(current, rotated);
  } catch {
    return; // no file yet (no sidecar running, or nothing new since last flush)
  }

  let raw: string;
  try {
    const rawWithBom = await fs.readFile(rotated, "utf8");
    // Same defensive strip as config.ts's readInstallConfig — some writers (including
    // Windows PowerShell's `-Encoding utf8`) emit a leading BOM that JSON.parse rejects.
    raw = rawWithBom.charCodeAt(0) === 0xfeff ? rawWithBom.slice(1) : rawWithBom;
  } finally {
    await fs.rm(rotated, { force: true });
  }
  if (!raw.trim()) return;

  const events: DlpEventPayload[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch (err) {
      console.error("Skipping malformed DLP event line", err);
    }
  }
  if (events.length === 0) return;

  for (let i = 0; i < events.length; i += MAX_EVENTS_PER_REQUEST) {
    const payload: DlpEventBatchPayload = { events: events.slice(i, i + MAX_EVENTS_PER_REQUEST) };
    await client.post("/api/agent/dlp/events", payload);
  }
  console.log(`Forwarded ${events.length} DLP event(s)`);
}
