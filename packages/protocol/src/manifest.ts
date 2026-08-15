import {
  keccak256,
  sha256,
  stringToHex,
  toFunctionSelector,
  type Abi,
  type AbiEvent,
  type AbiFunction,
} from "viem";
import { formatAbiItem } from "viem/utils";
import { z } from "zod";

import {
  BASE_SEPOLIA_CHAIN_ID,
  DIAMOND_FACET_NAMES,
  EXPECTED_ERROR_COUNT,
  EXPECTED_EVENT_COUNT,
  EXPECTED_SELECTOR_COUNT,
  MANIFEST_SCHEMA_VERSION,
  OFFICIAL_BASE_SEPOLIA_USDC_ADDRESS,
  ONCHAIN_PROTOCOL_ID,
  ONCHAIN_PROTOCOL_VERSION,
  PACKAGE_VERSION,
  PROTOCOL_ROLE_NAMES,
  STORAGE_LAYOUT_VERSION,
  STORAGE_NAMESPACE,
  USDC_DECIMALS,
  type Hex,
} from "./constants.js";
import { ProtocolError, ProtocolErrorCode } from "./errors.js";

const addressPattern = /^0x[0-9a-fA-F]{40}$/u;
const bytes32Pattern = /^0x[0-9a-fA-F]{64}$/u;
const selectorPattern = /^0x[0-9a-fA-F]{8}$/u;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;

const AddressSchema = z.string().regex(addressPattern);
const Bytes32Schema = z.string().regex(bytes32Pattern);
const SelectorSchema = z.string().regex(selectorPattern);
const RoleSchema = z.object({ id: Bytes32Schema, expectedAddress: AddressSchema }).strict();

export const DeploymentManifestSchema = z.object({
  schemaVersion: z.string().min(1),
  packageVersion: z.string().min(1),
  protocolId: Bytes32Schema,
  protocolVersion: z.number().int().nonnegative(),
  layoutVersion: z.number().int().nonnegative(),
  storageNamespace: Bytes32Schema,
  kind: z.enum(["local-test-fixture", "base-sepolia-deployment"]),
  deployed: z.boolean(),
  safeForSharedEnvironment: z.boolean(),
  chainId: z.literal(BASE_SEPOLIA_CHAIN_ID),
  network: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  diamond: z.object({
    address: AddressSchema,
    owner: AddressSchema,
    codeHash: Bytes32Schema,
    deploymentTransactionHash: Bytes32Schema,
    deploymentBlock: z.number().int().nonnegative(),
    startBlock: z.number().int().nonnegative(),
  }).strict(),
  initialization: z.object({
    initialized: z.boolean(),
    initialPaused: z.literal(true),
    initializerAddress: AddressSchema,
    initializerCodeHash: Bytes32Schema,
    calldataHash: Bytes32Schema,
    transactionHash: Bytes32Schema,
    block: z.number().int().nonnegative(),
    protocolInitializedTopic0: Bytes32Schema,
  }).strict(),
  usdc: z.object({
    address: AddressSchema,
    decimals: z.literal(USDC_DECIMALS),
    codeHash: Bytes32Schema,
  }).strict(),
  facets: z.array(z.object({
    name: z.string().min(1),
    address: AddressSchema,
    codeHash: Bytes32Schema,
    functionSelectors: z.array(SelectorSchema),
  }).strict()),
  roles: z.object({
    DEFAULT_ADMIN_ROLE: RoleSchema,
    OPERATOR_ROLE: RoleSchema,
    UPGRADER_ROLE: RoleSchema,
    PAUSER_ROLE: RoleSchema,
    PRICE_UPDATER_ROLE: RoleSchema,
    ORDER_ASSIGNER_ROLE: RoleSchema,
    DISPUTE_RESOLVER_ROLE: RoleSchema,
  }).strict(),
  build: z.object({
    compiler: z.literal("solc-0.8.24"),
    optimizerRuns: z.literal(200),
    selectorCount: z.literal(EXPECTED_SELECTOR_COUNT),
    eventCount: z.literal(EXPECTED_EVENT_COUNT),
    errorCount: z.literal(EXPECTED_ERROR_COUNT),
  }).strict(),
  abiSha256: Bytes32Schema,
  usdcAbiSha256: Bytes32Schema,
  manifestSha256: Bytes32Schema,
}).strict();

export type DeploymentManifest = z.infer<typeof DeploymentManifestSchema>;
export type ManifestRuntime = "local" | "test" | "base-sepolia" | "shared" | "production";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Canonical(value: unknown): Hex {
  return sha256(stringToHex(stableStringify(value)));
}

export function manifestDigestInput(manifest: DeploymentManifest): Omit<DeploymentManifest, "manifestSha256"> {
  const { manifestSha256: _digest, ...input } = manifest;
  return input;
}

function fail(message: string): never {
  throw new ProtocolError(ProtocolErrorCode.MANIFEST_INVALID, message);
}

function isZero(value: string): boolean {
  return /^0x0+$/iu.test(value);
}

