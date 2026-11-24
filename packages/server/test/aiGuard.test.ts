// AI Guard: catalogue safety and matching. Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_APP_CATALOG, hostMatchesDomain, processNameOf } from "@em/shared";
import { aiGuardRuleId } from "../src/services/aiGuard.service";

// Blocking any of these would break normal work far beyond AI.
const SHARED_PLATFORMS = ["google.com", "microsoft.com", "github.com", "openai.com", "x.com", "office.com", "bing.com", "amazon.com", "apple.com"];

test("the catalogue never blocks a shared platform", () => {
  for (const app of AI_APP_CATALOG) {
    for (const d of app.domains) assert.ok(!SHARED_PLATFORMS.includes(d), `${app.key} lists ${d}`);
  }
});

test("catalogue entries are well formed", () => {
  const keys = new Set<string>();
  for (const app of AI_APP_CATALOG) {
    assert.ok(!keys.has(app.key), `duplicate key ${app.key}`);
    keys.add(app.key);
    assert.ok(app.domains.length + app.executables.length > 0, `${app.key} has nothing to match`);
    for (const d of app.domains) assert.match(d, /^([a-z0-9-]+\.)+[a-z]{2,}$/, `${app.key}: bad domain ${d}`);
    for (const e of app.executables) assert.match(e, /^[a-z0-9 ._-]+\.exe$/, `${app.key}: bad program ${e}`);
  }
});

test("website and program matching", () => {
  assert.equal(hostMatchesDomain("chatgpt.com", "chatgpt.com"), true);
  assert.equal(hostMatchesDomain("www.ChatGPT.com", "chatgpt.com"), true);
  assert.equal(hostMatchesDomain("chat.deepseek.com", "deepseek.com"), true);
  assert.equal(hostMatchesDomain("notchatgpt.com", "chatgpt.com"), false, "no partial-label match");
  assert.equal(hostMatchesDomain("chatgpt.com.evil.net", "chatgpt.com"), false);
  assert.equal(processNameOf("ChatGPT.exe"), "chatgpt");
  assert.equal(processNameOf("lm studio"), "lm studio");
});

test("AI Guard rule ids are stable GUIDs", () => {
  const id = aiGuardRuleId("chatgpt", "ChatGPT.exe");
  assert.equal(id, aiGuardRuleId("chatgpt", "chatgpt.exe"));
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(id, aiGuardRuleId("claude", "claude.exe"));
});

// ---- Phase 3: AI add-on recognition ----
import { aiComponentKey, isAiComponent } from "@em/shared";

test("AI browser and editor extensions are recognised, ordinary ones aren't", () => {
  assert.equal(isAiComponent("BROWSER_EXTENSION", "a".repeat(32), "ChatGPT for Google"), true);
  assert.equal(isAiComponent("BROWSER_EXTENSION", "b".repeat(32), "Monica - Your AI Copilot"), true);
  assert.equal(isAiComponent("BROWSER_EXTENSION", "c".repeat(32), "Adblock Plus"), false);
  assert.equal(isAiComponent("BROWSER_EXTENSION", "d".repeat(32), "Gmail Mail Checker"), false, "'ai' inside a word");
  assert.equal(isAiComponent("BROWSER_EXTENSION", "e".repeat(32), "Endpoint IQ Browser Guard"), false);
  assert.equal(isAiComponent("BROWSER_EXTENSION", "f".repeat(32), "Claude", ["f".repeat(32)]), false, "own ids never");
  assert.equal(isAiComponent("IDE_EXTENSION", "github.copilot", "GitHub Copilot"), true);
  assert.equal(isAiComponent("IDE_EXTENSION", "ms-python.python", "Python"), false);
  assert.equal(isAiComponent("CLI_TOOL", "@anthropic-ai/claude-code", "@anthropic-ai/claude-code"), true);
  assert.equal(isAiComponent("CLI_TOOL", "typescript", "typescript"), false);
});

test("add-on policy keys are stable and lower case", () => {
  assert.equal(aiComponentKey("IDE_EXTENSION", "vscode", "GitHub.Copilot"), "addon:IDE_EXTENSION:vscode:github.copilot");
});
