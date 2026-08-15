import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { AbiCoder, Contract, Interface, JsonRpcProvider, keccak256 } from "ethers";
import {
  assertAuthorities,
  assertChainAndReceipts,
  assertCodeAndToken,
  assertInitializationEvidence,
  assertLoupe,
  assertProtocolIdentity,
} from "./preflight-v2-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const protocol = await import(pathToFileURL(path.join(root, "packages", "protocol", "dist", "index.js")).href);
const OFFICIAL_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const ZERO_HASH = `0x${"00".repeat(32)}`;

function option(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function sameHex(left, right) {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function exactSet(actual, expected, label) {
  const left = [...actual].map((value) => String(value).toLowerCase()).sort();
  const right = [...expected].map((value) => String(value).toLowerCase()).sort();
  if (left.join("|") !== right.join("|")) throw new Error(`${label} mismatch`);
}

async function codeHash(provider, address, label) {
  const code = await provider.getCode(address);
  if (code === "0x") throw new Error(`${label} has no code`);
  return keccak256(code);
}

const fixturePath = path.join(
  root,
  "packages",
  "protocol",
  "artifacts",
  "local-base-sepolia.manifest.json",
);

if (process.argv.includes("--check-local-fixture")) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const parsed = protocol.assertProtocolBoundary(fixture, protocol.DIAMOND_ABI, "test");
  if (parsed.deployed || parsed.safeForSharedEnvironment || parsed.initialization.initialized) {
    throw new Error("Local fixture lost its non-deployed fail-closed markers");
  }
  let sharedRejected = false;
  try {
    protocol.assertProtocolBoundary(fixture, protocol.DIAMOND_ABI, "base-sepolia");
  } catch (error) {
    sharedRejected = error?.code === protocol.ProtocolErrorCode.MANIFEST_FIXTURE_FORBIDDEN;
  }
  if (!sharedRejected) throw new Error("Local fixture was not rejected for shared Base Sepolia");
  console.log("Local v2 artifact is internally valid, explicitly non-deployed, and shared-runtime forbidden");
  process.exit(0);
}

const manifestPathValue = option("--manifest");
const rpcUrl = option("--rpc-url") ?? process.env.BASE_SEPOLIA_RPC_URL;
if (!manifestPathValue || !rpcUrl) {
  throw new Error(
    "Read-only preflight requires --manifest <reviewed-v2-manifest.json> and an injected " +
    "BASE_SEPOLIA_RPC_URL (or --rpc-url only for a non-secret local endpoint). No .env file or manifest fallback is used.",
  );
}
const manifestPath = path.resolve(process.cwd(), manifestPathValue);
if (path.resolve(manifestPath) === path.resolve(fixturePath)) {
  throw new Error("The non-deployed local fixture cannot be used for shared Base Sepolia preflight");
}
const rawManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const manifest = protocol.assertProtocolBoundary(rawManifest, protocol.DIAMOND_ABI, "base-sepolia");
if (protocol.sha256Canonical(protocol.USDC_ABI).toLowerCase() !== manifest.usdcAbiSha256.toLowerCase()) {
  throw new Error("Canonical USDC ABI digest mismatch");
}
if (
  manifest.kind !== "base-sepolia-deployment" || !manifest.deployed ||
  !manifest.safeForSharedEnvironment || !manifest.initialization.initialized
) throw new Error("Manifest is not an independently reviewed initialized Base Sepolia deployment");
if (!sameHex(manifest.usdc.address, OFFICIAL_USDC)) throw new Error("Official Base Sepolia USDC mismatch");

const provider = new JsonRpcProvider(rpcUrl);
const network = await provider.getNetwork();
if (network.chainId !== 84_532n) throw new Error(`Wrong chain id ${network.chainId}`);

const deploymentReceipt = await provider.getTransactionReceipt(manifest.diamond.deploymentTransactionHash);
if (
  deploymentReceipt === null || deploymentReceipt.status !== 1 ||
  deploymentReceipt.blockNumber !== manifest.diamond.deploymentBlock ||
  !sameHex(deploymentReceipt.contractAddress, manifest.diamond.address)
) throw new Error("Fresh Diamond creation receipt proof mismatch");
const deploymentBlock = await provider.getBlock(manifest.diamond.deploymentBlock);
if (deploymentBlock === null || new Date(deploymentBlock.timestamp * 1_000).toISOString() !== manifest.createdAt) {
  throw new Error("Manifest createdAt does not equal the Diamond deployment-block timestamp");
}

const initializationReceipt = await provider.getTransactionReceipt(manifest.initialization.transactionHash);
if (
  initializationReceipt === null || initializationReceipt.status !== 1 ||
  initializationReceipt.blockNumber !== manifest.initialization.block
) throw new Error("v2 initialization receipt proof mismatch");
const initTransaction = await provider.getTransaction(manifest.initialization.transactionHash);
assertChainAndReceipts(manifest, {
  chainId: network.chainId,
  deploymentReceipt,
  deploymentCreatedAt: deploymentBlock === null
    ? undefined
    : new Date(deploymentBlock.timestamp * 1_000).toISOString(),
  initializationReceipt,
  initializationTransaction: initTransaction,
});
if (
  initTransaction === null || !sameHex(initTransaction.to, manifest.diamond.address) ||
  !sameHex(initTransaction.from, manifest.diamond.owner) || initTransaction.value !== 0n
) {
  throw new Error("Initialization transaction target mismatch");
}
const diamondInterface = new Interface(protocol.DIAMOND_ABI);
const parsedInit = diamondInterface.parseTransaction({ data: initTransaction.data, value: initTransaction.value });
if (
  parsedInit?.name !== "diamondCut" ||
  !sameHex(parsedInit.args[1], manifest.initialization.initializerAddress) ||
  !sameHex(keccak256(parsedInit.args[2]), manifest.initialization.calldataHash)
) throw new Error("Initializer target/calldata commitment mismatch");

const initializerInterface = new Interface([
  "function initV2((address usdcToken,uint256 minMerchantStakeUsdc," +
    "(uint256 orderLifetimeSeconds,uint256 assignmentLifetimeSeconds,uint256 acceptedRecoverySeconds,uint256 maxQuoteValiditySeconds) safety," +
    "(uint256 sourceQuorum,uint256 maxAgeSeconds,uint256 maxDeviationBps) pricePolicy," +
    "(address defaultAdmin,address operator,address upgrader,address pauser,address priceUpdater,address orderAssigner,address disputeResolver) roles) input)",
]);
const decodedInit = initializerInterface.decodeFunctionData("initV2", parsedInit.args[2]).input;
if (!sameHex(decodedInit.usdcToken, manifest.usdc.address)) throw new Error("Initializer USDC mismatch");
const manifestRoleAccounts = [
  manifest.roles.DEFAULT_ADMIN_ROLE.expectedAddress,
  manifest.roles.OPERATOR_ROLE.expectedAddress,
  manifest.roles.UPGRADER_ROLE.expectedAddress,
  manifest.roles.PAUSER_ROLE.expectedAddress,
  manifest.roles.PRICE_UPDATER_ROLE.expectedAddress,
  manifest.roles.ORDER_ASSIGNER_ROLE.expectedAddress,
  manifest.roles.DISPUTE_RESOLVER_ROLE.expectedAddress,
];
exactSet([...decodedInit.roles], manifestRoleAccounts, "Initializer role accounts");

const expectedCutFacets = manifest.facets.filter(({ name }) => name !== "DiamondCutFacet");
if (parsedInit.args[0].length !== expectedCutFacets.length) throw new Error("Initialization cut facet count mismatch");
exactSet(
  parsedInit.args[0].map((cut) => cut.facetAddress),
  expectedCutFacets.map(({ address }) => address),
  "Initialization cut facet addresses",
);
for (const cut of parsedInit.args[0]) {
  if (cut.action !== 0n) throw new Error("Fresh initialization may only add facet selectors");
  const facet = expectedCutFacets.find(({ address }) => sameHex(address, cut.facetAddress));
  if (facet === undefined) throw new Error("Initialization cut contains an unexpected facet");
  exactSet(cut.functionSelectors, facet.functionSelectors, `${facet.name} initialization cut`);
}

const parsedLogs = initializationReceipt.logs
  .filter((log) => sameHex(log.address, manifest.diamond.address))
  .flatMap((log) => {
    try {
      const decoded = diamondInterface.parseLog(log);
      return decoded === null ? [] : [decoded];
    } catch {
      return [];
    }
  });
const events = (name) => parsedLogs.filter((entry) => entry.name === name);
const initialized = events("ProtocolInitialized");
if (initialized.length !== 1) throw new Error("Expected exactly one ProtocolInitialized event from the Diamond");
const initializedArgs = initialized[0].args;
const coder = AbiCoder.defaultAbiCoder();
const rolesDigest = keccak256(coder.encode(
  ["tuple(address defaultAdmin,address operator,address upgrader,address pauser,address priceUpdater,address orderAssigner,address disputeResolver)"],
  [decodedInit.roles],
));
const configurationDigest = keccak256(coder.encode(
  [
    "address",
    "uint256",
    "tuple(uint256 orderLifetimeSeconds,uint256 assignmentLifetimeSeconds,uint256 acceptedRecoverySeconds,uint256 maxQuoteValiditySeconds)",
    "tuple(uint256 sourceQuorum,uint256 maxAgeSeconds,uint256 maxDeviationBps)",
  ],
  [decodedInit.usdcToken, decodedInit.minMerchantStakeUsdc, decodedInit.safety, decodedInit.pricePolicy],
));
if (
  !sameHex(initializedArgs.protocolId, manifest.protocolId) ||
  initializedArgs.protocolVersion !== BigInt(manifest.protocolVersion) ||
  initializedArgs.layoutVersion !== BigInt(manifest.layoutVersion) ||
  !sameHex(initializedArgs.storageNamespace, manifest.storageNamespace) ||
  !sameHex(initializedArgs.usdcToken, manifest.usdc.address) ||
  !sameHex(initializedArgs.diamondOwner, manifest.diamond.owner) ||
  !sameHex(initializedArgs.rolesDigest, rolesDigest) ||
  !sameHex(initializedArgs.configurationDigest, configurationDigest)
) throw new Error("ProtocolInitialized event fields do not match the reviewed manifest/init calldata");

const roleEvents = events("RoleGranted");
if (roleEvents.length !== 7) throw new Error("Expected exactly seven bootstrap RoleGranted events");
const expectedRoleEvents = protocol.PROTOCOL_ROLE_NAMES.map((name) =>
  `${manifest.roles[name].id.toLowerCase()}|${manifest.roles[name].expectedAddress.toLowerCase()}|${manifest.diamond.owner.toLowerCase()}`);
const actualRoleEvents = roleEvents.map(({ args }) =>
  `${args.role.toLowerCase()}|${args.account.toLowerCase()}|${args.sender.toLowerCase()}`);
exactSet(actualRoleEvents, expectedRoleEvents, "Bootstrap RoleGranted events");

const safetyEvents = events("SafetyConfigUpdated");
const stakeEvents = events("MinMerchantStakeUpdated");
const policyEvents = events("PricePolicyUpdated");
const pauseEvents = events("PlatformPaused");
if (
  safetyEvents.length !== 1 || stakeEvents.length !== 1 || policyEvents.length !== 1 ||
  pauseEvents.length !== 1
) {
  throw new Error("Missing unique bootstrap safety/stake/price-policy events");
}
const safetyArgs = safetyEvents[0].args;
if (
  safetyArgs.orderLifetimeSeconds !== decodedInit.safety.orderLifetimeSeconds ||
  safetyArgs.assignmentLifetimeSeconds !== decodedInit.safety.assignmentLifetimeSeconds ||
  safetyArgs.acceptedRecoverySeconds !== decodedInit.safety.acceptedRecoverySeconds ||
  safetyArgs.maxQuoteValiditySeconds !== decodedInit.safety.maxQuoteValiditySeconds ||
  !sameHex(safetyArgs.by, manifest.diamond.owner) ||
  stakeEvents[0].args.minMerchantStakeUsdc !== decodedInit.minMerchantStakeUsdc ||
  !sameHex(stakeEvents[0].args.by, manifest.diamond.owner) ||
  policyEvents[0].args.sourceQuorum !== decodedInit.pricePolicy.sourceQuorum ||
  policyEvents[0].args.maxAgeSeconds !== decodedInit.pricePolicy.maxAgeSeconds ||
  policyEvents[0].args.maxDeviationBps !== decodedInit.pricePolicy.maxDeviationBps ||
  !sameHex(policyEvents[0].args.by, manifest.diamond.owner) ||
  !sameHex(pauseEvents[0].args.by, manifest.diamond.owner)
) throw new Error("Bootstrap config events do not match initializer calldata");
assertInitializationEvidence(manifest, {
  initializerAddress: parsedInit.args[1],
  calldataHash: keccak256(parsedInit.args[2]),
  cutMatches: true,
  protocolInitializedMatches: true,
  roleEventsMatch: true,
  configEventsMatch: true,
});

const diamondCodeHash = await codeHash(provider, manifest.diamond.address, "Diamond");
const usdcCodeHash = await codeHash(provider, manifest.usdc.address, "USDC");
const initializerCodeHash = await codeHash(provider, manifest.initialization.initializerAddress, "DiamondInitV2");
const usdc = new Contract(manifest.usdc.address, protocol.USDC_ABI, provider);
const usdcDecimals = await usdc.decimals();
assertCodeAndToken(manifest, {
  diamondCodeHash,
  usdcAddress: manifest.usdc.address,
  usdcCodeHash,
  usdcDecimals,
  initializerCodeHash,
});
if (!sameHex(diamondCodeHash, manifest.diamond.codeHash)) {
  throw new Error("Diamond runtime bytecode hash mismatch");
}
if (!sameHex(usdcCodeHash, manifest.usdc.codeHash)) {
  throw new Error("USDC runtime bytecode hash mismatch");
}
if (!sameHex(initializerCodeHash, manifest.initialization.initializerCodeHash)) {
  throw new Error("Initializer runtime bytecode hash mismatch");
}

if (usdcDecimals !== 6n) throw new Error("USDC decimals mismatch");
const diamond = new Contract(manifest.diamond.address, protocol.DIAMOND_ABI, provider);
const identitySnapshot = {
  initialized: await diamond.isProtocolInitialized(),
  protocolId: await diamond.protocolId(),
  protocolVersion: await diamond.protocolVersion(),
  layoutVersion: await diamond.storageLayoutVersion(),
  storageNamespace: await diamond.storageNamespace(),
  usdcToken: undefined,
  paused: undefined,
  owner: await diamond.owner(),
};
if (identitySnapshot.initialized !== true) throw new Error("Diamond is not initialized");
if (
  !sameHex(identitySnapshot.protocolId, manifest.protocolId) ||
  identitySnapshot.protocolVersion !== BigInt(manifest.protocolVersion) ||
  identitySnapshot.layoutVersion !== BigInt(manifest.layoutVersion) ||
  !sameHex(identitySnapshot.storageNamespace, manifest.storageNamespace)
) throw new Error("On-chain protocol/layout identity mismatch");
const config = await diamond.getConfig();
identitySnapshot.usdcToken = config.usdcToken;
identitySnapshot.paused = config.paused;
assertProtocolIdentity(manifest, identitySnapshot);
if (!sameHex(config.usdcToken, manifest.usdc.address)) throw new Error("Configured custody token mismatch");
if (config.paused !== true) {
  throw new Error("Fresh v2 Diamond must remain paused until independent review and PAUSER release");
}
if (!sameHex(await diamond.owner(), manifest.diamond.owner)) throw new Error("Diamond owner mismatch");

const authorityAddresses = [manifest.diamond.owner];
const authoritySnapshot = { roles: {}, ownerRoleCount: 0, expectedAddressRoleCounts: [] };
for (const name of protocol.PROTOCOL_ROLE_NAMES) {
  const expected = manifest.roles[name];
  const actualId = await diamond[name]();
  const memberCount = await diamond.getRoleMemberCount(expected.id);
  const expectedAuthorized = await diamond.hasRole(expected.id, expected.expectedAddress);
  authoritySnapshot.roles[name] = { id: actualId, memberCount, expectedAuthorized };
  if (!sameHex(actualId, expected.id)) throw new Error(`${name} id mismatch`);
  if (memberCount !== 1n) throw new Error(`${name} must have exactly one member`);
  if (expectedAuthorized !== true) {
    throw new Error(`${name} expected account is not authorized`);
  }
  authorityAddresses.push(expected.expectedAddress);
}
if (new Set(authorityAddresses.map((address) => address.toLowerCase())).size !== 8) {
  throw new Error("Owner and role accounts are not mutually distinct");
}
for (const address of authorityAddresses) {
  let roleCount = 0;
  for (const name of protocol.PROTOCOL_ROLE_NAMES) {
    if (await diamond.hasRole(manifest.roles[name].id, address)) roleCount += 1;
  }
  if ((sameHex(address, manifest.diamond.owner) && roleCount !== 0) || roleCount > 1) {
    throw new Error("Owner/role exclusivity mismatch");
  }
  if (sameHex(address, manifest.diamond.owner)) authoritySnapshot.ownerRoleCount = roleCount;
  else authoritySnapshot.expectedAddressRoleCounts.push(roleCount);
}
assertAuthorities(manifest, authoritySnapshot);

const loupeSnapshot = { facets: {}, facetAddresses: await diamond.facetAddresses() };
for (const facet of manifest.facets) {
  const facetCodeHash = await codeHash(provider, facet.address, facet.name);
  const selectors = await diamond.facetFunctionSelectors(facet.address);
  let selectorOwnersMatch = true;
  for (const selector of facet.functionSelectors) {
    if (!sameHex(await diamond.facetAddress(selector), facet.address)) selectorOwnersMatch = false;
  }
  loupeSnapshot.facets[facet.name] = {
    address: facet.address,
    codeHash: facetCodeHash,
    selectors,
    selectorOwnersMatch,
  };
  if (!sameHex(facetCodeHash, facet.codeHash)) {
    throw new Error(`${facet.name} runtime bytecode hash mismatch`);
  }
  exactSet(selectors, facet.functionSelectors, `${facet.name} selectors`);
  for (const selector of facet.functionSelectors) {
    if (!sameHex(await diamond.facetAddress(selector), facet.address)) {
      throw new Error(`Selector ${selector} ownership mismatch`);
    }
  }
}
assertLoupe(manifest, loupeSnapshot);
exactSet(loupeSnapshot.facetAddresses, manifest.facets.map(({ address }) => address), "Diamond facet addresses");
if (manifest.diamond.deploymentTransactionHash === ZERO_HASH) throw new Error("Missing real deployment proof");

console.log(
  `Read-only v2 preflight passed for Diamond ${manifest.diamond.address} at Base Sepolia block ` +
  `${manifest.diamond.deploymentBlock}; no transaction was signed or sent`,
);
