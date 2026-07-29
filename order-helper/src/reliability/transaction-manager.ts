import { randomUUID } from "node:crypto";
import {
  FeeParameters,
  NonceLease,
  NonceOwnershipStore,
  NonceScope,
  TransactionAttemptRecord,
  TransactionAttemptStore,
  TransactionAttemptStatus,
  UnsignedTransaction,
} from "../persistence/transaction-store";
import { Clock, SystemClock } from "./clock";

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

export interface BroadcastAuthorizationContext {
  readonly intent: TransactionIntent;
  readonly signer: `0x${string}`;
  readonly simulation: Extract<SimulationResult, { readonly success: true }>;
  readonly replacementOf: string | null;
}

export interface BroadcastAuthorizationDecision {
  readonly authorized: boolean;
  readonly blockers: readonly string[];
}

export interface BroadcastAuthorizationGate {
  authorize(
    context: BroadcastAuthorizationContext,
  ): Promise<BroadcastAuthorizationDecision>;
}

export class DenyAllBroadcastGate implements BroadcastAuthorizationGate {
  public async authorize(): Promise<BroadcastAuthorizationDecision> {
    return {
      authorized: false,
      blockers: ["transaction broadcasting is disabled"],
    };
  }
}

export interface TransactionSigner {
  address(): Promise<`0x${string}`>;
  signTransaction(transaction: UnsignedTransaction): Promise<`0x${string}`>;
}

export interface TransactionBroadcaster {
  broadcast(rawTransaction: `0x${string}`): Promise<`0x${string}`>;
}

export interface TransactionChainState {
  pendingNonce(scope: NonceScope): Promise<bigint>;
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

export interface TransactionReceipt {
  readonly transactionHash: `0x${string}`;
  readonly blockNumber: bigint;
  readonly blockHash: `0x${string}`;
  readonly success: boolean;
}

export interface FeeProvider {
  initialFees(chainId: number): Promise<FeeParameters>;
  replacementFees(
    chainId: number,
    previous: FeeParameters,
  ): Promise<FeeParameters>;
}

export interface TransactionManagerOptions {
  readonly ownerId: string;
  readonly nonceLeaseMs: number;
  readonly minimumReplacementBumpBps: number;
}

export type TransactionExecutionResult =
  | {
      readonly kind: "simulation-failed";
      readonly simulation: Extract<
        SimulationResult,
        { readonly success: false }
      >;
    }
  | {
      readonly kind: "simulated";
      readonly simulation: Extract<
        SimulationResult,
        { readonly success: true }
      >;
    }
  | {
      readonly kind: "blocked";
      readonly simulation: Extract<
        SimulationResult,
        { readonly success: true }
      >;
      readonly blockers: readonly string[];
    }
  | {
      readonly kind: "submitted" | "broadcast-unknown" | "signing-failed";
      readonly simulation: Extract<
        SimulationResult,
        { readonly success: true }
      >;
      readonly attempt: TransactionAttemptRecord;
    };

export class TransactionManager {
  public constructor(
    private readonly simulator: TransactionSimulator,
    private readonly authorizationGate: BroadcastAuthorizationGate,
    private readonly signer: TransactionSigner,
    private readonly broadcaster: TransactionBroadcaster,
    private readonly chainState: TransactionChainState,
    private readonly feeProvider: FeeProvider,
    private readonly nonceStore: NonceOwnershipStore,
    private readonly attemptStore: TransactionAttemptStore,
    private readonly options: TransactionManagerOptions,
    private readonly clock: Clock = new SystemClock(),
    private readonly attemptIdFactory: () => string = randomUUID,
  ) {
    validateManagerOptions(options);
  }

