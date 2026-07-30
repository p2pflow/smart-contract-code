import {
  FeeParameters,
  NonceScope,
  TransactionAttemptRecord,
  TransactionAttemptStatus,
  TransactionPersistence,
  UnsignedTransaction,
} from "../persistence/transaction-store";
import { Clock, SystemClock, assertTimestamp } from "./clock";

export const TRANSACTION_DISABLED_CAPABILITY =
  "TRANSACTION_DISABLED_SHADOW_ONLY" as const;

export const PINNED_COUNCIL_DISPOSITION = {
  verdict: "REJECT",
  capability: TRANSACTION_DISABLED_CAPABILITY,
  adopted: "2026-07-29",
} as const;

export interface TransactionIntent {
  readonly idempotencyKey: string;
  readonly chainId: number;
  readonly to: `0x${string}`;
  readonly data: `0x${string}`;
  readonly value: bigint;
}

export type SimulationResult =
  | {
      readonly success: true;
      readonly gasEstimate: bigint;
    }
  | {
      readonly success: false;
      readonly errorCode: string;
      readonly deterministic: boolean;
    };

export interface TransactionSimulator {
  simulate(
    intent: TransactionIntent,
    from: `0x${string}`,
  ): Promise<SimulationResult>;
}

/**
 * Future-reconsideration boundary only. No shipped manager consumes this
 * interface while the pinned council disposition is REJECT.
 */
export interface InactiveFutureSigningBoundary {
  prepareSignature(
    transaction: UnsignedTransaction,
  ): Promise<{
    readonly transactionHash: `0x${string}`;
    readonly opaqueEnvelopeReference: string;
  }>;
}

/**
 * Future-reconsideration boundary only. No implementation is provided and no
 * shipped manager can call it under the pinned council disposition.
 */
export interface InactiveFutureBroadcastBoundary {
  submitOpaqueEnvelope(reference: string): Promise<void>;
}

export interface InactiveFutureFeeProvider {
  initialFees(chainId: number): Promise<FeeParameters>;
  replacementFees(
    chainId: number,
    previous: FeeParameters,
  ): Promise<FeeParameters>;
}

export type TransactionExecutionResult =
  | {
      readonly kind: "blocked";
      readonly capability: typeof TRANSACTION_DISABLED_CAPABILITY;
      readonly blockers: readonly string[];
    }
  | {
      readonly kind: "simulation-failed";
      readonly capability: typeof TRANSACTION_DISABLED_CAPABILITY;
      readonly simulation: Extract<
        SimulationResult,
        { readonly success: false }
      >;
    }
  | {
      readonly kind: "simulated";
      readonly capability: typeof TRANSACTION_DISABLED_CAPABILITY;
      readonly simulation: Extract<
        SimulationResult,
        { readonly success: true }
      >;
    };

/**
 * Public runtime surface for the adopted REJECT bill. It can only simulate.
 * There is deliberately no injected authorization, signer, fee, nonce, or
 * broadcaster dependency that could turn a shadow result into an action.
 */
export class TransactionManager {
  public constructor(
    private readonly simulator: TransactionSimulator,
    private readonly shadowFrom: `0x${string}`,
  ) {
    assertAddress(shadowFrom, "shadowFrom");
  }

  public async execute(
    intent: TransactionIntent,
    requestBroadcast: boolean,
  ): Promise<TransactionExecutionResult> {
    validateIntent(intent);
    if (requestBroadcast) {
      return {
        kind: "blocked",
        capability: TRANSACTION_DISABLED_CAPABILITY,
        blockers: [
          "COUNCIL_REJECT prohibits signing, broadcast, and state changes",
        ],
      };
    }

    const simulation = await this.simulator.simulate(
      intent,
      this.shadowFrom,
    );
    if (!simulation.success) {
      return {
        kind: "simulation-failed",
        capability: TRANSACTION_DISABLED_CAPABILITY,
        simulation,
      };
    }
    return {
      kind: "simulated",
      capability: TRANSACTION_DISABLED_CAPABILITY,
      simulation,
    };
  }
}

