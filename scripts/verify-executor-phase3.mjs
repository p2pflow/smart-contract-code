import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const contractRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.resolve(contractRoot, "..");
const executorRoot = path.join(workspace, "p2pflow-executor");
const readExecutor = (relativePath) => fs.readFileSync(path.join(executorRoot, relativePath), "utf8");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if ([".git", "dist", "node_modules", "coverage"].includes(entry.name) || entry.name.startsWith(".env")) return [];
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

const files = walk(executorRoot);
const executorPackage = JSON.parse(readExecutor("package.json"));
const executorProtocol = JSON.parse(readExecutor("vendor/protocol-artifact.json"));
const canonicalProtocol = JSON.parse(
  fs.readFileSync(path.join(contractRoot, "packages", "protocol", "vendor", "protocol-artifact.json"), "utf8"),
);
const localManifest = JSON.parse(
  fs.readFileSync(path.join(contractRoot, "packages", "protocol", "artifacts", "local-base-sepolia.manifest.json"), "utf8"),
);

assert.deepEqual(executorProtocol, canonicalProtocol, "executor protocol artifact drift");
assert.equal(localManifest.kind, "local-test-fixture");
assert.equal(localManifest.safeForSharedEnvironment, false);
assert.equal(localManifest.chainId, 84532);
assert.equal(localManifest.usdc.address, "0x036CbD53842c5426634e7929541eC2318f3dCF7e");
assert.equal(localManifest.usdc.decimals, 6);
assert.equal(executorPackage.scripts.start, "node dist/main.js");

assert.deepEqual(
  files.filter((file) => path.basename(file) === "main.ts").map((file) => path.relative(executorRoot, file)),
  ["src/main.ts"],
);
assert.deepEqual(
  files.filter((file) => path.basename(file) === "Dockerfile").map((file) => path.relative(executorRoot, file)),
  ["Dockerfile"],
);

const sourceFiles = files.filter((file) => file.endsWith(".ts") && file.startsWith(path.join(executorRoot, "src")));
const source = sourceFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
assert.equal((source.match(/\bnew Pool\s*\(/gu) ?? []).length, 1, "executor must own one PostgreSQL pool");
assert.equal((source.match(/\bFastify\s*\(/gu) ?? []).length, 1, "executor must own one Fastify app");
assert.equal((source.match(/\.listen\s*\(/gu) ?? []).length, 1, "executor must expose one port");
assert.doesNotMatch(source, /process\.env\.(?:RPC_URL|PRIVATE_KEY|DEPLOYER_PRIVATE_KEY)/u);
assert.match(readExecutor("src/config/index.ts"), /EXECUTOR_PRICE_WRITE_MODE[\s\S]*default\("off"\)/u);
assert.match(readExecutor("src/config/index.ts"), /EXECUTOR_MATCH_WRITE_MODE[\s\S]*default\("off"\)/u);
assert.match(readExecutor("src/config/index.ts"), /EXECUTOR_RECOVERY_WRITE_MODE[\s\S]*default\("off"\)/u);

const compose = readExecutor("compose.yaml");
const serviceBlock = compose.slice(compose.indexOf("services:"), compose.indexOf("\nvolumes:"));
assert.deepEqual(
  [...serviceBlock.matchAll(/^  ([a-z][a-z0-9-]*):$/gmu)].map((match) => match[1]),
  ["postgres", "executor"],
);

const migrationUp = readExecutor("migrations/0001_executor_foundation.up.sql");
const migrationDown = readExecutor("migrations/0001_executor_foundation.down.sql");
for (const table of [
  "chain_blocks", "chain_cursors", "chain_events", "jobs", "outbox_actions", "transaction_intents",
  "transaction_attempts", "signer_nonce_lanes", "price_observations", "price_decisions", "matching_decisions",
  "matching_candidates", "capacity_reservations", "cap_policies", "auth_nonces", "sessions", "payment_references",
  "payment_access_audit", "audit_log", "notifications", "automation_settings",
]) {
  assert.match(migrationUp, new RegExp(`CREATE TABLE ${table}\\b`, "u"));
  assert.match(migrationDown, new RegExp(`DROP TABLE IF EXISTS ${table}\\b`, "u"));
}
assert.match(migrationUp, /CREATE INDEX outbox_actions_claim\b/u);
assert.match(migrationUp, /raw_transaction_ciphertext BYTEA NOT NULL/u);
assert.doesNotMatch(migrationUp, /\braw_transaction BYTEA/u);
assert.match(migrationUp, /CREATE UNIQUE INDEX cap_policies_merchant_scope\b/u);

console.log(
  `Executor Phase 3 local preflight verified: chain=${String(localManifest.chainId)} protocol=${canonicalProtocol.protocolArtifactDigest}`,
);
