// Build step 1 (runs inside the Docker builder stage): bundle + minify our own code
// (packages/server/src plus the @em/shared and @license/shared workspace packages) into
// single files. These .bundle.js files are an intermediate - the build compiles them to V8
// bytecode (.jsc) next, and the plain JS never reaches the final image. Third-party npm
// packages stay external (installed normally + prisma generated).
//
// Args: <repoRoot> <bundleOutDir>
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.argv[2];
const outDir = process.argv[3];
if (!repoRoot || !outDir) {
  console.error("usage: node esbuild-bundle.mjs <repoRoot> <bundleOutDir>");
  process.exit(1);
}

const require = createRequire(path.join(repoRoot, "package.json"));
const esbuild = require("esbuild");

const serverPkg = JSON.parse(readFileSync(path.join(repoRoot, "packages/server/package.json"), "utf8"));
const bundleIn = new Set(["@em/shared", "@license/shared"]); // our code -> bundled in
const external = Object.keys(serverPkg.dependencies).filter((d) => !bundleIn.has(d));
for (const dep of ["@prisma/client", "prisma", "bytenode"]) if (!external.includes(dep)) external.push(dep);

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  minify: true,
  legalComments: "none",
  external,
  logLevel: "info",
};

await esbuild.build({ ...common, entryPoints: [path.join(repoRoot, "packages/server/src/index.ts")], outfile: path.join(outDir, "index.bundle.js") });
await esbuild.build({ ...common, entryPoints: [path.join(repoRoot, "packages/server/prisma/seed.ts")], outfile: path.join(outDir, "seed.bundle.js") });

console.log("esbuild: produced index.bundle.js and seed.bundle.js");