export interface TransactionReceipt {
  readonly transactionHash: `0x${string}`;
  readonly blockNumber: bigint;
  readonly blockHash: `0x${string}`;
  readonly success: boolean;
}

export interface TransactionChainState {
  latestBlockNumber(chainId: number): Promise<bigint>;
  blockHash(
    chainId: number,
    blockNumber: bigint,
  ): Promise<`0x${string}` | null>;
  receipt(
    chainId: number,
    transactionHash: `0x${string}`,
  ): Promise<TransactionReceipt | null>;
}

export type SubmissionObservation = "observed" | "outcome-unknown";

/**
 * Records already-derived hash evidence before future external I/O. It
 * never accepts, stores, returns, or logs a raw signed transaction.
 */
export class OfflineTransactionEvidenceRecorder {
  public constructor(
    private readonly persistence: TransactionPersistence,
    private readonly clock: Clock = new SystemClock(),
  ) {}

  public async recordDerivedHash(
    attemptId: string,
    transactionHash: `0x${string}`,
  ): Promise<TransactionAttemptRecord> {
    assertBytes32(transactionHash, "transactionHash");
    const attempt = await this.requireAttempt(attemptId);
    if (attempt.status !== "prepared") {
      if (
        attempt.transactionHash?.toLowerCase() ===
        transactionHash.toLowerCase()
      ) {
        return attempt;
      }
      throw new Error(
        `Attempt ${attemptId} cannot record a hash from ${attempt.status}`,
      );
    }
    return this.persistence.transitionAttempt(
      attempt.attemptId,
      attempt.version,
      {
        status: "hash-recorded",
        transactionHash,
        receiptBlockNumber: null,
        receiptBlockHash: null,
        failureCode: null,
        updatedAtMs: this.clock.nowMs(),
      },
    );
  }

  public async recordSubmissionObservation(
    attemptId: string,
    observation: SubmissionObservation,
  ): Promise<TransactionAttemptRecord> {
    const attempt = await this.requireAttempt(attemptId);
    if (attempt.transactionHash === null) {
      throw new Error(
        "Transaction hash must be durable before submission evidence",
      );
    }
    const status: TransactionAttemptStatus =
      observation === "observed" ? "submitted" : "broadcast-unknown";
    return this.persistence.transitionAttempt(
      attempt.attemptId,
      attempt.version,
      {
        status,
        transactionHash: attempt.transactionHash,
        receiptBlockNumber: attempt.receiptBlockNumber,
        receiptBlockHash: attempt.receiptBlockHash,
        failureCode:
          observation === "observed"
            ? null
            : "BROADCAST_OUTCOME_UNKNOWN",
        updatedAtMs: this.clock.nowMs(),
      },
    );
  }

  private async requireAttempt(
    attemptId: string,
  ): Promise<TransactionAttemptRecord> {
    const attempt = await this.persistence.getAttempt(attemptId);
    if (attempt === null) {
      throw new Error(`Transaction attempt ${attemptId} does not exist`);
    }
    return attempt;
  }
}

export interface NonceFamilyReconciliation {
  readonly scope: NonceScope;
  readonly nonce: bigint;
  readonly attempts: readonly TransactionAttemptRecord[];
  readonly finalAttemptId: string | null;
}

export class ReceiptHashMismatchError extends Error {
  public constructor(expected: string, received: string) {
    super(`Receipt hash mismatch: expected ${expected}, received ${received}`);
    this.name = "ReceiptHashMismatchError";
  }
}

export class NonceFamilyConflictError extends Error {
  public constructor(scope: NonceScope, nonce: bigint) {
    super(
      `Multiple canonical receipts for ${scope.chainId}:${scope.signer}:${nonce}`,
    );
    this.name = "NonceFamilyConflictError";
  }
}

interface ReceiptObservation {
  readonly attempt: TransactionAttemptRecord;
  readonly receipt: TransactionReceipt | null;
}

interface PlannedUpdate {
  readonly attempt: TransactionAttemptRecord;
  readonly update: {
    readonly status: TransactionAttemptStatus;
    readonly transactionHash: `0x${string}`;
    readonly receiptBlockNumber: bigint | null;
    readonly receiptBlockHash: `0x${string}` | null;
    readonly failureCode: string | null;
  } | null;
  readonly finalReceipt: TransactionReceipt | null;
}