  public async execute(
    intent: TransactionIntent,
    requestBroadcast: boolean,
  ): Promise<TransactionExecutionResult> {
    validateIntent(intent);
    const signer = await this.signer.address();
    assertAddress(signer, "signer");
    const simulation = await this.simulator.simulate(intent, signer);
    if (!simulation.success) {
      return { kind: "simulation-failed", simulation };
    }
    if (!requestBroadcast) {
      return { kind: "simulated", simulation };
    }

    const authorization = await this.authorizationGate.authorize({
      intent,
      signer,
      simulation,
      replacementOf: null,
    });
    if (!authorization.authorized) {
      return {
        kind: "blocked",
        simulation,
        blockers:
          authorization.blockers.length === 0
            ? ["authorization gate denied broadcasting"]
            : [...authorization.blockers],
      };
    }

    const scope = { chainId: intent.chainId, signer } as const;
    const lease = await this.acquireNonceLease(scope);
    if (lease === null) {
      return {
        kind: "blocked",
        simulation,
        blockers: ["nonce scope is owned by another worker"],
      };
    }
    const nonce = await this.nonceStore.reserve(lease);
    const fees = await this.feeProvider.initialFees(intent.chainId);
    validateFees(fees);
    const unsignedTransaction: UnsignedTransaction = {
      chainId: intent.chainId,
      from: signer,
      to: intent.to,
      nonce,
      data: intent.data,
      value: intent.value,
      gasLimit: simulation.gasEstimate,
      fees,
    };
    const attempt = await this.appendPreparedAttempt(
      intent.idempotencyKey,
      unsignedTransaction,
      null,
    );
    return this.signAndBroadcast(attempt, simulation);
  }

  public async replace(
    attemptId: string,
  ): Promise<TransactionExecutionResult> {
    const previous = await this.attemptStore.get(attemptId);
    if (previous === null) {
      throw new Error(`Transaction attempt ${attemptId} does not exist`);
    }
    if (
      previous.status !== "submitted" &&
      previous.status !== "broadcast-unknown" &&
      previous.status !== "reorged" &&
      previous.status !== "signing-failed"
    ) {
      throw new Error(
        `Transaction attempt ${attemptId} cannot be replaced from ${previous.status}`,
      );
    }

    const transaction = previous.unsignedTransaction;
    const intent: TransactionIntent = {
      idempotencyKey: previous.idempotencyKey,
      chainId: transaction.chainId,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
    };
    const signer = await this.signer.address();
    if (signer.toLowerCase() !== transaction.from.toLowerCase()) {
      throw new Error("Configured signer does not own the original nonce");
    }
    const simulation = await this.simulator.simulate(intent, signer);
    if (!simulation.success) {
      return { kind: "simulation-failed", simulation };
    }
    const authorization = await this.authorizationGate.authorize({
      intent,
      signer,
      simulation,
      replacementOf: previous.attemptId,
    });
    if (!authorization.authorized) {
      return {
        kind: "blocked",
        simulation,
        blockers:
          authorization.blockers.length === 0
            ? ["authorization gate denied replacement"]
            : [...authorization.blockers],
      };
    }

    const scope = { chainId: transaction.chainId, signer } as const;
    const networkPendingNonce = await this.chainState.pendingNonce(scope);
    if (networkPendingNonce > transaction.nonce) {
      return {
        kind: "blocked",
        simulation,
        blockers: ["nonce is already consumed; reconcile receipts first"],
      };
    }
    const lease = await this.nonceStore.acquire(
      scope,
      this.options.ownerId,
      networkPendingNonce,
      this.options.nonceLeaseMs,
    );
    if (lease === null) {
      return {
        kind: "blocked",
        simulation,
        blockers: ["nonce scope is owned by another worker"],
      };
    }
    await this.nonceStore.assertOwned(lease);

    const fees = await this.feeProvider.replacementFees(
      transaction.chainId,
      transaction.fees,
    );
    validateReplacementFees(
      transaction.fees,
      fees,
      this.options.minimumReplacementBumpBps,
    );
    const replacement = await this.appendPreparedAttempt(
      previous.idempotencyKey,
      {
        ...transaction,
        gasLimit: simulation.gasEstimate,
        fees,
      },
      previous.attemptId,
    );
    const result = await this.signAndBroadcast(replacement, simulation);
    if (result.kind === "submitted") {
      await this.transitionAttempt(previous, "replaced", {
        transactionHash: previous.transactionHash,
        receiptBlockNumber: previous.receiptBlockNumber,
        receiptBlockHash: previous.receiptBlockHash,
        failureCode: null,
      });
    }
    return result;
  }

