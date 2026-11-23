// Signed agent replies and same-machine re-enrollment. Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { AGENT_SIGNING_PUBLIC_KEY, signAgentReply } from "../src/utils/agentResponseSigning";
import { isSameMachine } from "../src/services/enrollment.service";

// The agent side (httpClient.ts in each agent), reproduced: raw key -> SPKI, then verify.
function agentVerifies(publicKeyBase64: string, nonce: string, status: number, body: Buffer, signature: string): boolean {
  const key = crypto.createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKeyBase64, "base64")]),
    format: "der",
    type: "spki",
  });
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  return crypto.verify(null, Buffer.from(`EMSIG1\n${nonce}\n${status}\n${bodyHash}`, "utf8"), key, Buffer.from(signature, "base64"));
}

test("agent accepts a reply signed for its own request", () => {
  const nonce = crypto.randomBytes(16).toString("hex");
  const body = Buffer.from(JSON.stringify({ commandTasks: [{ id: "t1", script: "Get-Date" }] }), "utf8");
  const signature = signAgentReply(nonce, 200, body);
  assert.equal(Buffer.from(AGENT_SIGNING_PUBLIC_KEY, "base64").length, 32);
  assert.equal(agentVerifies(AGENT_SIGNING_PUBLIC_KEY, nonce, 200, body, signature), true);
});

test("agent rejects a changed body, status, replayed nonce or another key", () => {
  const nonce = crypto.randomBytes(16).toString("hex");
  const body = Buffer.from('{"commandTasks":[]}', "utf8");
  const signature = signAgentReply(nonce, 200, body);
  assert.equal(agentVerifies(AGENT_SIGNING_PUBLIC_KEY, nonce, 200, Buffer.from('{"commandTasks":[{"script":"x"}]}'), signature), false, "body");
  assert.equal(agentVerifies(AGENT_SIGNING_PUBLIC_KEY, nonce, 401, body, signature), false, "status");
  assert.equal(agentVerifies(AGENT_SIGNING_PUBLIC_KEY, "a".repeat(32), 200, body, signature), false, "nonce");
  const other = crypto.generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
  assert.equal(agentVerifies(other, nonce, 200, body, signature), false, "key");
});

test("re-enrollment reuses a record only for the same hardware", () => {
  const known = { serialNumber: "5CG1234XYZ", macAddress: "AA-BB-CC-DD-EE-FF" };
  assert.equal(isSameMachine(known, { serialNumber: "5cg1234xyz", macAddress: null }), true, "serial, any case");
  assert.equal(isSameMachine(known, { serialNumber: "OTHER", macAddress: "aa:bb:cc:dd:ee:ff" }), false, "a different serial wins over a matching MAC");
  assert.equal(isSameMachine(known, { serialNumber: null, macAddress: "aa:bb:cc:dd:ee:ff" }), true, "MAC when no serial is sent");
  assert.equal(isSameMachine(known, {}), false, "nothing sent (older agent, or someone with only a token)");
  assert.equal(isSameMachine({ serialNumber: "To Be Filled By O.E.M.", macAddress: null }, { serialNumber: "To Be Filled By O.E.M." }), false, "placeholder serial");
  assert.equal(isSameMachine({ serialNumber: null, macAddress: "00:00:00:00:00:00" }, { macAddress: "00-00-00-00-00-00" }), false, "empty MAC");
});
