import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.resolve(root, "..");
const canonicalVendor = path.join(root, "packages", "protocol", "vendor");
const canonical = JSON.parse(fs.readFileSync(path.join(canonicalVendor, "protocol-artifact.json"), "utf8"));
const dependency = `file:vendor/${canonical.packageTarball}`;
const consumers = [
  { repository: "p2pflow-subgraph", boundary: "scripts/sync-protocol-artifacts.mjs", sourceRoot: "scripts" },
  { repository: "p2pflow-user-ui", boundary: "src/protocol/index.js", sourceRoot: "src" },
  { repository: "p2pflow-merchant-ui", boundary: "src/protocol/index.js", sourceRoot: "src" },
  { repository: "p2pflow-admin-ui", boundary: "src/protocol/index.js", sourceRoot: "src" },
  { repository: "p2pflow-executor", boundary: "src/protocol/index.ts", sourceRoot: "src" },
];

const sha256File = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:[cm]?[jt]sx?)$/u.test(entry.name) ? [absolute] : [];
  });
}

for (const { repository, boundary, sourceRoot } of consumers) {
  const consumer = path.join(workspace, repository);
  const packageJson = JSON.parse(fs.readFileSync(path.join(consumer, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(consumer, "package-lock.json"), "utf8"));
  const metadata = JSON.parse(fs.readFileSync(path.join(consumer, "vendor", "protocol-artifact.json"), "utf8"));
  const installed = JSON.parse(
    fs.readFileSync(path.join(consumer, "node_modules", "@p2pflow", "protocol", "package.json"), "utf8"),
  );
  assert.equal(packageJson.dependencies?.[canonical.packageName], dependency, `${repository} dependency drift`);
  assert.equal(lock.packages?.[""]?.dependencies?.[canonical.packageName], dependency, `${repository} lock root drift`);
  assert.equal(lock.packages?.["node_modules/@p2pflow/protocol"]?.version, canonical.packageVersion);
  assert.equal(installed.version, canonical.packageVersion, `${repository} installed protocol version drift`);
  assert.deepEqual(metadata, canonical, `${repository} protocol metadata drift`);
  assert.equal(
    sha256File(path.join(consumer, "vendor", canonical.packageTarball)),
    canonical.packageSha256,
    `${repository} protocol tarball digest drift`,
  );
  const boundarySource = fs.readFileSync(path.join(consumer, boundary), "utf8");
  assert.match(boundarySource, /["']@p2pflow\/protocol["']/u, `${repository} canonical boundary is missing`);
  const directImports = sourceFiles(path.join(consumer, sourceRoot))
    .filter((file) => /(?:from\s*|import\s*\()\s*["']@p2pflow\/protocol(?:\/[^"']*)?["']/u.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(consumer, file));
  assert.deepEqual(directImports, [boundary], `${repository} must have exactly one canonical protocol import boundary`);
  const serializedLock = JSON.stringify(lock);
  assert.doesNotMatch(serializedLock, /(?:\/home\/|\/Users\/|[A-Za-z]:\\\\)/u, `${repository} lock contains a machine-local path`);
}

console.log(
  `Protocol consumers verified: ${canonical.packageName}@${canonical.packageVersion} artifact=${canonical.protocolArtifactDigest} packageSha256=${canonical.packageSha256}`,
);
