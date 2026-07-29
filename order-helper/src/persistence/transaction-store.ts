import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Clock, SystemClock, assertTimestamp } from "../reliability/clock";

export interface NonceScope {
  readonly chainId: number;
  readonly signer: `0x${string}`;
}

export interface NonceLease {
  readonly scope: NonceScope;
  readonly ownerId: string;
  readonly token: string;
  readonly expiresAtMs: number;
  readonly nextNonce: bigint;
}

export interface NonceOwnershipStore {
  acquire(
    scope: NonceScope,
    ownerId: string,
    networkPendingNonce: bigint,
    leaseMs: number,
  ): Promise<NonceLease | null>;
  reserve(lease: NonceLease): Promise<bigint>;
  assertOwned(lease: NonceLease): Promise<void>;
  release(lease: NonceLease): Promise<void>;
}

interface MutableNonceState {
  readonly scope: NonceScope;
  ownerId: string | null;
  token: string | null;
  expiresAtMs: number | null;
  nextNonce: bigint;
}

export class NonceOwnershipError extends Error {
  public constructor(scope: NonceScope) {
    super(`Nonce scope ${nonceScopeKey(scope)} is not owned by this lease`);
    this.name = "NonceOwnershipError";
  }
}

export class InMemoryNonceOwnershipStore implements NonceOwnershipStore {
  private readonly states = new Map<string, MutableNonceState>();

  public constructor(
    private readonly clock: Clock = new SystemClock(),
    private readonly tokenFactory: () => string = randomUUID,
  ) {}

  public async acquire(
    scope: NonceScope,
    ownerId: string,
    networkPendingNonce: bigint,
    leaseMs: number,
  ): Promise<NonceLease | null> {
    validateNonceScope(scope);
    if (ownerId.trim().length === 0) {
      throw new TypeError("ownerId must not be empty");
    }
    if (networkPendingNonce < 0n) {
      throw new RangeError("networkPendingNonce must be non-negative");
    }
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
      throw new RangeError("leaseMs must be a positive safe integer");
    }

    const nowMs = this.clock.nowMs();
    const key = nonceScopeKey(scope);
    const state = this.states.get(key);
    if (
      state !== undefined &&
      state.ownerId !== null &&
      state.ownerId !== ownerId &&
      state.expiresAtMs !== null &&
      state.expiresAtMs > nowMs
    ) {
      return null;
    }

    if (
      state !== undefined &&
      state.ownerId === ownerId &&
      state.token !== null &&
      state.expiresAtMs !== null &&
      state.expiresAtMs > nowMs
    ) {
      state.expiresAtMs = nowMs + leaseMs;
      if (networkPendingNonce > state.nextNonce) {
        state.nextNonce = networkPendingNonce;
      }
      return leaseFromState(state);
    }

    const token = this.tokenFactory();
    if (token.length === 0) {
      throw new Error("tokenFactory returned an empty nonce token");
    }
    const replacement: MutableNonceState = {
      scope: { ...scope },
      ownerId,
      token,
      expiresAtMs: nowMs + leaseMs,
      nextNonce:
        state === undefined || networkPendingNonce > state.nextNonce
          ? networkPendingNonce
          : state.nextNonce,
    };
    this.states.set(key, replacement);
    return leaseFromState(replacement);
  }

  public async reserve(lease: NonceLease): Promise<bigint> {
    const state = this.requireOwned(lease);
    const nonce = state.nextNonce;
    state.nextNonce += 1n;
    return nonce;
  }

  public async assertOwned(lease: NonceLease): Promise<void> {
    this.requireOwned(lease);
  }

  public async release(lease: NonceLease): Promise<void> {
    const state = this.requireOwned(lease);
    state.ownerId = null;
    state.token = null;
    state.expiresAtMs = null;
  }

  private requireOwned(lease: NonceLease): MutableNonceState {
    const state = this.states.get(nonceScopeKey(lease.scope));
    const nowMs = this.clock.nowMs();
    if (
      state === undefined ||
      state.ownerId !== lease.ownerId ||
      state.token !== lease.token ||
      state.expiresAtMs === null ||
      state.expiresAtMs <= nowMs
    ) {
      throw new NonceOwnershipError(lease.scope);
    }
    return state;
  }
}

export interface FeeParameters {
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
}

export interface UnsignedTransaction {
  readonly chainId: number;
  readonly from: `0x${string}`;
  readonly to: `0x${string}`;
  readonly nonce: bigint;
  readonly data: `0x${string}`;
  readonly value: bigint;
  readonly gasLimit: bigint;
  readonly fees: FeeParameters;
}

export type TransactionAttemptStatus =
  | "prepared"
  | "signing-failed"
  | "submitted"
  | "broadcast-unknown"
  | "confirmed"
  | "reverted"
  | "reorged"
  | "replaced";

export interface TransactionAttemptRecord {
  readonly attemptId: string;
  readonly idempotencyKey: string;
  readonly ownerId: string;
  readonly unsignedTransaction: UnsignedTransaction;
  readonly status: TransactionAttemptStatus;
  readonly transactionHash: `0x${string}` | null;
  readonly replacesAttemptId: string | null;
  readonly receiptBlockNumber: bigint | null;
  readonly receiptBlockHash: `0x${string}` | null;
  readonly failureCode: string | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly version: number;
}

export interface TransactionAttemptStore {
  append(
    attempt: Omit<TransactionAttemptRecord, "version">,
  ): Promise<TransactionAttemptRecord>;
  get(attemptId: string): Promise<TransactionAttemptRecord | null>;
  replace(
    expectedVersion: number,
    next: TransactionAttemptRecord,
  ): Promise<TransactionAttemptRecord>;
  listByNonce(
    scope: NonceScope,
    nonce: bigint,
  ): Promise<readonly TransactionAttemptRecord[]>;
}

