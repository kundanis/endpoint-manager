import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config";

// Agents may reach this server over plain HTTP (the LAN address is preferred), so TLS alone
// can't stop someone on the same network from answering in the server's place and handing
// out commands that run as SYSTEM/root. Every reply to an agent is therefore signed with an
// Ed25519 key only this server holds; agents remember the public key the first time they
// see it (enrollment, or the first check-in after upgrading) and from then on reject any
// reply that isn't signed by it.
//
// The key is derived from FIELD_ENCRYPTION_KEY rather than stored separately: that secret
// already has to survive every upgrade and restore (losing it makes the encrypted columns
// unreadable), so tying the signing key to it adds no new thing to back up. The HKDF label
// keeps the two uses independent.
//
// The agent sends a fresh random nonce with each request and the signature covers it, the
// HTTP status and a hash of the exact body bytes - so a recorded reply can't be replayed to
// another request or another agent, and neither the status nor the body can be altered.

const NONCE_HEADER = "x-em-nonce";
const NONCE_PATTERN = /^[A-Za-z0-9]{16,128}$/;
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

const seed = Buffer.from(crypto.hkdfSync("sha256", config.fieldEncryptionKey, Buffer.alloc(0), "endpoint-agent-response-signing-v1", 32));
const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" });
// The raw 32-byte key is the last 32 bytes of its SPKI encoding.
const publicKeyRaw = crypto.createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32);

export const AGENT_SIGNING_PUBLIC_KEY = publicKeyRaw.toString("base64");

export function signedMessage(nonce: string, status: number, body: Buffer): Buffer {
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  return Buffer.from(`EMSIG1\n${nonce}\n${status}\n${bodyHash}`, "utf8");
}

export function signAgentReply(nonce: string, status: number, body: Buffer): string {
  return crypto.sign(null, signedMessage(nonce, status, body), privateKey).toString("base64");
}

// Mounted ahead of everything so replies produced by rate limiters, auth failures and the
// error handler are signed too. Only requests carrying a nonce (i.e. agents at a version
// that verifies) are affected. Streamed file downloads don't go through res.send and stay
// unsigned - the agent checks those against the SHA-256 given in the (signed) task instead.
export function signAgentResponses(req: Request, res: Response, next: NextFunction): void {
  const nonce = req.get(NONCE_HEADER);
  if (!nonce || !NONCE_PATTERN.test(nonce)) return next();
  const send = res.send.bind(res);
  res.send = ((body?: unknown) => {
    // res.json / res.send(object) come back through here with the serialized string, which
    // is the call that gets signed.
    if (!res.headersSent && (body === undefined || typeof body === "string" || Buffer.isBuffer(body))) {
      const bytes = body === undefined ? Buffer.alloc(0) : typeof body === "string" ? Buffer.from(body, "utf8") : body;
      res.setHeader("X-EM-Signature", signAgentReply(nonce, res.statusCode, bytes));
      res.setHeader("X-EM-Server-Key", AGENT_SIGNING_PUBLIC_KEY);
    }
    return send(body);
  }) as Response["send"];
  next();
}
