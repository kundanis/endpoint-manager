// Builds the self-installing macOS agent tarball (same layout idea as the Linux agent's
// package-installer.sh), written in Node rather than bash so it runs on the Windows build
// machine too.
//
// Unlike Linux, a Mac has no system Node to rely on, so the package carries the official
// nodejs.org runtime for both Apple silicon and Intel (install.sh and the self-updater pick
// the right one). The tarball is written here directly rather than with a tar binary so the
// executable bits on install.sh/uninstall.sh/node survive a Windows build.
//
// Output: dist-installer/EndpointProAgentMac.tar.gz + agent-manifest.json, staged on the
// server under AGENT_INSTALLER_DIR/macos/ (see config.agentInstallerTarballPathMac).
//
// NODE_VERSION overrides the bundled runtime version; downloads are cached in
// dist-installer/.node-cache and always checked against nodejs.org's SHASUMS256.txt.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const NODE_VERSION = process.env.NODE_VERSION ?? "v22.23.2";
const ARCHES = ["arm64", "x64"];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const agentDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(agentDir, "..", "..");
const sharedDir = path.join(repoRoot, "packages", "shared");
const templatesDir = path.join(scriptDir, "templates");
const distInstallerDir = path.join(agentDir, "dist-installer");
const stagingRoot = path.join(distInstallerDir, "EndpointProAgentMac");
const nodeCacheDir = path.join(distInstallerDir, ".node-cache");

function run(cmd, args, cwd) {
  // On Windows npm is npm.cmd, which needs a shell; the arguments here are all fixed strings.
  const result =
    process.platform === "win32"
      ? spawnSync([cmd, ...args].join(" "), { cwd, stdio: "inherit", shell: true })
      : spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${result.status})`);
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// ---- tar (ustar + pax long names) -------------------------------------------------------

function octal(value, width) {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

function tarHeader(name, { size = 0, mode = 0o644, type = "0", mtime }) {
  const h = Buffer.alloc(512, 0);
  h.write(name, 0, 100, "utf8");
  h.write(octal(mode, 8), 100, 8, "ascii");
  h.write(octal(0, 8), 108, 8, "ascii"); // uid
  h.write(octal(0, 8), 116, 8, "ascii"); // gid
  h.write(octal(size, 12), 124, 12, "ascii");
  h.write(octal(mtime, 12), 136, 12, "ascii");
  h.write("        ", 148, 8, "ascii"); // checksum placeholder (spaces)
  h.write(type, 156, 1, "ascii");
  h.write("ustar\0", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  h.write("root", 265, 32, "ascii");
  h.write("wheel", 297, 32, "ascii");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return h;
}

const pad512 = (len) => Buffer.alloc((512 - (len % 512)) % 512, 0);

function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return Buffer.from(`${len}${body}`, "utf8");
}

class TarWriter {
  chunks = [];
  mtime = Math.floor(Date.now() / 1000);

  #entry(name, data, mode, type) {
    if (Buffer.byteLength(name) > 99) {
      const pax = paxRecord("path", name);
      this.chunks.push(tarHeader("PaxHeader", { size: pax.length, type: "x", mtime: this.mtime }), pax, pad512(pax.length));
      name = name.slice(0, 99);
    }
    this.chunks.push(tarHeader(name, { size: data.length, mode, type, mtime: this.mtime }));
    if (data.length) this.chunks.push(data, pad512(data.length));
  }

  dir(name, mode = 0o755) {
    this.#entry(name.endsWith("/") ? name : `${name}/`, Buffer.alloc(0), mode, "5");
  }

  file(name, data, mode = 0o644) {
    this.#entry(name, data, mode, "0");
  }

  // Adds a directory tree; symlinks (e.g. node_modules/.bin) are skipped - nothing needs them.
  tree(srcDir, prefix, modeFor = () => 0o644) {
    this.dir(prefix);
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const src = path.join(srcDir, entry.name);
      const name = `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) this.tree(src, name, modeFor);
      else if (entry.isFile()) this.file(name, fs.readFileSync(src), modeFor(name));
    }
  }

  gzip() {
    return zlib.gzipSync(Buffer.concat([...this.chunks, Buffer.alloc(1024, 0)]), { level: 9 });
  }
}

