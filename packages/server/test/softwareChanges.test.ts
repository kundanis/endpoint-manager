// Endpoint History: software changes found by comparing inventory reports. Run with: npm test -w @em/server
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffSoftware } from "../src/services/checkin.service";

const app = (name: string, version: string | null = "1.0") => ({ name, version, publisher: "Acme", installDate: null });

test("software changes: installs, removals and version updates", () => {
  const changes = diffSoftware([app("Zoom", "5.1"), app("7-Zip"), app("Notepad++")], [app("zoom", "5.2"), app("7-Zip"), app("VLC")]);
  const by = Object.fromEntries(changes.map((c) => [c.name.toLowerCase(), c]));
  assert.equal(changes.length, 3);
  assert.equal(by["zoom"].change, "UPDATED");
  assert.equal(by["zoom"].oldVersion, "5.1");
  assert.equal(by["vlc"].change, "INSTALLED");
  assert.equal(by["notepad++"].change, "REMOVED");
});

test("software changes: an identical list records nothing", () => {
  assert.deepEqual(diffSoftware([app("Zoom")], [app("Zoom")]), []);
});
