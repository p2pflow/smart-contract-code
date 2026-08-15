import { toFunctionSelector } from "viem";
import { formatAbiItem } from "viem/utils";

import { GENERATED_DIAMOND_ABI } from "./generated/artifacts.js";

export const ProtocolErrorCode = Object.freeze({
  VALIDATION_FAILED: "VALIDATION_FAILED",
  ACCESS_DENIED: "ACCESS_DENIED",
  PROTOCOL_NOT_INITIALIZED: "PROTOCOL_NOT_INITIALIZED",
  PROTOCOL_VERSION_MISMATCH: "PROTOCOL_VERSION_MISMATCH",
  INVALID_PRICE_ROUND: "INVALID_PRICE_ROUND",
  STALE_PRICE: "STALE_PRICE",
  PRICE_POLICY_REJECTED: "PRICE_POLICY_REJECTED",
  ORDER_STATE_CONFLICT: "ORDER_STATE_CONFLICT",
  UNAUTHORIZED_ORDER_ACTOR: "UNAUTHORIZED_ORDER_ACTOR",
  MERCHANT_INELIGIBLE: "MERCHANT_INELIGIBLE",
  CAPACITY_INSUFFICIENT: "CAPACITY_INSUFFICIENT",
  ASSIGNMENT_REJECTED: "ASSIGNMENT_REJECTED",
  CUSTODY_REJECTED: "CUSTODY_REJECTED",
  DEADLINE_REJECTED: "DEADLINE_REJECTED",
  DISPUTE_REJECTED: "DISPUTE_REJECTED",
  SESSION_INVALID: "SESSION_INVALID",
  CHAIN_REORG_RETRY: "CHAIN_REORG_RETRY",
  TRANSACTION_UNCERTAIN: "TRANSACTION_UNCERTAIN",
  MANIFEST_INVALID: "MANIFEST_INVALID",
  MANIFEST_DIGEST_MISMATCH: "MANIFEST_DIGEST_MISMATCH",
  ABI_DIGEST_MISMATCH: "ABI_DIGEST_MISMATCH",
  MANIFEST_FIXTURE_FORBIDDEN: "MANIFEST_FIXTURE_FORBIDDEN",
  INVALID_RECEIPT: "INVALID_RECEIPT",
  ORDER_CREATED_NOT_FOUND: "ORDER_CREATED_NOT_FOUND",
  ORDER_CREATED_AMBIGUOUS: "ORDER_CREATED_AMBIGUOUS",
} as const);

export type ProtocolErrorCodeValue = (typeof ProtocolErrorCode)[keyof typeof ProtocolErrorCode];

export const ProtocolErrorMessage: Readonly<Record<ProtocolErrorCodeValue, string>> = Object.freeze({
  VALIDATION_FAILED: "The request failed protocol validation.",
  ACCESS_DENIED: "The connected account lacks the required protocol role.",
  PROTOCOL_NOT_INITIALIZED: "The Diamond is not initialized as the privacy-safe v2 protocol.",
  PROTOCOL_VERSION_MISMATCH: "The deployed protocol or storage-layout identity does not match v2.",
  INVALID_PRICE_ROUND: "The selected price round is invalid.",
  STALE_PRICE: "The selected price is stale.",
  PRICE_POLICY_REJECTED: "The price publication or policy failed protocol guardrails.",
  ORDER_STATE_CONFLICT: "The order is not in the required state.",
  UNAUTHORIZED_ORDER_ACTOR: "The connected account is not the required order actor.",
  MERCHANT_INELIGIBLE: "The merchant or payment channel is not currently eligible.",
  CAPACITY_INSUFFICIENT: "The merchant or channel lacks unreserved capacity.",
  ASSIGNMENT_REJECTED: "The bounded candidate assignment was rejected.",
  CUSTODY_REJECTED: "The token transfer or custody invariant was rejected.",
  DEADLINE_REJECTED: "The requested transition is outside its on-chain deadline.",
  DISPUTE_REJECTED: "The dispute transition was rejected.",
  SESSION_INVALID: "The wallet-backed session is invalid.",
  CHAIN_REORG_RETRY: "Canonical chain state changed; retry after reconciliation.",
  TRANSACTION_UNCERTAIN: "The transaction outcome is uncertain and requires reconciliation.",
  MANIFEST_INVALID: "The protocol manifest is invalid.",
  MANIFEST_DIGEST_MISMATCH: "The protocol manifest digest does not match its content.",
  ABI_DIGEST_MISMATCH: "The supplied Diamond ABI does not match the manifest digest.",
  MANIFEST_FIXTURE_FORBIDDEN: "The non-deployed local fixture cannot be used in a shared runtime.",
  INVALID_RECEIPT: "A successful confirmed transaction receipt with canonical logs is required.",
  ORDER_CREATED_NOT_FOUND: "The receipt has no OrderCreated event from the manifest Diamond.",
  ORDER_CREATED_AMBIGUOUS: "The receipt has more than one OrderCreated event from the manifest Diamond.",
});

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCodeValue;

  constructor(code: ProtocolErrorCodeValue, message: string = ProtocolErrorMessage[code]) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
  }
}