// Pulls named entries out of a .tar.gz (enough of the format for nodejs.org's tarballs).
function extractFromTarGz(tgz, wanted) {
  const tar = zlib.gunzipSync(tgz);
  const found = new Map();
  let offset = 0;
  let longName = null;
  while (offset + 512 <= tar.length) {
    const h = tar.subarray(offset, offset + 512);
    if (h.every((b) => b === 0)) break;
    const str = (start, len) => h.subarray(start, start + len).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(str(124, 12).trim() || "0", 8);
    const type = str(156, 1) || "0";
    const prefix = str(345, 155);
    const name = longName ?? (prefix ? `${prefix}/${str(0, 100)}` : str(0, 100));
    const data = tar.subarray(offset + 512, offset + 512 + size);
    longName = null;
    if (type === "x") {
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString("utf8"));
      if (m) longName = m[1];
    } else if (type === "L") {
      longName = data.toString("utf8").replace(/\0.*$/s, "");
    } else if (type === "0" && wanted.includes(name)) {
      found.set(name, Buffer.from(data));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return found;
}

// ---- runtime download --------------------------------------------------------------------

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchNodeRuntime(arch, shasums) {
  const file = `node-${NODE_VERSION}-darwin-${arch}.tar.gz`;
  const expected = shasums.match(new RegExp(`^([0-9a-f]{64})\\s+${file.replace(/\./g, "\\.")}$`, "m"))?.[1];
  if (!expected) throw new Error(`${file} is not listed in SHASUMS256.txt for ${NODE_VERSION}`);

  fs.mkdirSync(nodeCacheDir, { recursive: true });
  const cached = path.join(nodeCacheDir, file);
  let tgz = fs.existsSync(cached) ? fs.readFileSync(cached) : null;
  if (!tgz || sha256(tgz) !== expected) {
    console.log(`Downloading ${file}...`);
    tgz = await download(`https://nodejs.org/dist/${NODE_VERSION}/${file}`);
    if (sha256(tgz) !== expected) throw new Error(`${file}: SHA-256 does not match nodejs.org's SHASUMS256.txt`);
    fs.writeFileSync(cached, tgz);
  } else {
    console.log(`Using cached ${file}`);
  }

  const root = `node-${NODE_VERSION}-darwin-${arch}`;
  const entries = extractFromTarGz(tgz, [`${root}/bin/node`, `${root}/LICENSE`]);
  const node = entries.get(`${root}/bin/node`);
  if (!node) throw new Error(`${file} has no bin/node`);
  return { node, license: entries.get(`${root}/LICENSE`) };
}

// ---- release notes -----------------------------------------------------------------------

function releaseNotesFor(version) {
  const lines = fs.readFileSync(path.join(agentDir, "CHANGELOG.md"), "utf8").replace(/\r\n/g, "\n").split("\n");
  const header = `## ${version}`;
  const start = lines.indexOf(header);
  if (start === -1) throw new Error(`CHANGELOG.md has no '${header}' section - add one before packaging version ${version}.`);
  const out = [header];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    out.push(line);
  }
  return out.join("\n").replace(/\s+$/, "");
}

// ---- main --------------------------------------------------------------------------------

