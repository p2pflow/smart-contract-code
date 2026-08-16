import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const smart = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.resolve(smart, "..");
const repository = (name) => path.join(workspace, name);
const exists = (target) => fs.existsSync(path.join(workspace, target));
const read = (target) => fs.readFileSync(path.join(workspace, target), "utf8");

function requireAbsent(paths) {
  for (const target of paths) {
    const absolute = path.join(workspace, target);
    const present = fs.existsSync(absolute) && (
      !fs.statSync(absolute).isDirectory() || files(absolute).length > 0
    );
    assert.equal(present, false, `${target} must be absent`);
  }
}

function requirePresent(paths) {
  for (const target of paths) assert.equal(exists(target), true, `${target} must be present`);
}

function files(directory, accept = () => true) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? files(target, accept) : accept(target) ? [target] : [];
  });
}

function occurrences(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

requireAbsent([
  "p2pflow-smart-contract/API.md",
  "p2pflow-smart-contract/DATA.md",
  "p2pflow-smart-contract/CORE_FUNCTIONALITY_AND_DEPLOYMENT.md",
  "p2pflow-smart-contract/contracts/upgradeInitializers/DiamondInit.sol",
  "p2pflow-smart-contract/deployments/baseSepolia.json",
  "p2pflow-smart-contract/deployments/baseSepolia-mock-usdc.json",
  "p2pflow-smart-contract/scripts/deploy.js",
  "p2pflow-smart-contract/scripts/deployMockUsdc.js",
  "p2pflow-smart-contract/scripts/findStartBlock.js",
  "p2pflow-smart-contract/scripts/setChannelDefaults.js",
  "p2pflow-smart-contract/scripts/smokeTest.js",
  "p2pflow-smart-contract/scripts/stressTest.js",
  "p2pflow-smart-contract/scripts/upgrade.js",
  "p2pflow-smart-contract/scripts/upgradeMerchantFacet.js",
  "p2pflow-smart-contract/test/diamond.test.js",
  "p2pflow-smart-contract/test/orders.test.js",
  "p2pflow-user-ui/docs/API_AUDIT.md",
  "p2pflow-user-ui/src/config",
  "p2pflow-user-ui/src/constants",
  "p2pflow-user-ui/src/stores",
  "p2pflow-user-ui/src/thirdweb",
  "p2pflow-user-ui/src/layout.jsx",
  "p2pflow-user-ui/src/components/DropdownInput",
  "p2pflow-user-ui/src/components/Modal",
  "p2pflow-user-ui/src/components/SwitchComponent",
  "p2pflow-user-ui/src/components/TableField",
  "p2pflow-user-ui/src/components/TextInput",
  "p2pflow-user-ui/src/utils/errors.js",
  "p2pflow-user-ui/public/icons",
  "p2pflow-user-ui/public/images/default.png",
  "p2pflow-user-ui/public/images/empty-box.png",
  "p2pflow-user-ui/public/ads.txt",
  "p2pflow-user-ui/public/sitemap.xml",
  "p2pflow-merchant-ui/server.js",
  "p2pflow-merchant-ui/src/components/Common",
  "p2pflow-merchant-ui/src/components/DropdownInput",
  "p2pflow-merchant-ui/src/components/Loader",
  "p2pflow-merchant-ui/src/components/Modal",
  "p2pflow-merchant-ui/src/components/Shared",
  "p2pflow-merchant-ui/src/components/SwitchComponent",
  "p2pflow-merchant-ui/src/components/TableField",
  "p2pflow-merchant-ui/src/components/TextInput",
  "p2pflow-merchant-ui/src/components/ToggleButton",
  "p2pflow-merchant-ui/src/constants",
  "p2pflow-merchant-ui/src/pages/Account",
  "p2pflow-merchant-ui/src/pages/Home",
  "p2pflow-merchant-ui/src/pages/Legal",
  "p2pflow-merchant-ui/src/pages/Orders",
  "p2pflow-merchant-ui/src/pages/Register",
  "p2pflow-merchant-ui/src/protocol/receipts.js",
  "p2pflow-merchant-ui/src/layout.jsx",
  "p2pflow-merchant-ui/src/registerLayout.jsx",
  "p2pflow-merchant-ui/src/userLayout.jsx",
  "p2pflow-merchant-ui/public/icons",
  "p2pflow-merchant-ui/public/images/default.png",
  "p2pflow-merchant-ui/public/images/empty-box.png",
  "p2pflow-merchant-ui/public/ads.txt",
  "p2pflow-merchant-ui/public/sitemap.xml",
  "p2pflow-admin-ui/src/components",
  "p2pflow-admin-ui/src/config",
  "p2pflow-admin-ui/src/contexts",
  "p2pflow-admin-ui/src/hooks",
  "p2pflow-admin-ui/src/stores",
  "p2pflow-admin-ui/src/thirdweb",
  "p2pflow-admin-ui/src/pages/AllTransactions",
  "p2pflow-admin-ui/src/pages/BuyAndSell",
  "p2pflow-admin-ui/src/pages/Campaigns",
  "p2pflow-admin-ui/src/pages/Dashboard",
  "p2pflow-admin-ui/src/pages/FAQs",
  "p2pflow-admin-ui/src/pages/MerchantsManagement",
  "p2pflow-admin-ui/src/pages/PaymentsChannels",
  "p2pflow-admin-ui/public/icons",
  "p2pflow-admin-ui/public/images",
  "p2pflow-admin-ui/public/logo",
  "p2pflow-admin-ui/public/ads.txt",
  "p2pflow-admin-ui/public/sitemap.xml",
  "p2pflow-subgraph/abis/Diamond.json",
  "p2pflow-subgraph/networks/sepolia.yaml",
  "p2pflow-subgraph/scripts/prepare-base-sepolia.js",
  "p2pflow-smart-contract/.github/workflows/phase1.yml",
  "p2pflow-subgraph/.github/workflows/phase1.yml",
  "p2pflow-executor/.github/workflows/phase1.yml",
]);

requirePresent([
  "p2pflow-smart-contract/contracts/upgradeInitializers/DiamondInitV2.sol",
  "p2pflow-smart-contract/contracts/mocks/MockERC20.sol",
  "p2pflow-smart-contract/scripts/generate-protocol-fixture.js",
  "p2pflow-subgraph/protocol/Diamond.json",
  "p2pflow-subgraph/subgraph.yaml",
  "p2pflow-subgraph/networks/base-sepolia.template.yaml",
  "p2pflow-admin-ui/src/app/pending-write.js",
  "p2pflow-smart-contract/.github/workflows/ci.yml",
  "p2pflow-smart-contract/.github/workflows/coordinated-release.yml",
  "p2pflow-subgraph/.github/workflows/ci.yml",
  "p2pflow-user-ui/.github/workflows/ci.yml",
  "p2pflow-merchant-ui/.github/workflows/ci.yml",
  "p2pflow-admin-ui/.github/workflows/ci.yml",
  "p2pflow-executor/.github/workflows/ci.yml",
  "p2pflow-smart-contract/docs/runbooks/base-sepolia-preflight.md",
  "p2pflow-smart-contract/docs/runbooks/executor-operations.md",
  "p2pflow-smart-contract/docs/runbooks/shadow-mode-and-enablement.md",
  "p2pflow-smart-contract/docs/runbooks/rollback-and-recovery.md",
  "p2pflow-smart-contract/docs/runbooks/privacy-retention-and-incident-response.md",
  "p2pflow-smart-contract/docs/runbooks/replacement-signer-and-role-rotation.md",
  "p2pflow-smart-contract/docs/release/coordinated-base-sepolia-checklist.md",
  "p2pflow-smart-contract/docs/architecture/base-sepolia-mvp-overview.md",
  "p2pflow-smart-contract/docs/architecture/P2PFLOW_BASE_SEPOLIA_MVP_HIGH_LEVEL.md",
  "p2pflow-smart-contract/docs/architecture/P2PFLOW_BASE_SEPOLIA_MVP_HIGH_LEVEL.pdf",
]);

const highLevelPdf = fs.readFileSync(path.join(
  smart,
  "docs",
  "architecture",
  "P2PFLOW_BASE_SEPOLIA_MVP_HIGH_LEVEL.pdf",
));
assert.equal(highLevelPdf.subarray(0, 4).toString("ascii"), "%PDF");
assert.ok(highLevelPdf.length > 50_000, "high-level PDF is unexpectedly incomplete");

for (const name of ["p2pflow-user-ui", "p2pflow-merchant-ui", "p2pflow-admin-ui"]) {
  const dockerfile = read(`${name}/Dockerfile`);
  assert.ok(
    dockerfile.indexOf("COPY vendor ./vendor") < dockerfile.indexOf("RUN npm ci"),
    `${name} must copy the file dependency before npm ci`,
  );
  assert.match(dockerfile, /npm install --global serve@14\.2\.4/u);
  assert.doesNotMatch(dockerfile, /COPY\s+\.\s|server\.js|--env-file|ARG VITE_|ENV VITE_/u);
  assert.equal(read(`${name}/public/robots.txt`).trim(), "User-agent: *\nDisallow: /");
}

const merchantDocker = read("p2pflow-merchant-ui/Dockerfile");
const merchantJenkins = read("p2pflow-merchant-ui/Jenkinsfile");
assert.match(merchantDocker, /CMD \["serve", "-s", "dist", "-l", "5174"\]/u);
assert.doesNotMatch(`${merchantDocker}\n${merchantJenkins}`, /server\.js|--env-file/u);
const merchantProduction = files(repository("p2pflow-merchant-ui/src"), (file) => /\.[jt]sx?$/u.test(file))
  .map((file) => fs.readFileSync(file, "utf8")).join("\n");
assert.doesNotMatch(merchantProduction, /method:\s*["'`]function\s|LOCAL_BASE_SEPOLIA_FIXTURE/u);
assert.match(merchantProduction, /createProtocolCallFactory/u);

for (const name of ["p2pflow-user-ui", "p2pflow-merchant-ui", "p2pflow-admin-ui"]) {
  const production = files(repository(`${name}/src`), (file) => /\.(?:[jt]sx?|css)$/u.test(file))
    .map((file) => fs.readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(production, /local-test-fixture|LOCAL_BASE_SEPOLIA_FIXTURE/u, `${name} ships a test fixture`);
  assert.doesNotMatch(
    production,
    /VITE_[A-Z0-9_]*(?:SECRET|PRIVATE|PASSWORD|AUTH_TOKEN|ACCESS_TOKEN|DEPLOYMENT_TOKEN)|PRIVATE_KEY|GOLDSKY_WEBHOOK_SECRET/u,
    `${name} references a prohibited browser secret`,
  );
  assert.doesNotMatch(production, /coming soon|demo data|development mode|fake success|fake delay|P2P\.me|Ethereum Sepolia|mock[- ]USDC/iu);
  const wrapper = read(`${name}/src/protocol/index.js`);
  assert.match(wrapper, /@p2pflow\/protocol/u);
  assert.doesNotMatch(wrapper, /test-fixture|LOCAL_BASE_SEPOLIA_FIXTURE/u);
}

const protocolIndex = read("p2pflow-smart-contract/packages/protocol/src/index.ts");
assert.doesNotMatch(protocolIndex, /LOCAL_BASE_SEPOLIA_FIXTURE|GENERATED_LOCAL_BASE_SEPOLIA_FIXTURE|test-fixture/u);
assert.match(read("p2pflow-smart-contract/packages/protocol/package.json"), /"\.\/test-fixture"/u);

const executorRoot = repository("p2pflow-executor");
assert.deepEqual(
  files(executorRoot, (file) => path.basename(file) === "main.ts").map((file) => path.relative(executorRoot, file)),
  ["src/main.ts"],
);
assert.deepEqual(
  files(executorRoot, (file) => path.basename(file) === "Dockerfile").map((file) => path.relative(executorRoot, file)),
  ["Dockerfile"],
);
const executorDocker = read("p2pflow-executor/Dockerfile");
assert.equal(occurrences(executorDocker, /CMD \["node", "dist\/main\.js"\]/gu), 1);
assert.equal(occurrences(read("p2pflow-executor/compose.yaml"), /^\s{2}executor:\s*$/gmu), 1);
assert.equal(occurrences(read("p2pflow-executor/src/db/index.ts"), /new Pool\s*\(/gu), 1);
assert.equal(JSON.parse(read("p2pflow-executor/package.json")).scripts.start, "node dist/main.js");

const executorCi = read("p2pflow-executor/.github/workflows/ci.yml");
assert.match(executorCi, /postgres:17-alpine/u);
assert.match(executorCi, /npm run test:postgres/u);
for (const name of [
  "p2pflow-smart-contract", "p2pflow-subgraph", "p2pflow-user-ui",
  "p2pflow-merchant-ui", "p2pflow-admin-ui", "p2pflow-executor",
]) assert.match(read(`${name}/.github/workflows/ci.yml`), /npm run verify/u);

const deploymentDisabled = read("p2pflow-smart-contract/scripts/deployment-disabled.mjs");
assert.match(deploymentDisabled, /disabled/iu);
const executorConfig = read("p2pflow-executor/src/config/index.ts");
for (const moduleName of ["PRICE", "MATCH", "RECOVERY"]) {
  assert.match(executorConfig, new RegExp(`EXECUTOR_${moduleName}_WRITE_MODE: modeSchema\\.default\\("off"\\)`, "u"));
}

const releaseDocs = [
  "p2pflow-smart-contract/docs/release/coordinated-base-sepolia-checklist.md",
  "p2pflow-smart-contract/docs/runbooks/shadow-mode-and-enablement.md",
  "p2pflow-smart-contract/docs/runbooks/replacement-signer-and-role-rotation.md",
].map(read).join("\n");
for (let question = 1; question <= 8; question += 1) {
  assert.match(releaseDocs, new RegExp(`Q-${String(question)}`, "u"));
}
for (const gate of ["replacement", "independent review", "shadow", "explicit", "OFF"]) {
  assert.match(releaseDocs, new RegExp(gate, "iu"));
}

console.log("Release readiness verified: mandatory cleanup, static UIs, one executor, coordinated CI, runbooks, and write-off gates");
