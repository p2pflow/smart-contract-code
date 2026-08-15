const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const EXPECTED_NODE = "24.18.0";
const EXPECTED_NPM = "11.16.0";
const EXPECTED_PRAGMA = "pragma solidity 0.8.24;";

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

assert.equal(process.versions.node, EXPECTED_NODE, `Node ${EXPECTED_NODE} is required`);

const packageJson = JSON.parse(read("package.json"));
assert.equal(packageJson.packageManager, `npm@${EXPECTED_NPM}`);
assert.deepEqual(packageJson.engines, { node: EXPECTED_NODE, npm: EXPECTED_NPM });
assert.equal(read(".nvmrc").trim(), EXPECTED_NODE);
assert.equal(read(".node-version").trim(), EXPECTED_NODE);

const hardhatConfig = read("hardhat.config.js");
assert.match(hardhatConfig, /version:\s*["']0\.8\.24["']/);

const solidityFiles = walk(path.join(ROOT, "contracts")).filter((file) => file.endsWith(".sol"));
assert.ok(solidityFiles.length > 0, "No Solidity sources found");
for (const file of solidityFiles) {
  const pragma = fs.readFileSync(file, "utf8").match(/^pragma solidity .*;$/m)?.[0];
  assert.equal(pragma, EXPECTED_PRAGMA, `${path.relative(ROOT, file)} must use exact Solidity 0.8.24`);
}

console.log(`Phase 1 toolchain verified: Node ${EXPECTED_NODE}, npm ${EXPECTED_NPM}, Solidity 0.8.24`);