async function main() {
  console.log("Building @em/shared and @em/agent-macos...");
  run("npm", ["run", "build", "-w", "@em/shared"], repoRoot);
  run("npm", ["run", "build", "-w", "@em/agent-macos"], repoRoot);

  const version = readJson(path.join(agentDir, "package.json")).version;
  const releaseNotes = releaseNotesFor(version);

  fs.rmSync(stagingRoot, { recursive: true, force: true });
  const appDir = path.join(stagingRoot, "app");
  fs.mkdirSync(appDir, { recursive: true });
  fs.cpSync(path.join(agentDir, "dist"), path.join(appDir, "dist"), { recursive: true });

  // Minimal package.json: config.ts's readAgentVersion() reads it once installed, so
  // Agent.agentVersion always matches the manifest below.
  fs.writeFileSync(
    path.join(appDir, "package.json"),
    JSON.stringify({ name: "endpoint-pro-agent-macos-deployment", version, private: true, main: "dist/index.js" }, null, 2) + "\n",
  );

  console.log("Resolving runtime dependencies...");
  const depsStaging = path.join(distInstallerDir, ".deps-staging");
  fs.rmSync(depsStaging, { recursive: true, force: true });
  fs.mkdirSync(depsStaging, { recursive: true });
  const installedVersion = (name) => readJson(path.join(repoRoot, "node_modules", name, "package.json")).version;
  fs.writeFileSync(
    path.join(depsStaging, "package.json"),
    JSON.stringify({
      name: "endpoint-pro-agent-macos-runtime-deps",
      private: true,
      // zod: @em/shared's own runtime dependency.
      dependencies: {
        axios: installedVersion("axios"),
        systeminformation: installedVersion("systeminformation"),
        zod: installedVersion("zod"),
      },
    }),
  );
  run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock"], depsStaging);
  fs.cpSync(path.join(depsStaging, "node_modules"), path.join(appDir, "node_modules"), { recursive: true });
  fs.rmSync(depsStaging, { recursive: true, force: true });

  // @em/shared isn't published to npm - hand-build the node_modules entry, as the other
  // agents' packaging scripts do.
  const sharedDest = path.join(appDir, "node_modules", "@em", "shared");
  fs.mkdirSync(sharedDest, { recursive: true });
  fs.cpSync(path.join(sharedDir, "dist"), path.join(sharedDest, "dist"), { recursive: true });
  fs.copyFileSync(path.join(sharedDir, "package.json"), path.join(sharedDest, "package.json"));

  console.log(`Fetching the Node.js ${NODE_VERSION} runtime for macOS...`);
  const shasums = (await download(`https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt`)).toString("utf8");
  const runtimes = {};
  for (const arch of ARCHES) runtimes[arch] = await fetchNodeRuntime(arch, shasums);

  console.log("Building tarball...");
  const tar = new TarWriter();
  // Templates are LF in the repo (.gitattributes), but a CRLF checkout would break bash.
  const lf = (p) => Buffer.from(fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n"), "utf8");
  tar.file("install.sh", lf(path.join(templatesDir, "install.sh")), 0o755);
  tar.file("uninstall.sh", lf(path.join(templatesDir, "uninstall.sh")), 0o755);
  tar.file("com.endpointone.agent.plist", lf(path.join(templatesDir, "com.endpointone.agent.plist")));
  tar.tree(appDir, "app");
  tar.dir("runtime");
  for (const arch of ARCHES) {
    const root = `runtime/node-darwin-${arch}`;
    tar.dir(root);
    tar.dir(`${root}/bin`);
    tar.file(`${root}/bin/node`, runtimes[arch].node, 0o755);
    if (runtimes[arch].license) tar.file(`${root}/LICENSE`, runtimes[arch].license);
  }
  const tgz = tar.gzip();

  // This exact tarball (never containing config.json/.state) doubles as the self-update
  // payload; the manifest carries its checksum for the agent and its notes for the console.
  const tarballPath = path.join(distInstallerDir, "EndpointProAgentMac.tar.gz");
  fs.writeFileSync(tarballPath, tgz);
  const manifest = {
    version,
    sha256: sha256(tgz),
    fileSizeBytes: tgz.length,
    releaseNotes,
    builtAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(distInstallerDir, "agent-manifest.json"), JSON.stringify(manifest));
  fs.rmSync(stagingRoot, { recursive: true, force: true });

  console.log("");
  console.log(`Installer tarball created: ${tarballPath} (${(tgz.length / 1048576).toFixed(1)} MB)`);
  console.log(`Manifest created: ${path.join(distInstallerDir, "agent-manifest.json")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
