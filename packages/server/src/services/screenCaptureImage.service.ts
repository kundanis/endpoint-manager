import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { SCREEN_CAPTURE_IMAGE_MAX_BYTES } from "@em/shared";
import { config } from "../config";
import { prisma } from "../db";
import { logger } from "../logger";
import { resolveAssignedAgentIdsForPolicy } from "./screenCapturePolicy.service";

// Screen capture images. When a policy is set to keep images for an endpoint, the agent uploads
// each new screenshot; it is stored as a file under <uploads>/screen-captures/<agentId>/ and
// linked from its ScreenCaptureEvent. Only super admins can view, download or delete them (see
// screenCapture.routes.ts). Each image is deleted after the shortest "keep images for" of the
// policies that keep images for its endpoint, or earlier by an admin.

const IMAGES_DIR = () => path.join(config.uploadsDir, "screen-captures");
const DEFAULT_RETENTION_DAYS = 30; // images of endpoints no policy keeps images for any more

type PolicyForImages = { id: string; saveImages: boolean; saveImagesAllEndpoints: boolean; saveImagesAgentIds: string; imageRetentionDays: number; enabled: boolean };

function policyKeepsImagesFor(p: PolicyForImages, agentId: string): boolean {
  if (!p.enabled || !p.saveImages) return false;
  return p.saveImagesAllEndpoints || (JSON.parse(p.saveImagesAgentIds) as string[]).includes(agentId);
}

// Whether the agent should upload images, given the enabled policies assigned to it.
export function shouldSaveImages(policies: PolicyForImages[], agentId: string): boolean {
  return policies.some((p) => policyKeepsImagesFor(p, agentId));
}

// Recognised by content, not by the name the endpoint gave the file.
function imageType(data: Buffer): { ext: string; contentType: string } | null {
  if (data.length < 12) return null;
  if (data[0] === 0x89 && data.toString("ascii", 1, 4) === "PNG") return { ext: ".png", contentType: "image/png" };
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { ext: ".jpg", contentType: "image/jpeg" };
  if (data.toString("ascii", 0, 4) === "GIF8") return { ext: ".gif", contentType: "image/gif" };
  if (data.toString("ascii", 0, 2) === "BM") return { ext: ".bmp", contentType: "image/bmp" };
  if (data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return { ext: ".webp", contentType: "image/webp" };
  return null;
}

const CONTENT_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".bmp": "image/bmp", ".webp": "image/webp" };

export type StoreImageResult = "stored" | "not-wanted" | "no-capture" | "invalid";

// The agent's upload for one screenshot, matched to the capture it reported earlier.
export async function storeImage(agentId: string, filePath: string, capturedAt: Date, data: Buffer): Promise<StoreImageResult> {
  if (data.length === 0 || data.length > SCREEN_CAPTURE_IMAGE_MAX_BYTES) return "invalid";
  const type = imageType(data);
  if (!type) return "invalid";

  // Still wanted? The policy may have been changed since the agent last asked.
  const { resolveAssignedForAgent } = await import("./screenCaptureEvent.service");
  if (!(await resolveAssignedForAgent(agentId)).saveImages) return "not-wanted";

  const event = await prisma.screenCaptureEvent.findUnique({
    where: { agentId_filePath_capturedAt: { agentId, filePath, capturedAt } },
    select: { id: true, imageFile: true },
  });
  if (!event) return "no-capture";
  if (event.imageFile) return "stored"; // a retried upload

  const dir = path.join(IMAGES_DIR(), agentId);
  await fs.mkdir(dir, { recursive: true });
  const fileName = `${event.id}${type.ext}`;
  await fs.writeFile(path.join(dir, fileName), data);
  await prisma.screenCaptureEvent.update({
    where: { id: event.id },
    data: { imageFile: fileName, imageSizeBytes: BigInt(data.length), imageSavedAt: new Date() },
  });
  return "stored";
}

function imagePathOf(agentId: string, imageFile: string): string {
  // imageFile is "<uuid>.<ext>" written by storeImage; basename() keeps it inside the folder regardless.
  return path.join(IMAGES_DIR(), agentId, path.basename(imageFile));
}

function downloadName(e: { capturedAt: Date; username: string; imageFile: string }, hostname: string | null): string {
  const stamp = e.capturedAt.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_");
  return `${safe(hostname ?? "endpoint")}_${safe(e.username)}_${stamp}${path.extname(e.imageFile)}`;
}

