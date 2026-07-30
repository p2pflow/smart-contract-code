import {
  Address,
  Bytes32,
  HelperMode,
  SelectionPolicy,
} from "./domain/types";
import { isCanonicalVersionIdentifier } from "./domain/validation";
import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_DIAMOND_ADDRESS,
  COUNCIL_BILL_SHA256,
} from "./authority";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
export {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_DIAMOND_ADDRESS,
  COUNCIL_BILL_SHA256,
} from "./authority";

export interface SendGateStatus {
  readonly requested: boolean;
  readonly enabled: boolean;
  readonly blockers: readonly string[];
}

export interface HelperConfig {
  readonly chainId: number;
  readonly diamondAddress: Address;
  readonly primaryRpcUrl: URL;
  readonly fallbackRpcUrl: URL;
  readonly startBlock: bigint;
  readonly finalityConfirmations: number;
  readonly mode: HelperMode;
  readonly sendGate: SendGateStatus;
  readonly council: {
    readonly verdict: "REJECT";
    readonly billSha256: string;
  };
  readonly databaseSecretReference: string;
  readonly redisSecretReference: string;
  readonly helperBuildVersion: string;
  readonly policy: SelectionPolicy;
}

export class ConfigurationError extends Error {
  public readonly missingOrInvalidNames: readonly string[];

  public constructor(names: readonly string[]) {
    super(`Invalid or missing configuration: ${[...names].sort().join(", ")}`);
    this.name = "ConfigurationError";
    this.missingOrInvalidNames = [...names].sort();
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

interface Reader {
  required(name: string): string;
  positiveInteger(name: string): number;
  nonNegativeInteger(name: string): number;
  positiveBigInt(name: string): bigint;
  boolean(name: string, defaultValue?: boolean): boolean;
  url(name: string): URL;
  address(name: string): Address;
  bytes32(name: string): Bytes32;
  errors: string[];
}

function makeReader(environment: Environment): Reader {
  const errors: string[] = [];
  const required = (name: string): string => {
    const value = environment[name]?.trim();
    if (!value) {
      errors.push(name);
      return "";
    }
    return value;
  };

  const parseInteger = (
    name: string,
    minimum: number,
  ): number => {
    const raw = required(name);
    if (!/^\d+$/.test(raw)) {
      if (raw) errors.push(name);
      return minimum;
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum) {
      errors.push(name);
      return minimum;
    }
    return value;
  };

  return {
    required,
    positiveInteger: (name) => parseInteger(name, 1),
    nonNegativeInteger: (name) => parseInteger(name, 0),
    positiveBigInt: (name) => {
      const raw = required(name);
      if (!/^\d+$/.test(raw)) {
        if (raw) errors.push(name);
        return 1n;
      }
      const value = BigInt(raw);
      if (value <= 0n) {
        errors.push(name);
        return 1n;
      }
      return value;
    },
    boolean: (name, defaultValue) => {
      const raw = environment[name]?.trim().toLowerCase();
      if (!raw && defaultValue !== undefined) return defaultValue;
      if (raw === "true") return true;
      if (raw === "false") return false;
      errors.push(name);
      return false;
    },
    url: (name) => {
      const raw = required(name);
      try {
        const result = new URL(raw);
        const loopback =
          result.hostname === "localhost" ||
          result.hostname === "127.0.0.1" ||
          result.hostname === "[::1]";
        if (
          result.protocol !== "https:" &&
          !(result.protocol === "http:" && loopback)
        ) {
          throw new Error("unsupported protocol");
        }
        return result;
      } catch {
        if (raw) errors.push(name);
        return new URL("https://invalid.example.invalid");
      }
    },
    address: (name) => {
      const raw = required(name);
      if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
        if (raw) errors.push(name);
        return ZERO_ADDRESS as Address;
      }
      return raw.toLowerCase() as Address;
    },
    bytes32: (name) => {
      const raw = required(name);
      if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
        if (raw) errors.push(name);
        return ZERO_BYTES32 as Bytes32;
      }
      return raw.toLowerCase() as Bytes32;
    },
    errors,
  };
}

