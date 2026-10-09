// Build step 2 (runs inside the Docker bytecode stage, same Node/V8 as the runtime stage):
// compiles the minified .bundle.js files to V8 bytecode (.jsc) with bytenode, writes
// integrity-checking loader shims, and emits no plain JS - so the final image contains only
// bytecode plus the small loaders. (Verified locally with bytenode: load + tamper-halt.)
//
// Args: <srcDir with *.bundle.js> <outDir for *.jsc + loaders>
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const bytenode = require("bytenode");

const srcDir = process.argv[2];
const outDir = process.argv[3];
if (!srcDir || !outDir) {
  console.error("usage: node compile-bytecode.js <srcDir> <outDir>");
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

function compile(base) {
  const src = path.join(srcDir, base + ".bundle.js");
  const out = path.join(outDir, base + ".jsc");
  bytenode.compileFile({ filename: src, output: out, compileAsModule: true });
  return crypto.createHash("sha256").update(fs.readFileSync(out)).digest("hex");
}

function writeLoader(file, jscName, hash) {
  const src = `const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
require("bytenode");
const p = path.join(__dirname, "${jscName}");
let actual;
try {
  actual = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
} catch (err) {
  console.error("FATAL: cannot read the server bytecode for its integrity check.", err && err.message);
  process.exit(1);
}
if (actual !== "${hash}") {
  console.error("FATAL: integrity check failed - this Endpoint Pro server build has been modified or corrupted. Refusing to start.");
  process.exit(1);
}
require("./${jscName}");
`;
  fs.writeFileSync(path.join(outDir, file), src);
}

const indexHash = compile("index");
const seedHash = compile("seed");
writeLoader("bootstrap.cjs", "index.jsc", indexHash);
writeLoader("seed-run.cjs", "seed.jsc", seedHash);

console.log("bytecode: compiled index.jsc (sha256=" + indexHash + ") and seed.jsc");