export async function getImage(eventId: string) {
  const e = await prisma.screenCaptureEvent.findUnique({
    where: { id: eventId },
    select: { agentId: true, username: true, capturedAt: true, imageFile: true, agent: { select: { hostname: true } } },
  });
  if (!e?.imageFile) return null;
  const absPath = imagePathOf(e.agentId, e.imageFile);
  try {
    await fs.access(absPath);
  } catch {
    return null;
  }
  return {
    absPath,
    contentType: CONTENT_TYPES[path.extname(e.imageFile).toLowerCase()] ?? "application/octet-stream",
    fileName: downloadName({ capturedAt: e.capturedAt, username: e.username, imageFile: e.imageFile }, e.agent.hostname),
    username: e.username,
    hostname: e.agent.hostname,
  };
}

// The saved images of the given screenshots, as one zip.
export async function zipImages(eventIds: string[]): Promise<{ data: Buffer; count: number } | null> {
  const events = await prisma.screenCaptureEvent.findMany({
    where: { id: { in: eventIds }, imageFile: { not: null } },
    select: { agentId: true, username: true, capturedAt: true, imageFile: true, agent: { select: { hostname: true } } },
    orderBy: { capturedAt: "asc" },
  });
  const zip = new AdmZip();
  let count = 0;
  const used = new Set<string>();
  for (const e of events) {
    try {
      const data = await fs.readFile(imagePathOf(e.agentId, e.imageFile!));
      let name = downloadName({ capturedAt: e.capturedAt, username: e.username, imageFile: e.imageFile! }, e.agent.hostname);
      for (let i = 2; used.has(name); i++) name = name.replace(/(\.[^.]+)$/, `_${i}$1`);
      used.add(name);
      zip.addFile(name, data);
      count++;
    } catch {
      // file already gone - skip
    }
  }
  return count > 0 ? { data: zip.toBuffer(), count } : null;
}

// Deletes the image files; the screenshot records (time, user, file name...) stay.
export async function deleteImages(eventIds: string[]): Promise<number> {
  const events = await prisma.screenCaptureEvent.findMany({
    where: { id: { in: eventIds }, imageFile: { not: null } },
    select: { id: true, agentId: true, imageFile: true },
  });
  for (const e of events) {
    await fs.rm(imagePathOf(e.agentId, e.imageFile!), { force: true });
    await prisma.screenCaptureEvent.update({ where: { id: e.id }, data: { imageFile: null, imageSizeBytes: null, imageSavedAt: null } });
  }
  return events.length;
}

// Every image older than what the policies covering its endpoint allow.
export async function purgeExpiredImages(): Promise<number> {
  const policies = await prisma.screenCapturePolicy.findMany({ where: { enabled: true, saveImages: true } });
  const retentionByAgent = new Map<string, number>();
  for (const p of policies) {
    for (const agentId of await resolveAssignedAgentIdsForPolicy(p.id)) {
      if (!policyKeepsImagesFor(p, agentId)) continue;
      retentionByAgent.set(agentId, Math.min(retentionByAgent.get(agentId) ?? Infinity, p.imageRetentionDays));
    }
  }
  const withImages = await prisma.screenCaptureEvent.findMany({
    where: { imageFile: { not: null } },
    select: { id: true, agentId: true, imageSavedAt: true },
  });
  const now = Date.now();
  const expired = withImages
    .filter((e) => {
      const days = retentionByAgent.get(e.agentId) ?? DEFAULT_RETENTION_DAYS;
      return !e.imageSavedAt || now - e.imageSavedAt.getTime() > days * 86_400_000;
    })
    .map((e) => e.id);
  let deleted = 0;
  for (let i = 0; i < expired.length; i += 500) deleted += await deleteImages(expired.slice(i, i + 500));
  return deleted;
}

export function scheduleScreenCaptureImageRetention(): void {
  const run = () =>
    purgeExpiredImages()
      .then((n) => {
        if (n > 0) logger.info({ deleted: n }, "Screen capture: expired images deleted");
      })
      .catch((err) => logger.error({ err }, "Screen capture: image retention failed"));
  setTimeout(run, 60_000);
  setInterval(run, 60 * 60_000);
}

// Endpoint deleted: its images go with it.
export async function removeAgentImages(agentId: string): Promise<void> {
  await fs.rm(path.join(IMAGES_DIR(), path.basename(agentId)), { recursive: true, force: true });
}
