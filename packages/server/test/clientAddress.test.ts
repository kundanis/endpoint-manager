// Client address behind Cloudflare (TRUSTED_PROXY=cloudflare). Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";

process.env.TRUSTED_PROXY = "cloudflare";
process.env.ADMIN_ALLOWED_NETWORKS = "203.0.113.7";

function req(peer: string, cfConnectingIp?: string): Request {
  return {
    socket: { remoteAddress: peer },
    headers: cfConnectingIp ? { "cf-connecting-ip": cfConnectingIp } : {},
  } as unknown as Request;
}

test("a request from Cloudflare is judged on the visitor's address", async () => {
  const { clientAddress } = await import("../src/middleware/clientAddress");
  const { isAllowedAdminAddress } = await import("../src/middleware/publicAccessAllowlist");
  // 172.68.54.10 is the Cloudflare edge seen in the customer's log
  assert.equal(clientAddress(req("::ffff:172.68.54.10", "203.0.113.7")), "203.0.113.7");
  assert.equal(isAllowedAdminAddress(clientAddress(req("::ffff:172.68.54.10", "203.0.113.7"))), true);
  // another visitor through the same edge is not allowed
  assert.equal(isAllowedAdminAddress(clientAddress(req("::ffff:172.68.54.10", "198.51.100.9"))), false);
  // IPv6 visitor and IPv6 edge
  assert.equal(clientAddress(req("2606:4700:10::ac43:1", "2405:201:14:780d::1")), "2405:201:14:780d::1");
});

test("the header is ignored unless the request really comes from Cloudflare", async () => {
  const { clientAddress } = await import("../src/middleware/clientAddress");
  const { isAllowedAdminAddress } = await import("../src/middleware/publicAccessAllowlist");
  // someone hitting the server's IP directly and forging the header
  assert.equal(clientAddress(req("::ffff:198.51.100.9", "203.0.113.7")), "::ffff:198.51.100.9");
  assert.equal(isAllowedAdminAddress(clientAddress(req("::ffff:198.51.100.9", "203.0.113.7"))), false);
  // the Cloudflare edge itself is not an allowed admin address
  assert.equal(isAllowedAdminAddress("::ffff:172.68.54.10"), false);
  // garbage in the header falls back to the peer
  assert.equal(clientAddress(req("::ffff:172.68.54.10", "not-an-ip")), "::ffff:172.68.54.10");
  // internal clients keep working
  assert.equal(isAllowedAdminAddress(clientAddress(req("::ffff:10.10.7.252"))), true);
});