export class TransactionAttemptConflictError extends Error {
  public constructor(attemptId: string) {
    super(`Transaction attempt ${attemptId} changed concurrently`);
    this.name = "TransactionAttemptConflictError";
  }
}

export class InMemoryTransactionAttemptStore
implements TransactionAttemptStore {
  private readonly attempts = new Map<string, TransactionAttemptRecord>();

  public async append(
    attempt: Omit<TransactionAttemptRecord, "version">,
  ): Promise<TransactionAttemptRecord> {
    validateAttempt({ ...attempt, version: 1 });
    const existing = this.attempts.get(attempt.attemptId);
    if (existing !== undefined) {
      const proposed = { ...attempt, version: existing.version };
      if (!isDeepStrictEqual(existing, proposed)) {
        throw new TransactionAttemptConflictError(attempt.attemptId);
      }
      return cloneAttempt(existing);
    }
    const stored = { ...attempt, version: 1 };
    this.attempts.set(stored.attemptId, stored);
    return cloneAttempt(stored);
  }

  public async get(
    attemptId: string,
  ): Promise<TransactionAttemptRecord | null> {
    const attempt = this.attempts.get(attemptId);
    return attempt === undefined ? null : cloneAttempt(attempt);
  }

  public async replace(
    expectedVersion: number,
    next: TransactionAttemptRecord,
  ): Promise<TransactionAttemptRecord> {
    validateAttempt(next);
    const current = this.attempts.get(next.attemptId);
    if (
      current === undefined ||
      current.version !== expectedVersion ||
      next.version !== expectedVersion + 1 ||
      !sameImmutableAttemptFields(current, next)
    ) {
      throw new TransactionAttemptConflictError(next.attemptId);
    }
    const stored = cloneAttempt(next);
    this.attempts.set(next.attemptId, stored);
    return cloneAttempt(stored);
  }

  public async listByNonce(
    scope: NonceScope,
    nonce: bigint,
  ): Promise<readonly TransactionAttemptRecord[]> {
    return [...this.attempts.values()]
      .filter(
        (attempt) =>
          attempt.unsignedTransaction.chainId === scope.chainId &&
          attempt.unsignedTransaction.from.toLowerCase() ===
            scope.signer.toLowerCase() &&
          attempt.unsignedTransaction.nonce === nonce,
      )
      .map(cloneAttempt)
      .sort((left, right) => left.createdAtMs - right.createdAtMs);
  }
}

function validateNonceScope(scope: NonceScope): void {
  if (!Number.isSafeInteger(scope.chainId) || scope.chainId <= 0) {
    throw new RangeError("chainId must be a positive safe integer");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(scope.signer)) {
    throw new TypeError("signer must be a 20-byte hexadecimal value");
  }
}

function nonceScopeKey(scope: NonceScope): string {
  return `${scope.chainId}:${scope.signer.toLowerCase()}`;
}

function leaseFromState(state: MutableNonceState): NonceLease {
  if (
    state.ownerId === null ||
    state.token === null ||
    state.expiresAtMs === null
  ) {
    throw new Error("Cannot create a lease from an unowned nonce state");
  }
  return {
    scope: { ...state.scope },
    ownerId: state.ownerId,
    token: state.token,
    expiresAtMs: state.expiresAtMs,
    nextNonce: state.nextNonce,
  };
}

function validateAttempt(attempt: TransactionAttemptRecord): void {
  if (
    attempt.attemptId.trim().length === 0 ||
    attempt.idempotencyKey.trim().length === 0 ||
    attempt.ownerId.trim().length === 0
  ) {
    throw new TypeError(
      "attemptId, idempotencyKey, and ownerId must not be empty",
    );
  }
  assertTimestamp(attempt.createdAtMs, "createdAtMs");
  assertTimestamp(attempt.updatedAtMs, "updatedAtMs");
  if (
    !Number.isSafeInteger(attempt.version) ||
    attempt.version <= 0 ||
    attempt.unsignedTransaction.nonce < 0n ||
    attempt.unsignedTransaction.value < 0n ||
    attempt.unsignedTransaction.gasLimit <= 0n ||
    attempt.unsignedTransaction.fees.maxFeePerGas <= 0n ||
    attempt.unsignedTransaction.fees.maxPriorityFeePerGas < 0n ||
    attempt.unsignedTransaction.fees.maxFeePerGas <
      attempt.unsignedTransaction.fees.maxPriorityFeePerGas
  ) {
    throw new RangeError("Transaction attempt contains invalid numeric values");
  }
}

function sameImmutableAttemptFields(
  current: TransactionAttemptRecord,
  next: TransactionAttemptRecord,
): boolean {
  return (
    current.attemptId === next.attemptId &&
    current.idempotencyKey === next.idempotencyKey &&
    current.ownerId === next.ownerId &&
    isDeepStrictEqual(
      current.unsignedTransaction,
      next.unsignedTransaction,
    ) &&
    current.replacesAttemptId === next.replacesAttemptId &&
    current.createdAtMs === next.createdAtMs
  );
}

function cloneAttempt(
  attempt: TransactionAttemptRecord,
): TransactionAttemptRecord {
  return {
    ...attempt,
    unsignedTransaction: {
      ...attempt.unsignedTransaction,
      fees: { ...attempt.unsignedTransaction.fees },
    },
  };
}
