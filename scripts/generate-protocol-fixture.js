const fs = require("node:fs");
const path = require("node:path");

const { Interface, id, keccak256, ZeroHash } = require("ethers");

const ROOT = path.resolve(__dirname, "..");
const PACKAGE_ROOT = path.join(ROOT, "packages", "protocol");
const PROTOCOL_PACKAGE = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
const ARTIFACTS = [
  ["ConfigFacet", "artifacts/contracts/facets/ConfigFacet.sol/ConfigFacet.json"],
  ["DiamondCutFacet", "artifacts/contracts/facets/DiamondCutFacet.sol/DiamondCutFacet.json"],
  ["DiamondLoupeFacet", "artifacts/contracts/facets/DiamondLoupeFacet.sol/DiamondLoupeFacet.json"],
  ["MerchantFacet", "artifacts/contracts/facets/MerchantFacet.sol/MerchantFacet.json"],
  ["OrderFacet", "artifacts/contracts/facets/OrderFacet.sol/OrderFacet.json"],
  ["OwnershipFacet", "artifacts/contracts/facets/OwnershipFacet.sol/OwnershipFacet.json"],
];

function readJson(relativePath) {
  const target = path.join(ROOT, relativePath);
  if (!fs.existsSync(target)) throw new Error(`${relativePath} is missing; run npm run compile first`);
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function inputType(input) {
  if (!String(input.type).startsWith("tuple")) return input.type;
  const suffix = input.type.slice("tuple".length);
  return `(${(input.components || []).map(inputType).join(",")})${suffix}`;
}

function abiKey(item) {
  if (["error", "event", "function"].includes(item.type)) {
    return `${item.type}:${item.name}(${(item.inputs || []).map(inputType).join(",")})`;
  }
  return `${item.type}:${JSON.stringify(item)}`;
}

function fixtureAddress(sequence) {
  return `0x${(0xf200n + BigInt(sequence)).toString(16).padStart(40, "0")}`;
}

const combined = new Map();
const facets = ARTIFACTS.map(([name, relativePath], index) => {
  const artifact = readJson(relativePath);
  for (const item of artifact.abi) combined.set(abiKey(item), item);
  const iface = new Interface(artifact.abi);
  const functionSelectors = [...new Set(
    iface.fragments.filter((fragment) => fragment.type === "function").map((fragment) => fragment.selector),
  )].sort();
  return {
    name,
    address: fixtureAddress(index + 2),
    codeHash: artifact.deployedBytecode && artifact.deployedBytecode !== "0x"
      ? keccak256(artifact.deployedBytecode)
      : ZeroHash,
    functionSelectors,
  };
});

const diamondAbi = [...combined.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, item]) => item);

const manifestInput = {
  schemaVersion: "1.0.0",
  protocolVersion: PROTOCOL_PACKAGE.version,
  kind: "local-test-fixture",
  safeForSharedEnvironment: false,
  chainId: 84532,
  network: "base-sepolia-local-test-fixture",
  createdAt: "1970-01-01T00:00:00.000Z",
  diamond: {
    address: fixtureAddress(1),
    deploymentTransactionHash: ZeroHash,
    deploymentBlock: 0,
    startBlock: 0,
  },
  usdc: {
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    decimals: 6,
  },
  facets,
  roles: {
    DEFAULT_ADMIN_ROLE: { id: ZeroHash, expectedAddress: fixtureAddress(20) },
    OPERATOR_ROLE: { id: id("OPERATOR_ROLE"), expectedAddress: fixtureAddress(21) },
    PRICE_PUBLISHER_ROLE: { id: id("PRICE_PUBLISHER_ROLE"), expectedAddress: fixtureAddress(22) },
    ASSIGNER_ROLE: { id: id("ASSIGNER_ROLE"), expectedAddress: fixtureAddress(23) },
    PAUSER_ROLE: { id: id("PAUSER_ROLE"), expectedAddress: fixtureAddress(24) },
    DISPUTE_RESOLVER_ROLE: { id: id("DISPUTE_RESOLVER_ROLE"), expectedAddress: fixtureAddress(25) },
  },
};

const fixtureDirectory = path.join(PACKAGE_ROOT, "fixtures");
fs.mkdirSync(fixtureDirectory, { recursive: true });
fs.writeFileSync(path.join(fixtureDirectory, "local-diamond.abi.json"), `${JSON.stringify(diamondAbi, null, 2)}\n`);
fs.writeFileSync(
  path.join(fixtureDirectory, "local-base-sepolia.manifest.input.json"),
  `${JSON.stringify(manifestInput, null, 2)}\n`,
);

console.log(`Generated local-only protocol fixture from ${ARTIFACTS.length} compiled facets (${diamondAbi.length} ABI entries)`);
