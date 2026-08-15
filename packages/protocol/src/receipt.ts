import { decodeEventLog, type Abi, type Log } from "viem";

import type { Address, Hex } from "./constants.js";
import { ProtocolError, ProtocolErrorCode } from "./errors.js";
import type { DeploymentManifest, ManifestRuntime } from "./manifest.js";
import { assertManifestRuntime } from "./manifest.js";

export interface ReceiptLogLike {
  readonly address: Address;
  readonly data: Hex;
  readonly topics: readonly Hex[];
}

export interface TransactionReceiptLike {
  readonly transactionHash?: Hex;
  readonly status?: string | number | bigint;
  readonly logs: readonly ReceiptLogLike[];
}

export interface DecodedOrderCreated {
  readonly orderId: Hex;
  readonly user: Address;
  readonly orderType: number;
  readonly usdcAmount: bigint;
  readonly fiatAmountE6: bigint;
  readonly selectedPriceE6: bigint;
  readonly roundId?: bigint;
  readonly deadline?: bigint;
  readonly createdAt?: bigint;
  readonly orderNumber: bigint;
  readonly transactionHash?: Hex;
}

function isReceipt(value: unknown): value is TransactionReceiptLike {
  return value !== null && typeof value === "object" && Array.isArray((value as { logs?: unknown }).logs);
}

function asBigInt(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/u.test(value)) return BigInt(value);
  throw new ProtocolError(ProtocolErrorCode.INVALID_RECEIPT, `OrderCreated.${field} is invalid`);
}

export function decodeOrderCreated(
  receipt: unknown,
  input: Readonly<{
    manifest: DeploymentManifest;
    diamondAbi: Abi;
    runtime: ManifestRuntime;
  }>,
): DecodedOrderCreated {
  assertManifestRuntime(input.manifest, input.runtime);
  if (!isReceipt(receipt)) throw new ProtocolError(ProtocolErrorCode.INVALID_RECEIPT);

  const matching: Array<Record<string, unknown>> = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== input.manifest.diamond.address.toLowerCase()) continue;
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
      // Non-OrderCreated logs emitted by the manifest Diamond are irrelevant.
    }
  }

  if (matching.length === 0) throw new ProtocolError(ProtocolErrorCode.ORDER_CREATED_NOT_FOUND);
  if (matching.length !== 1) throw new ProtocolError(ProtocolErrorCode.ORDER_CREATED_AMBIGUOUS);

  const args = matching[0] as Record<string, unknown>;
  const orderId = args.orderId;
  const user = args.user;
  if (typeof orderId !== "string" || typeof user !== "string") {
    throw new ProtocolError(ProtocolErrorCode.INVALID_RECEIPT, "OrderCreated identifiers are invalid");
  }

  const result: DecodedOrderCreated = {
    orderId: orderId as Hex,
    user: user as Address,
    orderType: Number(asBigInt(args.orderType, "orderType")),
    usdcAmount: asBigInt(args.usdcAmount, "usdcAmount"),
    fiatAmountE6: asBigInt(args.fiatAmountE6 ?? args.fiatAmount, "fiatAmount"),
    selectedPriceE6: asBigInt(args.selectedPriceE6 ?? args.price, "selectedPrice"),
    orderNumber: asBigInt(args.orderNumber, "orderNumber"),
    ...(receipt.transactionHash === undefined ? {} : { transactionHash: receipt.transactionHash }),
    ...(args.roundId === undefined ? {} : { roundId: asBigInt(args.roundId, "roundId") }),
    ...(args.deadline === undefined ? {} : { deadline: asBigInt(args.deadline, "deadline") }),
    ...(args.createdAt === undefined ? {} : { createdAt: asBigInt(args.createdAt, "createdAt") }),
  };
  return Object.freeze(result);
}