  public async reconcile(
    attemptId: string,
    requiredConfirmations: number,
  ): Promise<TransactionAttemptRecord> {
    if (
      !Number.isSafeInteger(requiredConfirmations) ||
      requiredConfirmations <= 0
    ) {
      throw new RangeError(
        "requiredConfirmations must be a positive safe integer",
      );
    }
    const attempt = await this.attemptStore.get(attemptId);
    if (attempt === null) {
      throw new Error(`Transaction attempt ${attemptId} does not exist`);
    }
    if (
      attempt.status === "confirmed" ||
      attempt.status === "reverted" ||
      attempt.status === "replaced"
    ) {
      return attempt;
    }
    if (attempt.transactionHash === null) return attempt;

    const receipt = await this.chainState.receipt(
      attempt.unsignedTransaction.chainId,
      attempt.transactionHash,
    );
    if (receipt === null) return attempt;

    const canonicalHash = await this.chainState.blockHash(
      attempt.unsignedTransaction.chainId,
      receipt.blockNumber,
    );
    if (
      canonicalHash === null ||
      canonicalHash.toLowerCase() !== receipt.blockHash.toLowerCase()
    ) {
      return this.transitionAttempt(attempt, "reorged", {
        transactionHash: attempt.transactionHash,
        receiptBlockNumber: receipt.blockNumber,
        receiptBlockHash: receipt.blockHash,
        failureCode: "RECEIPT_BLOCK_REORGED",
      });
    }

    const head = await this.chainState.latestBlockNumber(
      attempt.unsignedTransaction.chainId,
    );
    const confirmations =
      head >= receipt.blockNumber ? head - receipt.blockNumber + 1n : 0n;
    if (confirmations < BigInt(requiredConfirmations)) {
      if (
        attempt.receiptBlockNumber === receipt.blockNumber &&
        attempt.receiptBlockHash?.toLowerCase() ===
          receipt.blockHash.toLowerCase()
      ) {
        return attempt;
      }
      return this.transitionAttempt(attempt, attempt.status, {
        transactionHash: attempt.transactionHash,
        receiptBlockNumber: receipt.blockNumber,
        receiptBlockHash: receipt.blockHash,
        failureCode: null,
      });
    }

    return this.transitionAttempt(
      attempt,
      receipt.success ? "confirmed" : "reverted",
      {
        transactionHash: attempt.transactionHash,
        receiptBlockNumber: receipt.blockNumber,
        receiptBlockHash: receipt.blockHash,
        failureCode: receipt.success ? null : "TRANSACTION_REVERTED",
      },
    );
  }

  private async acquireNonceLease(
    scope: NonceScope,
  ): Promise<NonceLease | null> {
    const networkPendingNonce = await this.chainState.pendingNonce(scope);
    return this.nonceStore.acquire(
      scope,
      this.options.ownerId,
      networkPendingNonce,
      this.options.nonceLeaseMs,
    );
  }

  private async appendPreparedAttempt(
    idempotencyKey: string,
    unsignedTransaction: UnsignedTransaction,
    replacesAttemptId: string | null,
  ): Promise<TransactionAttemptRecord> {
    const nowMs = this.clock.nowMs();
    return this.attemptStore.append({
      attemptId: this.attemptIdFactory(),
      idempotencyKey,
      ownerId: this.options.ownerId,
      unsignedTransaction,
      status: "prepared",
      transactionHash: null,
      replacesAttemptId,
      receiptBlockNumber: null,
      receiptBlockHash: null,
      failureCode: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    });
  }