const ACCESS_ERRORS = new Set([
  "LastDefaultAdmin", "MissingRole", "RoleAccountAlreadyAssigned", "RoleAccountIsDiamondOwner",
  "RoleAccountsMustBeDistinct", "UnauthorizedRoleRenounce", "UnknownRole",
]);
const INIT_ERRORS = new Set(["InvalidDiamondContext", "LegacyV1StateDetected", "ProtocolAlreadyInitialized", "ProtocolNotInitialized"]);
const PRICE_ROUND_ERRORS = new Set(["InvalidPriceRound"]);
const STALE_PRICE_ERRORS = new Set(["StalePrice"]);
const PRICE_POLICY_ERRORS = new Set([
  "FutureObservation", "InsufficientPriceSources", "InvalidEvidence", "InvalidPricePolicy",
  "InvalidPriceValues", "PriceDeviationExceeded", "QuoteExpired", "QuoteValidityTooLong",
  "SlippageBoundExceeded",
]);
const ORDER_STATE_ERRORS = new Set(["CustodyAlreadyFinalized", "InvalidOrderState", "InvalidOrderType", "OrderNotFound"]);
const MERCHANT_ERRORS = new Set([
  "ChannelNotEligible", "ChannelNotFound", "InvalidChannelStatus", "InvalidMerchantStatus",
  "InvalidSideMask", "MerchantAlreadyRegistered", "MerchantHasObligations", "MerchantNotActive",
  "MerchantNotFound", "MerchantNotOnline", "MerchantStakeBelowMinimum",
]);
const CAPACITY_ERRORS = new Set([
  "CapacityBelowReserved", "ChannelHasObligations", "InsufficientAvailableLiquidity", "InsufficientFiatCapacity",
]);
const ASSIGNMENT_ERRORS = new Set([
  "CandidateAlreadyRejected", "CandidateNotAcceptable", "CandidateNotAssigned", "DecisionAlreadyUsed",
  "DuplicateCandidate", "InvalidCandidate", "InvalidCandidateCount", "StaleAssignmentEpoch",
]);
const CUSTODY_ERRORS = new Set([
  "InboundBalanceMismatch", "OutboundBalanceMismatch", "ReentrantCall", "SafeERC20FailedOperation",
]);
const DEADLINE_ERRORS = new Set([
  "AcceptedRecoveryDeadlineElapsed", "AssignmentExpired", "AssignmentNotExpired", "OrderNotExpired",
]);
const DISPUTE_ERRORS = new Set(["DisputeNotAllowed", "DisputeNotOpen"]);

