import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const artifact = JSON.parse(fs.readFileSync(path.join(root, "artifacts", "protocol-artifact.json"), "utf8"));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p2pflow-protocol-pack-"));

function pack(destination) {
  fs.mkdirSync(destination, { recursive: true });
  const result = spawnSync(process.execPath, [process.env.npm_execpath, "pack", "--ignore-scripts", "--json", "--pack-destination", destination], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "npm pack failed");
  const details = JSON.parse(result.stdout);
  if (!Array.isArray(details) || details.length !== 1) throw new Error("npm pack returned an unexpected result");
  return path.join(destination, details[0].filename);
}

const sha256File = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

try {
  const first = pack(path.join(tempRoot, "first"));
  const second = pack(path.join(tempRoot, "second"));
  const firstDigest = sha256File(first);
  const secondDigest = sha256File(second);
  if (firstDigest !== secondDigest) throw new Error("npm pack output is not reproducible");

  const vendor = path.join(root, "vendor");
  const canonicalTarball = path.join(vendor, path.basename(first));
  const metadataPath = path.join(vendor, "protocol-artifact.json");
  const metadata = `${JSON.stringify({ ...artifact, packageTarball: path.basename(first), packageSha256: firstDigest }, null, 2)}\n`;
  const staleTarballs = fs.existsSync(vendor)
    ? fs.readdirSync(vendor).filter((file) => /^p2pflow-protocol-.*\.tgz$/u.test(file) && file !== path.basename(first))
    : [];

  if (check) {
    if (staleTarballs.length > 0) throw new Error(`Canonical vendor contains stale tarballs: ${staleTarballs.join(", ")}`);
    if (!fs.existsSync(canonicalTarball) || sha256File(canonicalTarball) !== firstDigest) {
      throw new Error("Canonical protocol tarball has drift; run npm run pack:artifact");
    }
    if (!fs.existsSync(metadataPath) || fs.readFileSync(metadataPath, "utf8") !== metadata) {
      throw new Error("Canonical protocol artifact metadata has drift");
    }
  } else {
    fs.mkdirSync(vendor, { recursive: true });
    for (const file of staleTarballs) fs.rmSync(path.join(vendor, file));
    fs.copyFileSync(first, canonicalTarball);
    fs.writeFileSync(metadataPath, metadata);
  }
  console.log(`Protocol pack reproducible: ${path.basename(first)} sha256=${firstDigest}`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
