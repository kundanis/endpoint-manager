// Builds the customer-ready load test tool:
//   dist/EndpointIQLoadTest/  endpoint-iq-load-test.js (one bundled file), node.exe, LoadTest.cmd, README.txt
//   dist/EndpointIQLoadTest.zip
// Needs nothing installed on the PC it runs on (node.exe is included). On Linux/macOS, run the
// .js with Node.js 20 or later.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const dist = path.join(root, "dist");
const out = path.join(dist, "EndpointIQLoadTest");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

await build({
  entryPoints: [path.join(root, "src", "cli.ts")],
  outfile: path.join(out, "endpoint-iq-load-test.js"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  define: { __TOOL_VERSION__: JSON.stringify(pkg.version) },
  banner: { js: `// Endpoint IQ Load Test ${pkg.version}` },
  logLevel: "warning",
});

if (process.platform === "win32") {
  fs.copyFileSync(process.execPath, path.join(out, "node.exe"));
}
fs.writeFileSync(
  path.join(out, "LoadTest.cmd"),
  ['@echo off', 'title Endpoint IQ Load Test', 'cd /d "%~dp0"', '"%~dp0node.exe" "%~dp0endpoint-iq-load-test.js" %*', ''].join("\r\n"),
);
fs.copyFileSync(path.join(root, "templates", "README.txt"), path.join(out, "README.txt"));

if (process.platform === "win32") {
  const zip = path.join(dist, "EndpointIQLoadTest.zip");
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Compress-Archive -Path '${out}' -DestinationPath '${zip}' -Force`], { stdio: "inherit" });
  console.log(`Built ${zip} (${Math.round(fs.statSync(zip).size / 1024 / 1024)} MB)`);
} else {
  console.log(`Built ${out}`);
}