  private async signAndBroadcast(
    attempt: TransactionAttemptRecord,
    simulation: Extract<SimulationResult, { readonly success: true }>,
  ): Promise<TransactionExecutionResult> {
    let rawTransaction: `0x${string}`;
    try {
      rawTransaction = await this.signer.signTransaction(
        attempt.unsignedTransaction,
      );
      assertHex(rawTransaction, "rawTransaction");
    } catch {
      const failed = await this.transitionAttempt(
        attempt,
        "signing-failed",
        {
          transactionHash: null,
          receiptBlockNumber: null,
          receiptBlockHash: null,
          failureCode: "SIGNING_FAILED",
        },
      );
      return { kind: "signing-failed", simulation, attempt: failed };
    }

    try {
      const transactionHash = await this.broadcaster.broadcast(rawTransaction);
      assertBytes32(transactionHash, "transactionHash");
      const submitted = await this.transitionAttempt(attempt, "submitted", {
        transactionHash,
        receiptBlockNumber: null,
        receiptBlockHash: null,
        failureCode: null,
      });
      return { kind: "submitted", simulation, attempt: submitted };
    } catch {
      const unknown = await this.transitionAttempt(
        attempt,
        "broadcast-unknown",
        {
          transactionHash: null,
          receiptBlockNumber: null,
          receiptBlockHash: null,
          failureCode: "BROADCAST_OUTCOME_UNKNOWN",
        },
      );
      return { kind: "broadcast-unknown", simulation, attempt: unknown };
    }
  }

  private async transitionAttempt(
    current: TransactionAttemptRecord,
    status: TransactionAttemptStatus,
    mutable: Pick<
      TransactionAttemptRecord,
      | "transactionHash"
      | "receiptBlockNumber"
      | "receiptBlockHash"
      | "failureCode"
    >,
  ): Promise<TransactionAttemptRecord> {
    return this.attemptStore.replace(current.version, {
      ...current,
      ...mutable,
      status,
      updatedAtMs: this.clock.nowMs(),
      version: current.version + 1,
    });
  }
}

function validateManagerOptions(options: TransactionManagerOptions): void {
  if (options.ownerId.trim().length === 0) {
    throw new TypeError("ownerId must not be empty");
  }
  if (
    !Number.isSafeInteger(options.nonceLeaseMs) ||
    options.nonceLeaseMs <= 0 ||
    !Number.isSafeInteger(options.minimumReplacementBumpBps) ||
    options.minimumReplacementBumpBps <= 0
  ) {
    throw new RangeError(
      "nonceLeaseMs and minimumReplacementBumpBps must be positive integers",
    );
  }
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

function validateFees(fees: FeeParameters): void {
  if (
    fees.maxFeePerGas <= 0n ||
    fees.maxPriorityFeePerGas < 0n ||
    fees.maxFeePerGas < fees.maxPriorityFeePerGas
  ) {
    throw new RangeError("Fee parameters are invalid");
  }
}

function validateReplacementFees(
  previous: FeeParameters,
  replacement: FeeParameters,
  minimumBumpBps: number,
): void {
  validateFees(replacement);
  const denominator = 10_000n;
  const numerator = denominator + BigInt(minimumBumpBps);
  const minimumMaxFee =
    (previous.maxFeePerGas * numerator + denominator - 1n) / denominator;
  const minimumPriority =
    previous.maxPriorityFeePerGas === 0n
      ? 0n
      : (
          previous.maxPriorityFeePerGas * numerator +
          denominator -
          1n
        ) / denominator;
  if (
    replacement.maxFeePerGas < minimumMaxFee ||
    replacement.maxPriorityFeePerGas < minimumPriority
  ) {
    throw new RangeError("Replacement fees do not satisfy the minimum bump");
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