function codeForContractError(name: string): ProtocolErrorCodeValue {
  if (ACCESS_ERRORS.has(name)) return ProtocolErrorCode.ACCESS_DENIED;
  if (INIT_ERRORS.has(name)) return name === "ProtocolNotInitialized"
    ? ProtocolErrorCode.PROTOCOL_NOT_INITIALIZED
    : ProtocolErrorCode.PROTOCOL_VERSION_MISMATCH;
  if (PRICE_ROUND_ERRORS.has(name)) return ProtocolErrorCode.INVALID_PRICE_ROUND;
  if (STALE_PRICE_ERRORS.has(name)) return ProtocolErrorCode.STALE_PRICE;
  if (PRICE_POLICY_ERRORS.has(name)) return ProtocolErrorCode.PRICE_POLICY_REJECTED;
  if (ORDER_STATE_ERRORS.has(name)) return ProtocolErrorCode.ORDER_STATE_CONFLICT;
  if (name === "UnauthorizedOrderActor") return ProtocolErrorCode.UNAUTHORIZED_ORDER_ACTOR;
  if (MERCHANT_ERRORS.has(name)) return ProtocolErrorCode.MERCHANT_INELIGIBLE;
  if (CAPACITY_ERRORS.has(name)) return ProtocolErrorCode.CAPACITY_INSUFFICIENT;
  if (ASSIGNMENT_ERRORS.has(name)) return ProtocolErrorCode.ASSIGNMENT_REJECTED;
  if (CUSTODY_ERRORS.has(name)) return ProtocolErrorCode.CUSTODY_REJECTED;
  if (DEADLINE_ERRORS.has(name)) return ProtocolErrorCode.DEADLINE_REJECTED;
  if (DISPUTE_ERRORS.has(name)) return ProtocolErrorCode.DISPUTE_REJECTED;
  return ProtocolErrorCode.VALIDATION_FAILED;
}

export interface ContractErrorDescriptor {
  readonly name: string;
  readonly selector: `0x${string}`;
  readonly code: ProtocolErrorCodeValue;
  readonly message: string;
}

const descriptors: Record<string, ContractErrorDescriptor> = {};
for (const item of GENERATED_DIAMOND_ABI) {
  if (item.type !== "error") continue;
  const selector = toFunctionSelector(formatAbiItem(item)) as `0x${string}`;
  if (descriptors[selector] !== undefined) {
    throw new Error(`Generated custom-error selector collision at ${selector}`);
  }
  const code = codeForContractError(item.name);
  descriptors[selector] = Object.freeze({
    name: item.name,
    selector,
    code,
    message: `${item.name}: ${ProtocolErrorMessage[code]}`,
  });
}

export const CONTRACT_ERROR_SELECTORS: Readonly<Record<string, ContractErrorDescriptor>> =
  Object.freeze(descriptors);

function findRevertData(value: unknown, seen = new Set<unknown>()): string | undefined {
  if (typeof value === "string" && /^0x[0-9a-fA-F]{8,}$/u.test(value)) return value;
  if (value === null || typeof value !== "object" || seen.has(value)) return undefined;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const key of ["data", "cause", "error", "details", "walk"]) {
    const found = findRevertData(record[key], seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function mapProtocolError(value: unknown): Readonly<{
  code: ProtocolErrorCodeValue;
  message: string;
  contractError?: string;
}> {
  if (value instanceof ProtocolError) {
    return Object.freeze({ code: value.code, message: value.message });
  }
  const revertData = findRevertData(value);
  const descriptor = revertData === undefined
    ? undefined
    : CONTRACT_ERROR_SELECTORS[revertData.slice(0, 10).toLowerCase()];
  if (descriptor !== undefined) {
    return Object.freeze({
      code: descriptor.code,
      message: descriptor.message,
      contractError: descriptor.name,
    });
  }
  return Object.freeze({
    code: ProtocolErrorCode.VALIDATION_FAILED,
    message: ProtocolErrorMessage.VALIDATION_FAILED,
  });
}
