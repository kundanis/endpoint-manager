// Build helper (runs inside the Docker builder stage): writes the runtime package.json for
// the image. It lists only the third-party dependencies the compiled server needs at runtime -
// our own @em/* and @license/* code is bundled into the bytecode, so it is NOT listed here.
// `prisma` (the CLI, for `migrate deploy`) and `bytenode` (to load the .jsc) are added.
//
// Args: <repoRoot> <outAppDir>  (writes <outAppDir>/package.json)
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.argv[2];
const outDir = process.argv[3];
if (!repoRoot || !outDir) {
  console.error("usage: node make-runtime.mjs <repoRoot> <outAppDir>");
  process.exit(1);
}

const serverPkg = JSON.parse(readFileSync(path.join(repoRoot, "packages/server/package.json"), "utf8"));
const rootPkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

const workspace = new Set(["@em/shared", "@license/shared"]);
const deps = {};
for (const [name, range] of Object.entries(serverPkg.dependencies ?? {})) {
  if (!workspace.has(name)) deps[name] = range;
}
// The CLI used for `prisma migrate deploy` at container setup (it is a devDependency of the
// server package, so pull its range from there).
if (serverPkg.devDependencies?.prisma) deps.prisma = serverPkg.devDependencies.prisma;
// Loads the compiled .jsc at runtime.
deps.bytenode = "^1.5.1";

const out = {
  name: "endpoint-pro-server",
  version: rootPkg.version ?? "0.1.0",
  private: true,
  main: "dist/bootstrap.cjs",
  dependencies: Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b))),
};

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "package.json"), JSON.stringify(out, null, 2));
console.log("make-runtime: wrote runtime package.json with", Object.keys(out.dependencies).length, "deps");
