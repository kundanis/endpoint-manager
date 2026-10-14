// Run with: npm test -w @em/agent
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRegQueryUninstall } from "../src/inventory";

const REG_OUTPUT = [
  "",
  "HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Git_is1",
  "    Inno Setup: Setup Version    REG_SZ    6.4.3",
  "    DisplayName    REG_SZ    Git",
  "    DisplayVersion    REG_SZ    2.55.0.5",
  "    Publisher    REG_SZ    The Git Development Community",
  "    InstallDate    REG_SZ    20261013",
  "",
  "HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NoName",
  "    SystemComponent    REG_DWORD    0x1",
  "",
  "HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{GUID}",
  "    DisplayName    REG_SZ    Docker Desktop",
  "    DisplayVersion    REG_SZ    ",
  "",
].join("\r\n");

test("parseRegQueryUninstall reads named entries and skips nameless keys", () => {
  assert.deepEqual(parseRegQueryUninstall(REG_OUTPUT), [
    { name: "Git", version: "2.55.0.5", publisher: "The Git Development Community", installDate: "20261013" },
    { name: "Docker Desktop", version: null, publisher: null, installDate: null },
  ]);
});

test("parseRegQueryUninstall handles empty output", () => {
  assert.deepEqual(parseRegQueryUninstall(""), []);
});