/**
 * Read-only chain reconciliation. It considers the whole nonce family so a
 * transaction previously labelled replaced can still become the canonical
 * winner, and confirmed attempts are rechecked for deep reorgs.
 */
export class TransactionReconciler {
  public constructor(
    private readonly persistence: TransactionPersistence,
    private readonly chainState: TransactionChainState,
    private readonly clock: Clock = new SystemClock(),
  ) {}

  public async reconcileNonceFamily(
    scope: NonceScope,
    nonce: bigint,
    requiredConfirmations: number,
  ): Promise<NonceFamilyReconciliation> {
    validateRequiredConfirmations(requiredConfirmations);
    if (nonce < 0n) throw new RangeError("nonce must be non-negative");
    const attempts = await this.persistence.listByNonce(scope, nonce);
    const observations: ReceiptObservation[] = [];

    for (const attempt of attempts) {
      const transactionHash = attempt.transactionHash;
      if (transactionHash === null) {
        observations.push({ attempt, receipt: null });
        continue;
      }
      const receipt = await this.chainState.receipt(
        scope.chainId,
        transactionHash,
      );
      if (
        receipt !== null &&
        receipt.transactionHash.toLowerCase() !==
          transactionHash.toLowerCase()
      ) {
        throw new ReceiptHashMismatchError(
          transactionHash,
          receipt.transactionHash,
        );
      }
      observations.push({ attempt, receipt });
    }

    const head = await this.chainState.latestBlockNumber(scope.chainId);
    const plans: PlannedUpdate[] = [];
    for (const observation of observations) {
      plans.push(
        await this.planObservation(
          scope.chainId,
          head,
          requiredConfirmations,
          observation,
        ),
      );
    }

    const finals = plans.filter((plan) => plan.finalReceipt !== null);
    if (finals.length > 1) {
      throw new NonceFamilyConflictError(scope, nonce);
    }

    const final = finals[0] ?? null;
    const updated: TransactionAttemptRecord[] = [];
    for (const plan of plans) {
      let update = plan.update;
      if (final !== null) {
        if (plan.attempt.attemptId === final.attempt.attemptId) {
          const receipt = final.finalReceipt;
          if (receipt === null) {
            throw new Error("Final receipt disappeared during planning");
          }
          update = {
            status: receipt.success ? "confirmed" : "reverted",
            transactionHash: plan.attempt.transactionHash as `0x${string}`,
            receiptBlockNumber: receipt.blockNumber,
            receiptBlockHash: receipt.blockHash,
            failureCode: receipt.success ? null : "TRANSACTION_REVERTED",
          };
        } else if (plan.attempt.transactionHash !== null) {
          update = {
            status: "replaced",
            transactionHash: plan.attempt.transactionHash,
            receiptBlockNumber: plan.attempt.receiptBlockNumber,
            receiptBlockHash: plan.attempt.receiptBlockHash,
            failureCode: "NONCE_CONSUMED_BY_FAMILY_MEMBER",
          };
        }
      }
      updated.push(await this.applyPlan(plan.attempt, update));
    }

    return {
      scope: { ...scope },
      nonce,
      attempts: updated,
      finalAttemptId: final?.attempt.attemptId ?? null,
    };
  }

