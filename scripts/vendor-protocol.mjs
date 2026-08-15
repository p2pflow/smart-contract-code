import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.resolve(root, "..");
const check = process.argv.includes("--check");
const canonicalVendor = path.join(root, "packages", "protocol", "vendor");
const metadata = JSON.parse(fs.readFileSync(path.join(canonicalVendor, "protocol-artifact.json"), "utf8"));
const files = [metadata.packageTarball, "protocol-artifact.json"];
const consumers = [
  "p2pflow-subgraph",
  "p2pflow-user-ui",
  "p2pflow-merchant-ui",
  "p2pflow-admin-ui",
  "p2pflow-executor",
];

for (const consumer of consumers) {
  const vendor = path.join(workspace, consumer, "vendor");
  const expectedTarball = metadata.packageTarball;
  const staleTarballs = fs.existsSync(vendor)
    ? fs.readdirSync(vendor).filter((file) => /^p2pflow-protocol-.*\.tgz$/u.test(file) && file !== expectedTarball)
    : [];
  if (check && staleTarballs.length > 0) {
    throw new Error(`${consumer}/vendor contains stale protocol tarballs: ${staleTarballs.join(", ")}`);
  }
  if (!check) {
    for (const file of staleTarballs) fs.rmSync(path.join(vendor, file));
  }
  for (const file of files) {
    const source = path.join(canonicalVendor, file);
    const target = path.join(vendor, file);
    if (check) {
      if (!fs.existsSync(target) || !fs.readFileSync(source).equals(fs.readFileSync(target))) {
        throw new Error(`${consumer}/vendor/${file} differs from the canonical protocol artifact`);
      }
      continue;
    }
    fs.mkdirSync(vendor, { recursive: true });
    fs.copyFileSync(source, target);
  }
}

console.log(check ? "All protocol vendors match the canonical artifact" : "Vendored one canonical protocol artifact to five consumers");