function enforceManifestSemantics(manifest: DeploymentManifest): void {
  if (
    manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    manifest.packageVersion !== PACKAGE_VERSION ||
    manifest.protocolId.toLowerCase() !== ONCHAIN_PROTOCOL_ID ||
    manifest.protocolVersion !== ONCHAIN_PROTOCOL_VERSION ||
    manifest.layoutVersion !== STORAGE_LAYOUT_VERSION ||
    manifest.storageNamespace.toLowerCase() !== STORAGE_NAMESPACE
  ) fail("Unsupported package, manifest, protocol, or storage-layout identity");
  if (manifest.usdc.address.toLowerCase() !== OFFICIAL_BASE_SEPOLIA_USDC_ADDRESS.toLowerCase()) {
    fail("Manifest must use official Base Sepolia USDC");
  }
  if (manifest.diamond.address.toLowerCase() === ZERO_ADDRESS || isZero(manifest.diamond.codeHash)) {
    fail("Diamond identity must be nonzero");
  }

  const facetNames = manifest.facets.map(({ name }) => name);
  if (
    facetNames.length !== DIAMOND_FACET_NAMES.length ||
    [...facetNames].sort().join("|") !== [...DIAMOND_FACET_NAMES].sort().join("|")
  ) fail("Manifest must contain the exact v2 facet set");
  const facetAddresses = new Set<string>();
  const selectors = new Set<string>();
  for (const facet of manifest.facets) {
    const address = facet.address.toLowerCase();
    if (
      address === ZERO_ADDRESS || address === manifest.diamond.address.toLowerCase() ||
      facetAddresses.has(address) || isZero(facet.codeHash)
    ) {
      fail("Facet addresses and code hashes must be unique/nonzero");
    }
    facetAddresses.add(address);
    if (
      facet.functionSelectors.length === 0 ||
      [...facet.functionSelectors].sort().join("|") !== facet.functionSelectors.join("|")
    ) fail(`Facet ${facet.name} selectors must be nonempty and sorted`);
    for (const selector of facet.functionSelectors) {
      const normalized = selector.toLowerCase();
      if (selectors.has(normalized)) fail(`Duplicate selector ${selector}`);
      selectors.add(normalized);
    }
  }
  if (selectors.size !== EXPECTED_SELECTOR_COUNT) fail("Manifest selector count drift");

  const authorityAddresses = [manifest.diamond.owner];
  for (const name of PROTOCOL_ROLE_NAMES) {
    const role = manifest.roles[name];
    const expectedId = name === "DEFAULT_ADMIN_ROLE" ? ZERO_BYTES32 : keccak256(stringToHex(name));
    if (role.id.toLowerCase() !== expectedId.toLowerCase()) fail(`Role id drift for ${name}`);
    authorityAddresses.push(role.expectedAddress);
  }
  const normalizedAuthorities = authorityAddresses.map((address) => address.toLowerCase());
  if (
    normalizedAuthorities.some((address) => address === ZERO_ADDRESS) ||
    new Set(normalizedAuthorities).size !== normalizedAuthorities.length ||
    normalizedAuthorities.some((address) =>
      address === manifest.diamond.address.toLowerCase() || facetAddresses.has(address))
  ) fail("Diamond owner and seven application roles must be nonzero and mutually distinct");

  const initializedTopic = keccak256(stringToHex(
    "ProtocolInitialized(bytes32,uint256,uint256,bytes32,address,address,bytes32,bytes32)",
  ));
  if (manifest.initialization.protocolInitializedTopic0.toLowerCase() !== initializedTopic.toLowerCase()) {
    fail("ProtocolInitialized topic drift");
  }
  const initializerAddress = manifest.initialization.initializerAddress.toLowerCase();
  if (
    initializerAddress === ZERO_ADDRESS || initializerAddress === manifest.diamond.address.toLowerCase() ||
    facetAddresses.has(initializerAddress) || normalizedAuthorities.includes(initializerAddress) ||
    isZero(manifest.initialization.initializerCodeHash) || isZero(manifest.initialization.calldataHash)
  ) {
    fail("Initializer code/calldata commitments must be nonzero");
  }

  if (manifest.kind === "local-test-fixture") {
    if (
      manifest.network !== "base-sepolia-local-v2-non-deployed" ||
      manifest.deployed || manifest.safeForSharedEnvironment || manifest.initialization.initialized ||
      !isZero(manifest.diamond.deploymentTransactionHash) || manifest.diamond.deploymentBlock !== 0 ||
      manifest.diamond.startBlock !== 0 || !isZero(manifest.initialization.transactionHash) ||
      manifest.initialization.block !== 0 || !isZero(manifest.usdc.codeHash)
    ) fail("Local fixture must remain conspicuously non-deployed and non-shared");
  } else if (
    manifest.network !== "base-sepolia" ||
    !manifest.deployed || !manifest.safeForSharedEnvironment || !manifest.initialization.initialized ||
    isZero(manifest.diamond.deploymentTransactionHash) || manifest.diamond.deploymentBlock === 0 ||
    manifest.diamond.startBlock !== manifest.diamond.deploymentBlock ||
    isZero(manifest.initialization.transactionHash) || manifest.initialization.block === 0 ||
    manifest.initialization.block < manifest.diamond.deploymentBlock ||
    isZero(manifest.usdc.codeHash)
  ) fail("Shared Base Sepolia manifest lacks reviewed deployment/initialization proof");
}

