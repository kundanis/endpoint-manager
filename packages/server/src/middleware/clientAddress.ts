import net from "node:net";
import type { Request } from "express";
import { config } from "../config";

// The real client address when the server sits behind Cloudflare's proxy (TRUSTED_PROXY=cloudflare).
//
// Behind the proxy every request's TCP peer is a Cloudflare server, so the admin-console
// allowlist, logs and remote-access records would all see Cloudflare instead of the user.
// Cloudflare passes the visitor's address in CF-Connecting-IP - but that header is only
// believed when the TCP peer really is in Cloudflare's published ranges. A request sent
// straight to the server's IP is judged on its own peer address, so nobody can bypass
// Cloudflare and claim to be an allowed address by setting the header themselves.
//
// Ranges: https://www.cloudflare.com/ips/ (unchanged for years; update here if they publish
// new ones - a missing range only means those edges are treated as ordinary clients).
const CLOUDFLARE_V4 = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];
const CLOUDFLARE_V6 = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

const cloudflare = new net.BlockList();
for (const cidr of CLOUDFLARE_V4) {
  const [addr, prefix] = cidr.split("/");
  cloudflare.addSubnet(addr, Number(prefix), "ipv4");
}
for (const cidr of CLOUDFLARE_V6) {
  const [addr, prefix] = cidr.split("/");
  cloudflare.addSubnet(addr, Number(prefix), "ipv6");
}

function unmapped(address: string): string {
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

export function isCloudflareAddress(address: string | undefined): boolean {
  if (!address) return false;
  const a = unmapped(address);
  if (net.isIPv4(a)) return cloudflare.check(a, "ipv4");
  if (net.isIPv6(a)) return cloudflare.check(a, "ipv6");
  return false;
}

export const behindCloudflare = config.trustedProxy === "cloudflare";

// For Express's "trust proxy" setting: trust X-Forwarded-For only from Cloudflare's edges.
export function trustCloudflare(address: string): boolean {
  return isCloudflareAddress(address);
}

export function clientAddress(req: Request): string | undefined {
  const peer = req.socket.remoteAddress;
  if (!behindCloudflare || !isCloudflareAddress(peer)) return peer;
  const header = req.headers["cf-connecting-ip"];
  const value = (Array.isArray(header) ? header[0] : header)?.trim();
  return value && net.isIP(value) ? value : peer;
}
