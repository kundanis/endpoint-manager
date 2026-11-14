// Remote install: the admin account is typed in full, or left out to use the saved one. Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import { setRemoteInstallAccountRequestSchema, startRemoteInstallRequestSchema } from "@em/shared";

test("remote install takes both username and password, or neither (saved account)", () => {
  const base = { serverUrl: "https://srv:4000", targets: ["PC-01"] };
  assert.equal(startRemoteInstallRequestSchema.safeParse(base).success, true, "neither: use the saved account");
  assert.equal(startRemoteInstallRequestSchema.safeParse({ ...base, username: "CORP\\installer", password: "x" }).success, true, "both");
  assert.equal(startRemoteInstallRequestSchema.safeParse({ ...base, username: "CORP\\installer" }).success, false, "username only");
  assert.equal(startRemoteInstallRequestSchema.safeParse({ ...base, password: "x" }).success, false, "password only");
});

test("saving the remote install account needs a username; the password may be left out to keep the saved one", () => {
  assert.equal(setRemoteInstallAccountRequestSchema.safeParse({ username: "CORP\\installer", password: "secret" }).success, true);
  assert.equal(setRemoteInstallAccountRequestSchema.safeParse({ username: "CORP\\installer" }).success, true);
  assert.equal(setRemoteInstallAccountRequestSchema.safeParse({ username: "  ", password: "secret" }).success, false);
});