export function parseDeploymentManifest(value: unknown): DeploymentManifest {
  const parsed = DeploymentManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new ProtocolError(ProtocolErrorCode.MANIFEST_INVALID, parsed.error.issues[0]?.message);
  }
  const manifest = parsed.data;
  enforceManifestSemantics(manifest);
  const calculated = sha256Canonical(manifestDigestInput(manifest));
  if (calculated.toLowerCase() !== manifest.manifestSha256.toLowerCase()) {
    throw new ProtocolError(ProtocolErrorCode.MANIFEST_DIGEST_MISMATCH);
  }
  return manifest;
}

export function assertManifestRuntime(manifestValue: unknown, runtime: ManifestRuntime): DeploymentManifest {
  const manifest = parseDeploymentManifest(manifestValue);
  if (manifest.kind === "local-test-fixture" && runtime !== "local" && runtime !== "test") {
    throw new ProtocolError(ProtocolErrorCode.MANIFEST_FIXTURE_FORBIDDEN);
  }
  if (runtime !== "local" && runtime !== "test" && !manifest.safeForSharedEnvironment) {
    throw new ProtocolError(ProtocolErrorCode.MANIFEST_FIXTURE_FORBIDDEN);
  }
  return manifest;
}

function assertOrderCreated(abi: Abi): void {
  const events = abi.filter(
    (item): item is AbiEvent => item.type === "event" && item.name === "OrderCreated",
  );
  if (events.length !== 1) fail("ABI must contain exactly one canonical OrderCreated event");
  const inputs = events[0]?.inputs ?? [];
  const expected = [
    ["orderId", "bytes32", true], ["user", "address", true], ["orderType", "uint8", true],
    ["usdcAmount", "uint256", false], ["fiatAmountE6", "uint256", false],
    ["selectedPriceE6", "uint256", false], ["roundId", "uint256", false],
    ["deadline", "uint256", false], ["createdAt", "uint256", false],
    ["orderNumber", "uint256", false],
  ] as const;
  if (
    inputs.length !== expected.length ||
    inputs.some((input, index) =>
      input.name !== expected[index]?.[0] || input.type !== expected[index]?.[1] ||
      Boolean(input.indexed) !== expected[index]?.[2])
  ) fail("OrderCreated signature/field names drifted from canonical v2");
}

export function assertDiamondAbi(manifest: DeploymentManifest, abi: Abi): void {
  if (sha256Canonical(abi).toLowerCase() !== manifest.abiSha256.toLowerCase()) {
    throw new ProtocolError(ProtocolErrorCode.ABI_DIGEST_MISMATCH);
  }
  const functions = abi.filter((item): item is AbiFunction => item.type === "function");
  const events = abi.filter((item): item is AbiEvent => item.type === "event");
  const errors = abi.filter((item) => item.type === "error");
  if (
    functions.length !== EXPECTED_SELECTOR_COUNT || events.length !== EXPECTED_EVENT_COUNT ||
    errors.length !== EXPECTED_ERROR_COUNT
  ) fail("ABI surface count drift");
  const names = new Set(functions.map(({ name }) => name));
  for (const required of [
    "assignOrderCandidates", "acceptOrder", "confirmFiatReceived", "createBuyOrder",
    "createSellOrder", "markFiatSent", "protocolVersion", "publishPriceRound", "resolveDispute",
  ]) if (!names.has(required)) fail(`ABI lacks required v2 function ${required}`);
  for (const forbidden of [
    "addPaymentChannel", "confirmPayment", "getAllMerchants", "getPendingChannels",
    "getUserOrders", "initV2", "markPaymentSent", "setOrderPricing",
  ]) if (names.has(forbidden)) fail(`ABI contains forbidden legacy function ${forbidden}`);

  const abiSelectors = functions.map((item) => toFunctionSelector(formatAbiItem(item))).sort();
  const manifestSelectors = manifest.facets.flatMap(({ functionSelectors }) => functionSelectors).sort();
  if (abiSelectors.join("|").toLowerCase() !== manifestSelectors.join("|").toLowerCase()) {
    fail("Manifest selector set does not match canonical Diamond ABI");
  }
  assertOrderCreated(abi);
}

export function assertProtocolBoundary(
  manifestValue: unknown,
  abi: Abi,
  runtime: ManifestRuntime,
): DeploymentManifest {
  const manifest = assertManifestRuntime(manifestValue, runtime);
  assertDiamondAbi(manifest, abi);
  return manifest;
}