  private async planObservation(
    chainId: number,
    head: bigint,
    requiredConfirmations: number,
    observation: ReceiptObservation,
  ): Promise<PlannedUpdate> {
    const { attempt, receipt } = observation;
    if (attempt.transactionHash === null) {
      return { attempt, update: null, finalReceipt: null };
    }

    if (receipt === null) {
      if (
        attempt.receiptBlockNumber === null ||
        attempt.receiptBlockHash === null
      ) {
        return { attempt, update: null, finalReceipt: null };
      }
      const currentHash = await this.chainState.blockHash(
        chainId,
        attempt.receiptBlockNumber,
      );
      if (currentHash === null) {
        throw new Error(
          `Canonical block ${attempt.receiptBlockNumber} is unavailable`,
        );
      }
      if (
        currentHash.toLowerCase() !==
        attempt.receiptBlockHash.toLowerCase()
      ) {
        return {
          attempt,
          update: {
            status: "reorged",
            transactionHash: attempt.transactionHash,
            receiptBlockNumber: attempt.receiptBlockNumber,
            receiptBlockHash: attempt.receiptBlockHash,
            failureCode: "RECEIPT_BLOCK_REORGED",
          },
          finalReceipt: null,
        };
      }
      return { attempt, update: null, finalReceipt: null };
    }

    validateReceipt(receipt);
    const canonicalHash = await this.chainState.blockHash(
      chainId,
      receipt.blockNumber,
    );
    if (canonicalHash === null) {
      throw new Error(`Canonical block ${receipt.blockNumber} is unavailable`);
    }
    if (
      canonicalHash.toLowerCase() !== receipt.blockHash.toLowerCase()
    ) {
      return {
        attempt,
        update: {
          status: "reorged",
          transactionHash: attempt.transactionHash,
          receiptBlockNumber: receipt.blockNumber,
          receiptBlockHash: receipt.blockHash,
          failureCode: "RECEIPT_BLOCK_REORGED",
        },
        finalReceipt: null,
      };
    }

    const confirmations =
      head >= receipt.blockNumber ? head - receipt.blockNumber + 1n : 0n;
    if (confirmations >= BigInt(requiredConfirmations)) {
      return { attempt, update: null, finalReceipt: receipt };
    }
    return {
      attempt,
      update: {
        status: "submitted",
        transactionHash: attempt.transactionHash,
        receiptBlockNumber: receipt.blockNumber,
        receiptBlockHash: receipt.blockHash,
        failureCode: null,
      },
      finalReceipt: null,
    };
  }

  private async applyPlan(
    attempt: TransactionAttemptRecord,
    update: PlannedUpdate["update"],
  ): Promise<TransactionAttemptRecord> {
    if (update === null || sameMutableAttemptFields(attempt, update)) {
      return attempt;
    }
    const updatedAtMs = this.clock.nowMs();
    assertTimestamp(updatedAtMs, "updatedAtMs");
    return this.persistence.transitionAttempt(
      attempt.attemptId,
      attempt.version,
      { ...update, updatedAtMs },
    );
  }
}

function sameMutableAttemptFields(
  attempt: TransactionAttemptRecord,
  update: NonNullable<PlannedUpdate["update"]>,
): boolean {
  return (
    attempt.status === update.status &&
    attempt.transactionHash?.toLowerCase() ===
      update.transactionHash.toLowerCase() &&
    attempt.receiptBlockNumber === update.receiptBlockNumber &&
    attempt.receiptBlockHash?.toLowerCase() ===
      update.receiptBlockHash?.toLowerCase() &&
    attempt.failureCode === update.failureCode
  );
}

function validateIntent(intent: TransactionIntent): void {
  if (
    intent.idempotencyKey.trim().length === 0 ||
    !Number.isSafeInteger(intent.chainId) ||
    intent.chainId <= 0 ||
    intent.value < 0n
  ) {
    throw new TypeError("Transaction intent has invalid identity or value");
  }
  assertAddress(intent.to, "to");
  assertHex(intent.data, "data");
}

function validateRequiredConfirmations(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(
      "requiredConfirmations must be a positive safe integer",
    );
  }
}

function validateReceipt(receipt: TransactionReceipt): void {
  assertBytes32(receipt.transactionHash, "receipt.transactionHash");
  assertBytes32(receipt.blockHash, "receipt.blockHash");
  if (receipt.blockNumber < 0n) {
    throw new RangeError("receipt.blockNumber must be non-negative");
  }
}

function assertAddress(value: string, name: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new TypeError(`${name} must be a 20-byte hexadecimal value`);
  }
}

function assertBytes32(value: string, name: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError(`${name} must be a 32-byte hexadecimal value`);
  }
}

function assertHex(value: string, name: string): void {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new TypeError(`${name} must be an even-length hexadecimal value`);
  }
}