export function loadConfig(environment: Environment): HelperConfig {
  const reader = makeReader(environment);
  const chainId = reader.positiveInteger("CHAIN_ID");
  const diamondAddress = reader.address("DIAMOND_ADDRESS");
  const primaryRpcUrl = reader.url("PRIMARY_RPC_URL");
  const fallbackRpcUrl = reader.url("FALLBACK_RPC_URL");
  const startBlock = BigInt(reader.nonNegativeInteger("START_BLOCK"));
  const finalityConfirmations = reader.positiveInteger("FINALITY_CONFIRMATIONS");

  const modeRaw = environment.HELPER_MODE?.trim().toLowerCase() ?? "shadow";
  if (modeRaw !== "shadow" && modeRaw !== "live") reader.errors.push("HELPER_MODE");
  const mode: HelperMode = modeRaw === "live" ? "live" : "shadow";

  const sendRequested = reader.boolean("ENABLE_TRANSACTION_SENDING", false);
  const councilVerdict = reader.required("COUNCIL_VERDICT");
  const councilBillSha256 = reader.required("COUNCIL_BILL_SHA256");
  const interfaceVerified = reader.boolean("CONTRACT_INTERFACE_VERIFIED", false);
  const deploymentVerified = reader.boolean(
    "BASE_SEPOLIA_DEPLOYMENT_VERIFIED",
    false,
  );
  const canaryApproved = reader.boolean("CANARY_APPROVED", false);

  const databaseSecretReference = reader.required("DATABASE_SECRET_REFERENCE");
  const redisSecretReference = reader.required("REDIS_SECRET_REFERENCE");
  const helperBuildVersion = reader.required("HELPER_BUILD_VERSION");
  if (!isCanonicalVersionIdentifier(helperBuildVersion)) {
    reader.errors.push("HELPER_BUILD_VERSION");
  }
  const policyVersion = reader.required("POLICY_VERSION");
  if (!isCanonicalVersionIdentifier(policyVersion)) reader.errors.push("POLICY_VERSION");

  const candidateCount = reader.positiveInteger("CANDIDATE_COUNT");
  if (candidateCount !== 4) reader.errors.push("CANDIDATE_COUNT");
  const openOfferWeightNumerator = reader.positiveBigInt(
    "OPEN_OFFER_WEIGHT_NUMERATOR",
  );
  const openOfferWeightDenominator = reader.positiveBigInt(
    "OPEN_OFFER_WEIGHT_DENOMINATOR",
  );
  if (openOfferWeightNumerator >= openOfferWeightDenominator) {
    reader.errors.push("OPEN_OFFER_WEIGHT_NUMERATOR");
  }

  const targetFiatShareBps = reader.positiveInteger("TARGET_FIAT_SHARE_BPS");
  if (targetFiatShareBps > 10_000) {
    reader.errors.push("TARGET_FIAT_SHARE_BPS");
  }
  const buySafetyBufferBps = reader.positiveInteger("BUY_SAFETY_BUFFER_BPS");
  if (buySafetyBufferBps > 10_000) {
    reader.errors.push("BUY_SAFETY_BUFFER_BPS");
  }
  const maxPriceDeviationBps = reader.positiveInteger(
    "MAX_PRICE_DEVIATION_BPS",
  );
  if (maxPriceDeviationBps > 10_000) {
    reader.errors.push("MAX_PRICE_DEVIATION_BPS");
  }

  const policy: SelectionPolicy = {
    version: policyVersion,
    policyHash: reader.bytes32("POLICY_HASH"),
    candidateCount: 4,
    assignmentTtlSeconds: reader.positiveInteger("ASSIGNMENT_TTL_SECONDS"),
    leaseStepSeconds: reader.positiveInteger("LEASE_STEP_SECONDS"),
    maxStateAgeBlocks: reader.positiveInteger("MAX_STATE_AGE_BLOCKS"),
    maxPendingOffersPerMerchant: reader.positiveInteger(
      "MAX_PENDING_OFFERS_PER_MERCHANT",
    ),
    openOfferWeightNumerator,
    openOfferWeightDenominator,
    targetFiatShareBps,
    buySafetyBufferBps,
    minBuySafetyBufferUsdc: reader.positiveBigInt(
      "MIN_BUY_SAFETY_BUFFER_USDC_ATOMS",
    ),
    maxPriceDeviationBps,
    minMerchantStakeUsdc: reader.positiveBigInt(
      "MIN_MERCHANT_STAKE_USDC_ATOMS",
    ),
    minOrderUsdc: reader.positiveBigInt("MIN_ORDER_USDC_ATOMS"),
    maxOrderUsdc: reader.positiveBigInt("MAX_ORDER_USDC_ATOMS"),
    acceptedOrderTimeoutSeconds: reader.positiveInteger(
      "ACCEPTED_ORDER_TIMEOUT_SECONDS",
    ),
    disputeWindowSeconds: reader.positiveInteger("DISPUTE_WINDOW_SECONDS"),
  };

  if (policy.minOrderUsdc > policy.maxOrderUsdc) {
    reader.errors.push("MIN_ORDER_USDC_ATOMS", "MAX_ORDER_USDC_ATOMS");
  }
  if (policy.leaseStepSeconds * 4 > policy.assignmentTtlSeconds) {
    reader.errors.push("LEASE_STEP_SECONDS", "ASSIGNMENT_TTL_SECONDS");
  }

  if (chainId !== BASE_SEPOLIA_CHAIN_ID) reader.errors.push("CHAIN_ID");
  if (mode !== "shadow") reader.errors.push("HELPER_MODE");
  if (sendRequested) reader.errors.push("ENABLE_TRANSACTION_SENDING");
  if (councilVerdict !== "REJECT") reader.errors.push("COUNCIL_VERDICT");
  if (councilBillSha256 !== COUNCIL_BILL_SHA256) {
    reader.errors.push("COUNCIL_BILL_SHA256");
  }
  if (interfaceVerified) reader.errors.push("CONTRACT_INTERFACE_VERIFIED");
  if (deploymentVerified) {
    reader.errors.push("BASE_SEPOLIA_DEPLOYMENT_VERIFIED");
  }
  if (canaryApproved) reader.errors.push("CANARY_APPROVED");
  if (diamondAddress !== BASE_SEPOLIA_DIAMOND_ADDRESS) {
    reader.errors.push("DIAMOND_ADDRESS");
  }
  if (policy.policyHash === ZERO_BYTES32) reader.errors.push("POLICY_HASH");
  if (
    primaryRpcUrl.href === fallbackRpcUrl.href ||
    primaryRpcUrl.hostname === fallbackRpcUrl.hostname
  ) {
    reader.errors.push("FALLBACK_RPC_URL");
  }

  if (reader.errors.length > 0) {
    throw new ConfigurationError([...new Set(reader.errors)]);
  }

  const blockers = [
    "council verdict is REJECT",
    "value-moving helper interface is not deployed and verified",
    "shipped runtime has no signing or broadcasting adapter",
  ];

  return {
    chainId,
    diamondAddress,
    primaryRpcUrl,
    fallbackRpcUrl,
    startBlock,
    finalityConfirmations,
    mode,
    sendGate: {
      requested: sendRequested,
      enabled: false,
      blockers,
    },
    council: {
      verdict: "REJECT",
      billSha256: councilBillSha256,
    },
    databaseSecretReference,
    redisSecretReference,
    helperBuildVersion,
    policy,
  };
}
