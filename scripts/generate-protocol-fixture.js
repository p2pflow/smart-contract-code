const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { Interface, ZeroHash, id, keccak256 } = require("ethers");

const ROOT = path.resolve(__dirname, "..");
const PACKAGE_ROOT = path.join(ROOT, "packages", "protocol");
const CHECK_ONLY = process.argv.includes("--check");
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
const PROTOCOL_ID = id("P2PFLOW_BASE_SEPOLIA_MARKETPLACE_V2");
const STORAGE_NAMESPACE = id("p2pflow.app.storage.v2");
const OFFICIAL_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const EXPECTED = Object.freeze({ selectors: 76, events: 39, errors: 70 });
const EXPECTED_ABI_SHA256 = "0x2ff9f22c565dab812c496ff5fc1825c0734e51dd87fdd5c1dcd03b225d398147";

const FACETS = Object.freeze([
  "AccessControlFacet",
  "AssignmentFacet",
  "ConfigFacet",
  "DiamondCutFacet",
  "DiamondLoupeFacet",
  "DisputeFacet",
  "MerchantFacet",
  "OrderFacet",
  "OwnershipFacet",
  "PricingFacet",
]);
const EXPECTED_FACET_SIGNATURES = Object.freeze({
  AccessControlFacet: [
    "DEFAULT_ADMIN_ROLE()", "DISPUTE_RESOLVER_ROLE()", "OPERATOR_ROLE()",
    "ORDER_ASSIGNER_ROLE()", "PAUSER_ROLE()", "PRICE_UPDATER_ROLE()", "UPGRADER_ROLE()",
    "getRoleAdmin(bytes32)", "getRoleMemberCount(bytes32)", "grantRole(bytes32,address)",
    "hasRole(bytes32,address)", "renounceRole(bytes32,address)", "revokeRole(bytes32,address)",
  ],
  AssignmentFacet: [
    "assignOrderCandidates(bytes32,uint256,(address,bytes32)[],bytes32)",
    "expireAssignment(bytes32,uint256)", "getAssignment(bytes32)",
  ],
  ConfigFacet: [
    "getConfig()", "getCustodyTotals()", "getSafetyConfig()", "isProtocolInitialized()",
    "pausePlatform()", "protocolId()", "protocolVersion()", "setMinMerchantStake(uint256)",
    "setSafetyConfig((uint256,uint256,uint256,uint256))", "storageLayoutVersion()",
    "storageNamespace()", "unpausePlatform()",
  ],
  DiamondCutFacet: ["diamondCut((address,uint8,bytes4[])[],address,bytes)"],
  DiamondLoupeFacet: [
    "facetAddress(bytes4)", "facetAddresses()", "facetFunctionSelectors(address)", "facets()",
    "supportsInterface(bytes4)",
  ],
  DisputeFacet: ["getDispute(bytes32)", "openDispute(bytes32)", "resolveDispute(bytes32,uint8)"],
  MerchantFacet: [
    "approveMerchant(address)", "depositLiquidity(uint256)", "depositStake(uint256)",
    "getChannel(bytes32)", "getChannelCapacity(bytes32)", "getMerchant(address)",
    "getMerchantBalances(address)", "getMerchantChannelPage(address,uint256,uint256)",
    "getMerchantPage(uint256,uint256)", "registerMerchant(uint256)",
    "registerPaymentChannel(uint8,uint256)", "requestMerchantExit()",
    "reviewPaymentChannel(bytes32,uint8)", "setAvailability(uint8)",
    "setChannelAvailability(bytes32,uint8)", "setChannelFiatCapacity(bytes32,uint256)",
    "setMerchantStatus(address,uint8)", "terminatePaymentChannel(bytes32)",
    "withdrawLiquidity(uint256)", "withdrawStake()",
  ],
  OrderFacet: [
    "acceptOrder(bytes32,bytes32)", "cancelOrder(bytes32)", "confirmFiatReceived(bytes32)",
    "createBuyOrder(uint256,uint256,uint256,uint256)",
    "createSellOrder(uint256,uint256,uint256,uint256)",
    "getMerchantOrderIdPage(address,uint256,uint256)", "getOrder(bytes32)",
    "getOrderIdPage(uint256,uint256)", "getUserOrderIdPage(address,uint256,uint256)",
    "markFiatSent(bytes32)", "recoverExpiredOrder(bytes32)", "rejectAssignment(bytes32,bytes32)",
  ],
  OwnershipFacet: ["owner()", "transferOwnership(address)"],
  PricingFacet: [
    "getLatestPriceRound()", "getPricePolicy()", "getPriceRound(uint256)",
    "publishPriceRound(uint256,uint256,uint256,uint256,uint256,bytes32,uint8)",
    "setPricePolicy((uint256,uint256,uint256))",
  ],
});
const FORBIDDEN_FUNCTIONS = Object.freeze([
  "addPaymentChannel", "confirmPayment", "getAllMerchants", "getPendingChannels",
  "getUserOrders", "markPaymentSent", "setOrderPricing",
]);

