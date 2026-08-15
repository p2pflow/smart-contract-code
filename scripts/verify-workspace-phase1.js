const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const WORKSPACE = path.resolve(__dirname, "..", "..");
const NODE_VERSION = "24.18.0";
const repositories = [
  "p2pflow-smart-contract",
  "p2pflow-subgraph",
  "p2pflow-user-ui",
  "p2pflow-merchant-ui",
  "p2pflow-admin-ui",
  "p2pflow-executor",
];

function read(relativePath) {
  return fs.readFileSync(path.join(WORKSPACE, relativePath), "utf8");
}

for (const repository of repositories) {
  const root = path.join(WORKSPACE, repository);
  assert.ok(fs.statSync(root).isDirectory(), `${repository} is missing`);
  const packageJson = JSON.parse(read(`${repository}/package.json`));
  assert.equal(packageJson.engines?.node, NODE_VERSION, `${repository} must pin Node ${NODE_VERSION}`);
  assert.equal(read(`${repository}/.nvmrc`).trim(), NODE_VERSION);
  assert.equal(read(`${repository}/.node-version`).trim(), NODE_VERSION);
  assert.ok(packageJson.scripts?.build || packageJson.scripts?.compile, `${repository} needs a build or compile script`);
  assert.ok(packageJson.scripts?.verify, `${repository} needs a verification script`);
}

for (const repository of ["p2pflow-user-ui", "p2pflow-merchant-ui", "p2pflow-admin-ui", "p2pflow-executor"]) {
  const dockerfile = read(`${repository}/Dockerfile`);
  const dockerignore = read(`${repository}/.dockerignore`);
  assert.match(dockerfile, /FROM node:24\.18\.0-alpine/);
  assert.doesNotMatch(dockerfile, /COPY\s+\.\s+\./);
  assert.doesNotMatch(dockerfile, /\.env/i);
  assert.match(dockerignore, /^\.env\*$/m);
}

for (const repository of ["p2pflow-user-ui", "p2pflow-merchant-ui", "p2pflow-admin-ui"]) {
  const jenkinsfile = read(`${repository}/Jenkinsfile`);
  const viteConfig = read(`${repository}/vite.config.js`);
  assert.doesNotMatch(jenkinsfile, /\bcp\b[^\n]*\.env/i);
  assert.doesNotMatch(jenkinsfile, /VITE_[A-Z0-9_]*(?:(?:SECRET|PRIVATE|PASSWORD)(?:_|$)|(?:AUTH|ACCESS|DEPLOYMENT)_TOKEN)/);
  assert.match(viteConfig, /envDir:\s*false/);
  assert.match(viteConfig, /__P2PFLOW_NO_AUTO_ENV__/);
}

const executorRoot = path.join(WORKSPACE, "p2pflow-executor");
const executorEntrypoints = fs
  .readdirSync(path.join(executorRoot, "src"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"));
assert.deepEqual(executorEntrypoints.map((entry) => entry.name), ["main.ts"]);
assert.equal(fs.existsSync(path.join(executorRoot, "Dockerfile")), true);

console.log("Phase 1 workspace verified: six Node pins, secret-safe image contexts, one executor entry point/image");
