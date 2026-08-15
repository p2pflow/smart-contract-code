import { decodeEventLog, type Abi, type Log } from "viem";

import type { Address, Hex } from "./constants.js";
import { ProtocolError, ProtocolErrorCode } from "./errors.js";
import type { DeploymentManifest, ManifestRuntime } from "./manifest.js";
import { assertProtocolBoundary } from "./manifest.js";

const addressPattern = /^0x[0-9a-fA-F]{40}$/u;
const bytes32Pattern = /^0x[0-9a-fA-F]{64}$/u;
const hexPattern = /^0x(?:[0-9a-fA-F]{2})*$/u;

export interface ReceiptLogLike {
  readonly address: Address;
  readonly data: Hex;
  readonly topics: readonly Hex[];
}

export interface TransactionReceiptLike {
  readonly transactionHash: Hex;
  readonly status: "success" | 1 | 1n | "0x1";
  readonly logs: readonly ReceiptLogLike[];
}

export interface DecodedOrderCreated {
  readonly orderId: Hex;
  readonly user: Address;
  readonly orderType: 0 | 1;
  readonly usdcAmount: bigint;
  readonly fiatAmountE6: bigint;
  readonly selectedPriceE6: bigint;
  readonly roundId: bigint;
  readonly deadline: bigint;
  readonly createdAt: bigint;
  readonly orderNumber: bigint;
  readonly transactionHash: Hex;
}

function invalid(message?: string): never {
  throw new ProtocolError(ProtocolErrorCode.INVALID_RECEIPT, message);
}

function isSuccessfulStatus(status: unknown): boolean {
  return status === "success" || status === 1 || status === 1n || status === "0x1";
}

function parseReceipt(value: unknown): TransactionReceiptLike {
  if (value === null || typeof value !== "object") invalid();
  const receipt = value as Record<string, unknown>;
  if (
    typeof receipt.transactionHash !== "string" ||
    !bytes32Pattern.test(receipt.transactionHash) || /^0x0+$/iu.test(receipt.transactionHash) ||
    !isSuccessfulStatus(receipt.status) || !Array.isArray(receipt.logs)
  ) invalid();
  for (const candidate of receipt.logs) {
    if (candidate === null || typeof candidate !== "object") invalid();
    const log = candidate as Record<string, unknown>;
    if (
      typeof log.address !== "string" || !addressPattern.test(log.address) ||
      typeof log.data !== "string" || !hexPattern.test(log.data) ||
      !Array.isArray(log.topics) ||
      log.topics.some((topic) => typeof topic !== "string" || !bytes32Pattern.test(topic))
    ) invalid();
  }
  return receipt as unknown as TransactionReceiptLike;
}

function asBigInt(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/u.test(value)) return BigInt(value);
  invalid(`OrderCreated.${field} is invalid`);
}

function asPositiveBigInt(value: unknown, field: string): bigint {
  const parsed = asBigInt(value, field);
  if (parsed <= 0n) invalid(`OrderCreated.${field} must be positive`);
  return parsed;
}

export function decodeOrderCreated(
  receiptValue: unknown,
  input: Readonly<{
    manifest: DeploymentManifest;
    diamondAbi: Abi;
    runtime: ManifestRuntime;
  }>,
): DecodedOrderCreated {
  const manifest = assertProtocolBoundary(input.manifest, input.diamondAbi, input.runtime);
  const receipt = parseReceipt(receiptValue);

  const matching: Array<Record<string, unknown>> = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== manifest.diamond.address.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: input.diamondAbi,
        data: log.data,
        topics: log.topics as Log["topics"],
        strict: true,
      });
      if (decoded.eventName === "OrderCreated" && decoded.args !== null && typeof decoded.args === "object") {
        matching.push(decoded.args as unknown as Record<string, unknown>);
      }
    } catch {
      // Other canonical Diamond events are not OrderCreated.
    }
  }
  if (matching.length === 0) throw new ProtocolError(ProtocolErrorCode.ORDER_CREATED_NOT_FOUND);
  if (matching.length !== 1) throw new ProtocolError(ProtocolErrorCode.ORDER_CREATED_AMBIGUOUS);

  const args = matching[0] as Record<string, unknown>;
  if (
    typeof args.orderId !== "string" || !bytes32Pattern.test(args.orderId) || /^0x0+$/iu.test(args.orderId) ||
    typeof args.user !== "string" || !addressPattern.test(args.user) || /^0x0+$/iu.test(args.user)
  ) invalid("OrderCreated identifiers are invalid");
  const orderTypeValue = asBigInt(args.orderType, "orderType");
  if (orderTypeValue !== 0n && orderTypeValue !== 1n) invalid("OrderCreated.orderType is invalid");
  const createdAt = asPositiveBigInt(args.createdAt, "createdAt");
  const deadline = asPositiveBigInt(args.deadline, "deadline");
  if (deadline < createdAt) invalid("OrderCreated.deadline precedes createdAt");

  return Object.freeze({
    orderId: args.orderId as Hex,
    user: args.user as Address,
    orderType: Number(orderTypeValue) as 0 | 1,
    usdcAmount: asPositiveBigInt(args.usdcAmount, "usdcAmount"),
    fiatAmountE6: asPositiveBigInt(args.fiatAmountE6, "fiatAmountE6"),
    selectedPriceE6: asPositiveBigInt(args.selectedPriceE6, "selectedPriceE6"),
    roundId: asPositiveBigInt(args.roundId, "roundId"),
    deadline,
    createdAt,
    orderNumber: asPositiveBigInt(args.orderNumber, "orderNumber"),
    transactionHash: receipt.transactionHash,
  });
}