function readJson(relativePath) {
  const target = path.join(ROOT, relativePath);
  if (!fs.existsSync(target)) throw new Error(`${relativePath} is missing; run npm run compile first`);
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function artifactFor(name, directory = "facets") {
  return readJson(`artifacts/contracts/${directory}/${name}.sol/${name}.json`);
}

function inputType(input) {
  if (!String(input.type).startsWith("tuple")) return input.type;
  return `(${(input.components || []).map(inputType).join(",")})${input.type.slice("tuple".length)}`;
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

function codeHash(artifact, label) {
  if (!artifact.deployedBytecode || artifact.deployedBytecode === "0x") {
    throw new Error(`${label} has no deployed bytecode`);
  }
  return keccak256(artifact.deployedBytecode);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

function sha256Canonical(value) {
  return `0x${crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

const combined = new Map();
const selectorOwners = new Map();
const eventTopics = new Map();
const errorSelectors = new Map();
const namedSignatures = new Map();

function addAbiItem(item, source) {
  const key = abiKey(item);
  const previous = combined.get(key);
  if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(item)) {
    throw new Error(`ABI shape/indexedness drift for ${key} between ${previous.source || "prior"} and ${source}`);
  }
  if (item.type === "event" || item.type === "error") {
    const signature = `${item.name}(${(item.inputs || []).map(inputType).join(",")})`;
    const namedKey = `${item.type}:${item.name}`;
    const priorSignature = namedSignatures.get(namedKey);
    if (priorSignature && priorSignature !== signature) {
      throw new Error(`${item.type} name drift: ${priorSignature} vs ${signature}`);
    }
    namedSignatures.set(namedKey, signature);
    const digest = id(signature);
    const collisionKey = item.type === "event" ? digest : digest.slice(0, 10);
    const collisionMap = item.type === "event" ? eventTopics : errorSelectors;
    const collided = collisionMap.get(collisionKey);
    if (collided && collided !== signature) {
      throw new Error(`${item.type} selector/topic collision: ${collided} vs ${signature}`);
    }
    collisionMap.set(collisionKey, signature);
  }
  if (previous === undefined) combined.set(key, item);
}

const facetItems = FACETS.map((name, index) => {
  const artifact = artifactFor(name);
  for (const item of artifact.abi) addAbiItem(item, name);
  const iface = new Interface(artifact.abi);
  const functionFragments = iface.fragments
    .filter((fragment) => fragment.type === "function")
    .sort((left, right) => left.format("sighash").localeCompare(right.format("sighash")));
  const signatures = functionFragments.map((fragment) => fragment.format("sighash"));
  const expectedSignatures = [...EXPECTED_FACET_SIGNATURES[name]].sort((left, right) => left.localeCompare(right));
  if (signatures.join("|") !== expectedSignatures.join("|")) {
    throw new Error(`Frozen v2 function signature drift in ${name}`);
  }
  const functionSelectors = functionFragments.map((fragment) => fragment.selector).sort();
  for (const selector of functionSelectors) {
    const previous = selectorOwners.get(selector);
    if (previous) throw new Error(`Duplicate selector ${selector}: ${previous} and ${name}`);
    selectorOwners.set(selector, name);
  }
  return {
    name,
    address: fixtureAddress(index + 2),
    codeHash: codeHash(artifact, name),
    functionSelectors,
  };
});

const initializer = artifactFor("DiamondInitV2", "upgradeInitializers");
for (const item of initializer.abi) {
  if (item.type === "event" || item.type === "error") addAbiItem(item, "DiamondInitV2");
}

const diamondAbi = [...combined.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, item]) => item);
const abiSha256 = sha256Canonical(diamondAbi);
if (abiSha256 !== EXPECTED_ABI_SHA256) {
  throw new Error(`Frozen canonical v2 ABI drift: ${abiSha256} != ${EXPECTED_ABI_SHA256}`);
}
const functionNames = new Set(diamondAbi.filter((item) => item.type === "function").map((item) => item.name));
for (const name of FORBIDDEN_FUNCTIONS) {
  if (functionNames.has(name)) throw new Error(`Legacy selector ${name} survived v2 ABI generation`);
}
if (functionNames.has("initV2")) throw new Error("Initializer function must not be a Diamond selector");

const counts = {
  selectors: selectorOwners.size,
  events: diamondAbi.filter((item) => item.type === "event").length,
  errors: diamondAbi.filter((item) => item.type === "error").length,
};
for (const [kind, expected] of Object.entries(EXPECTED)) {
  if (counts[kind] !== expected) throw new Error(`Frozen ${kind} count drift: ${counts[kind]} != ${expected}`);
}

const diamondArtifact = readJson("artifacts/contracts/Diamond.sol/Diamond.json");
const owner = fixtureAddress(30);
const roleAddresses = {
  DEFAULT_ADMIN_ROLE: fixtureAddress(31),
  OPERATOR_ROLE: fixtureAddress(32),
  UPGRADER_ROLE: fixtureAddress(33),
  PAUSER_ROLE: fixtureAddress(34),
  PRICE_UPDATER_ROLE: fixtureAddress(35),
  ORDER_ASSIGNER_ROLE: fixtureAddress(36),
  DISPUTE_RESOLVER_ROLE: fixtureAddress(37),
};
const roleIds = {
  DEFAULT_ADMIN_ROLE: ZeroHash,
  OPERATOR_ROLE: id("OPERATOR_ROLE"),
  UPGRADER_ROLE: id("UPGRADER_ROLE"),
  PAUSER_ROLE: id("PAUSER_ROLE"),
  PRICE_UPDATER_ROLE: id("PRICE_UPDATER_ROLE"),
  ORDER_ASSIGNER_ROLE: id("ORDER_ASSIGNER_ROLE"),
  DISPUTE_RESOLVER_ROLE: id("DISPUTE_RESOLVER_ROLE"),
};
const roles = Object.fromEntries(Object.keys(roleAddresses).map((name) => [name, {
  id: roleIds[name],
  expectedAddress: roleAddresses[name],
}]));
const initInput = {
  usdcToken: OFFICIAL_USDC,
  minMerchantStakeUsdc: 100_000_000n,
  safety: {
    orderLifetimeSeconds: 600n,
    assignmentLifetimeSeconds: 300n,
    acceptedRecoverySeconds: 1_800n,
    maxQuoteValiditySeconds: 300n,
  },
  pricePolicy: {
    sourceQuorum: 2n,
    maxAgeSeconds: 300n,
    maxDeviationBps: 300n,
  },
  roles: {
    defaultAdmin: roleAddresses.DEFAULT_ADMIN_ROLE,
    operator: roleAddresses.OPERATOR_ROLE,
    upgrader: roleAddresses.UPGRADER_ROLE,
    pauser: roleAddresses.PAUSER_ROLE,
    priceUpdater: roleAddresses.PRICE_UPDATER_ROLE,
    orderAssigner: roleAddresses.ORDER_ASSIGNER_ROLE,
    disputeResolver: roleAddresses.DISPUTE_RESOLVER_ROLE,
  },
};
const initCalldata = new Interface(initializer.abi).encodeFunctionData("initV2", [initInput]);

const manifestInput = {
  schemaVersion: "2.0.0",
  packageVersion: PACKAGE_JSON.version,
  protocolId: PROTOCOL_ID,
  protocolVersion: 2,
  layoutVersion: 2,
  storageNamespace: STORAGE_NAMESPACE,
  kind: "local-test-fixture",
  deployed: false,
  safeForSharedEnvironment: false,
  chainId: 84532,
  network: "base-sepolia-local-v2-non-deployed",
  createdAt: "1970-01-01T00:00:00.000Z",
  diamond: {
    address: fixtureAddress(1),
    owner,
    codeHash: codeHash(diamondArtifact, "Diamond"),
    deploymentTransactionHash: ZeroHash,
    deploymentBlock: 0,
    startBlock: 0,
  },
  initialization: {
    initialized: false,
    initialPaused: true,
    initializerAddress: fixtureAddress(FACETS.length + 2),
    initializerCodeHash: codeHash(initializer, "DiamondInitV2"),
    calldataHash: keccak256(initCalldata),
    transactionHash: ZeroHash,
    block: 0,
    protocolInitializedTopic0: id(
      "ProtocolInitialized(bytes32,uint256,uint256,bytes32,address,address,bytes32,bytes32)",
    ),
  },
  usdc: {
    address: OFFICIAL_USDC,
    decimals: 6,
    codeHash: ZeroHash,
  },
  facets: facetItems,
  roles,
  build: {
    compiler: "solc-0.8.24",
    optimizerRuns: 200,
    selectorCount: counts.selectors,
    eventCount: counts.events,
    errorCount: counts.errors,
  },
};

const fixtureDirectory = path.join(PACKAGE_ROOT, "fixtures");
const outputs = new Map([
  [path.join(fixtureDirectory, "local-diamond.abi.json"), `${JSON.stringify(diamondAbi, null, 2)}\n`],
  [
    path.join(fixtureDirectory, "local-base-sepolia.manifest.input.json"),
    `${JSON.stringify(manifestInput, null, 2)}\n`,
  ],
]);
for (const [target, content] of outputs) {
  if (CHECK_ONLY) {
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content) {
      throw new Error(`${path.relative(ROOT, target)} has generated drift; run npm run protocol:fixture`);
    }
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

console.log(
  `${CHECK_ONLY ? "Verified" : "Generated"} non-deployed v2 fixture: ${FACETS.length} facets, ${counts.selectors} selectors, ` +
  `${counts.events} events, ${counts.errors} errors`,
);
