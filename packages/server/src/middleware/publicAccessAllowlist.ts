import net from "node:net";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../logger";

// This server is reachable from the internet (NAT) for two things: the Outlook add-in, for
// users outside the office, and the agent API, so endpoints off the office network (WAN /
// work-from-home) keep checking in via the public IP or web URL (see agent connection
// settings). The agent API needs no admin credential - enrollment requires a valid
// single-purpose token and everything else a per-agent API key. Everything else — the admin
// console, login, admin API — stays internal-network only: one admin login controls command
// execution on every endpoint; it shouldn't be reachable for password guessing from the
// whole internet.
//
// Decided on the TCP peer address (req.socket.remoteAddress), never on X-Forwarded-For —
// there's no reverse proxy in front of this server, so that header is attacker-controlled.
// If the perimeter firewall ever source-NATs inbound traffic to an internal address, every
// request will look internal and this check silently stops applying (it fails open, it
// never locks admins out) — verify with the request log after any firewall change.

const PUBLIC_PATH_PREFIXES = ["/outlook-addin/", "/api/email-addin/", "/api/agent/"];
const PUBLIC_EXACT_PATHS = new Set(["/health"]);

const privateIpv4 = new net.BlockList();
privateIpv4.addSubnet("10.0.0.0", 8, "ipv4");
privateIpv4.addSubnet("172.16.0.0", 12, "ipv4");
privateIpv4.addSubnet("192.168.0.0", 16, "ipv4");
privateIpv4.addSubnet("127.0.0.0", 8, "ipv4");
privateIpv4.addSubnet("169.254.0.0", 16, "ipv4"); // link-local

const privateIpv6 = new net.BlockList();
privateIpv6.addAddress("::1", "ipv6");
privateIpv6.addSubnet("fc00::", 7, "ipv6"); // unique local
privateIpv6.addSubnet("fe80::", 10, "ipv6"); // link-local

export function isInternalAddress(address: string | undefined): boolean {
  if (!address) return false;
  // IPv4 clients on a dual-stack socket show up as ::ffff:a.b.c.d
  const v4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (net.isIPv4(v4)) return privateIpv4.check(v4, "ipv4");
  if (net.isIPv6(address)) return privateIpv6.check(address, "ipv6");
  return false;
}

export function isPublicPath(path: string): boolean {
  return PUBLIC_EXACT_PATHS.has(path) || PUBLIC_PATH_PREFIXES.some((p) => path.startsWith(p));
}

// One warning per address per hour — enough to notice probing without flooding the log.
const lastWarnedAt = new Map<string, number>();
const WARN_INTERVAL_MS = 60 * 60 * 1000;

export function publicAccessAllowlist(req: Request, res: Response, next: NextFunction) {
  const peer = req.socket.remoteAddress;
  if (isInternalAddress(peer) || isPublicPath(req.path)) return next();

  const now = Date.now();
  const key = peer ?? "unknown";
  if ((lastWarnedAt.get(key) ?? 0) + WARN_INTERVAL_MS < now) {
    lastWarnedAt.set(key, now);
    if (lastWarnedAt.size > 10_000) lastWarnedAt.clear();
    logger.warn({ peer, path: req.path }, "Blocked request from a public address to an internal-only path");
  }
  // 404 rather than 403: don't confirm to an outside scanner that a console exists here.
  res.status(404).json({ error: "Not found" });
}
