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
  readonly generation: bigint;
  readonly expiresAtMs: number;
  readonly nextNonce: bigint;
}

export interface TransactionSemanticIntent {
  readonly intentKey: string;
  readonly chainId: number;
  readonly signer: `0x${string}`;
  readonly to: `0x${string}`;
  readonly data: `0x${string}`;
  readonly value: bigint;
  readonly firstAttemptId: string;
  readonly createdAtMs: number;
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
  | "hash-recorded"
  | "submitted"
  | "broadcast-unknown"
  | "confirmed"
  | "reverted"
  | "reorged"
  | "replaced";

export interface TransactionAttemptRecord {
  readonly attemptId: string;
  readonly intentKey: string;
  readonly operationKey: string;
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

export interface PrepareInitialAttemptInput {
  readonly attemptId: string;
  readonly intentKey: string;
  readonly ownerId: string;
  readonly chainId: number;
  readonly signer: `0x${string}`;
  readonly to: `0x${string}`;
  readonly data: `0x${string}`;
  readonly value: bigint;
  readonly gasLimit: bigint;
  readonly fees: FeeParameters;
  readonly createdAtMs: number;
}

export interface PrepareReplacementAttemptInput {
  readonly attemptId: string;
  readonly operationKey: string;
  readonly ownerId: string;
  readonly previousAttemptId: string;
  readonly gasLimit: bigint;
  readonly fees: FeeParameters;
  readonly createdAtMs: number;
}

export interface PrepareAttemptResult {
  readonly inserted: boolean;
  readonly intent: TransactionSemanticIntent;
  readonly attempt: TransactionAttemptRecord;
}

export interface TransactionAttemptUpdate {
  readonly status: TransactionAttemptStatus;
  readonly transactionHash: `0x${string}` | null;
  readonly receiptBlockNumber: bigint | null;
  readonly receiptBlockHash: `0x${string}` | null;
  readonly failureCode: string | null;
  readonly updatedAtMs: number;
}

export interface TransactionPersistence {
  acquireNonce(
    scope: NonceScope,
    ownerId: string,
    networkPendingNonce: bigint,
    leaseMs: number,
  ): Promise<NonceLease | null>;
  assertNonceOwned(lease: NonceLease): Promise<void>;
  releaseNonce(lease: NonceLease): Promise<void>;
  prepareInitialAttempt(
    lease: NonceLease,
    input: PrepareInitialAttemptInput,
  ): Promise<PrepareAttemptResult>;
  prepareReplacementAttempt(
    lease: NonceLease,
    input: PrepareReplacementAttemptInput,
  ): Promise<PrepareAttemptResult>;
  getIntent(intentKey: string): Promise<TransactionSemanticIntent | null>;
  getAttempt(attemptId: string): Promise<TransactionAttemptRecord | null>;
  getAttemptByOperationKey(
    operationKey: string,
  ): Promise<TransactionAttemptRecord | null>;
  transitionAttempt(
    attemptId: string,
    expectedVersion: number,
    update: TransactionAttemptUpdate,
  ): Promise<TransactionAttemptRecord>;
  listByNonce(
    scope: NonceScope,
    nonce: bigint,
  ): Promise<readonly TransactionAttemptRecord[]>;
  listByIntentKey(
    intentKey: string,
  ): Promise<readonly TransactionAttemptRecord[]>;
}

interface MutableNonceState {
  readonly scope: NonceScope;
  ownerId: string | null;
  token: string | null;
  generation: bigint;
  expiresAtMs: number | null;
  nextNonce: bigint;
}

export class NonceOwnershipError extends Error {
  public constructor(scope: NonceScope) {
    super(`Nonce scope ${nonceScopeKey(scope)} is not owned by this lease`);
    this.name = "NonceOwnershipError";
  }
}

export class TransactionPersistenceConflictError extends Error {
  public constructor(identity: string) {
    super(`Transaction persistence conflict for ${identity}`);
    this.name = "TransactionPersistenceConflictError";
  }
}

export class InMemoryTransactionPersistence
implements TransactionPersistence {
  private readonly nonceStates = new Map<string, MutableNonceState>();
  private readonly intents = new Map<string, TransactionSemanticIntent>();
  private readonly attempts = new Map<string, TransactionAttemptRecord>();
  private readonly operationKeys = new Map<string, string>();
  private readonly transactionHashes = new Map<string, string>();

  public constructor(
    private readonly clock: Clock = new SystemClock(),
    private readonly tokenFactory: () => string = randomUUID,
  ) {}

  public async acquireNonce(
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
    const expiresAtMs = nowMs + leaseMs;
    assertTimestamp(expiresAtMs, "expiresAtMs");
    const key = nonceScopeKey(scope);
    const current = this.nonceStates.get(key);
    if (
      current !== undefined &&
      current.ownerId !== null &&
      current.ownerId !== ownerId &&
      current.expiresAtMs !== null &&
      current.expiresAtMs > nowMs
    ) {
      return null;
    }

    const token = this.tokenFactory();
    if (token.length === 0) {
      throw new Error("tokenFactory returned an empty nonce token");
    }
    const nextNonce =
      current === undefined || networkPendingNonce > current.nextNonce
        ? networkPendingNonce
        : current.nextNonce;
    const replacement: MutableNonceState = {
      scope: normalizeNonceScope(scope),
      ownerId,
      token,
      generation: (current?.generation ?? 0n) + 1n,
      expiresAtMs,
      nextNonce,
    };
    this.nonceStates.set(key, replacement);
    return leaseFromState(replacement);
  }

  public async assertNonceOwned(lease: NonceLease): Promise<void> {
    this.requireOwned(lease);
  }

  public async releaseNonce(lease: NonceLease): Promise<void> {
    const state = this.requireOwned(lease);
    state.ownerId = null;
    state.token = null;
    state.expiresAtMs = null;
  }

  public async prepareInitialAttempt(
    lease: NonceLease,
    input: PrepareInitialAttemptInput,
  ): Promise<PrepareAttemptResult> {
    const normalizedInput = normalizeInitialInput(input);
    validateInitialInput(normalizedInput);
    const existingIntent = this.intents.get(normalizedInput.intentKey);
    if (existingIntent !== undefined) {
      if (!sameIntentInput(existingIntent, normalizedInput)) {
        throw new TransactionPersistenceConflictError(
          normalizedInput.intentKey,
        );
      }
      const existingAttempt = this.attempts.get(
        existingIntent.firstAttemptId,
      );
      if (existingAttempt === undefined) {
        throw new Error(
          `Intent ${normalizedInput.intentKey} has no first attempt`,
        );
      }
      return {
        inserted: false,
        intent: cloneIntent(existingIntent),
        attempt: cloneAttempt(existingAttempt),
      };
    }

    const state = this.requireOwned(lease);
    assertLeaseMatchesInitial(state, normalizedInput);
    this.assertUnusedAttemptIdentity(
      normalizedInput.attemptId,
      normalizedInput.intentKey,
    );

    const intent: TransactionSemanticIntent = {
      intentKey: normalizedInput.intentKey,
      chainId: normalizedInput.chainId,
      signer: normalizedInput.signer,
      to: normalizedInput.to,
      data: normalizedInput.data,
      value: normalizedInput.value,
      firstAttemptId: normalizedInput.attemptId,
      createdAtMs: normalizedInput.createdAtMs,
    };
    const attempt: TransactionAttemptRecord = {
      attemptId: normalizedInput.attemptId,
      intentKey: normalizedInput.intentKey,
      operationKey: normalizedInput.intentKey,
      ownerId: normalizedInput.ownerId,
      unsignedTransaction: {
        chainId: normalizedInput.chainId,
        from: normalizedInput.signer,
        to: normalizedInput.to,
        nonce: state.nextNonce,
        data: normalizedInput.data,
        value: normalizedInput.value,
        gasLimit: normalizedInput.gasLimit,
        fees: { ...normalizedInput.fees },
      },
      status: "prepared",
      transactionHash: null,
      replacesAttemptId: null,
      receiptBlockNumber: null,
      receiptBlockHash: null,
      failureCode: null,
      createdAtMs: normalizedInput.createdAtMs,
      updatedAtMs: normalizedInput.createdAtMs,
      version: 1,
    };
    validateAttempt(attempt);

    this.intents.set(intent.intentKey, intent);
    this.attempts.set(attempt.attemptId, attempt);
    this.operationKeys.set(attempt.operationKey, attempt.attemptId);
    state.nextNonce += 1n;
    return {
      inserted: true,
      intent: cloneIntent(intent),
      attempt: cloneAttempt(attempt),
    };
  }

  public async prepareReplacementAttempt(
    lease: NonceLease,
    input: PrepareReplacementAttemptInput,
  ): Promise<PrepareAttemptResult> {
    validateReplacementInput(input);
    const existingOperationId = this.operationKeys.get(input.operationKey);
    if (existingOperationId !== undefined) {
      const existingAttempt = this.attempts.get(existingOperationId);
      if (
        existingAttempt === undefined ||
        !sameReplacementInput(existingAttempt, input)
      ) {
        throw new TransactionPersistenceConflictError(input.operationKey);
      }
      const intent = this.intents.get(existingAttempt.intentKey);
      if (intent === undefined) {
        throw new Error(`Intent ${existingAttempt.intentKey} is missing`);
      }
      return {
        inserted: false,
        intent: cloneIntent(intent),
        attempt: cloneAttempt(existingAttempt),
      };
    }

    this.requireOwned(lease);
    if (input.ownerId !== lease.ownerId) {
      throw new NonceOwnershipError(lease.scope);
    }
    const previous = this.attempts.get(input.previousAttemptId);
    if (previous === undefined) {
      throw new Error(
        `Previous attempt ${input.previousAttemptId} does not exist`,
      );
    }
    if (
      previous.unsignedTransaction.chainId !== lease.scope.chainId ||
      previous.unsignedTransaction.from.toLowerCase() !==
        lease.scope.signer.toLowerCase()
    ) {
      throw new NonceOwnershipError(lease.scope);
    }
    this.assertUnusedAttemptIdentity(input.attemptId, input.operationKey);

    const attempt: TransactionAttemptRecord = {
      attemptId: input.attemptId,
      intentKey: previous.intentKey,
      operationKey: input.operationKey,
      ownerId: input.ownerId,
      unsignedTransaction: {
        ...previous.unsignedTransaction,
        gasLimit: input.gasLimit,
        fees: { ...input.fees },
      },
      status: "prepared",
      transactionHash: null,
      replacesAttemptId: previous.attemptId,
      receiptBlockNumber: null,
      receiptBlockHash: null,
      failureCode: null,
      createdAtMs: input.createdAtMs,
      updatedAtMs: input.createdAtMs,
      version: 1,
    };
    validateAttempt(attempt);
    const intent = this.intents.get(attempt.intentKey);
    if (intent === undefined) {
      throw new Error(`Intent ${attempt.intentKey} is missing`);
    }

    this.attempts.set(attempt.attemptId, attempt);
    this.operationKeys.set(attempt.operationKey, attempt.attemptId);
    return {
      inserted: true,
      intent: cloneIntent(intent),
      attempt: cloneAttempt(attempt),
    };
  }

  public async getIntent(
    intentKey: string,
  ): Promise<TransactionSemanticIntent | null> {
    const intent = this.intents.get(intentKey);
    return intent === undefined ? null : cloneIntent(intent);
  }

  public async getAttempt(
    attemptId: string,
  ): Promise<TransactionAttemptRecord | null> {
    const attempt = this.attempts.get(attemptId);
    return attempt === undefined ? null : cloneAttempt(attempt);
  }

  public async getAttemptByOperationKey(
    operationKey: string,
  ): Promise<TransactionAttemptRecord | null> {
    const attemptId = this.operationKeys.get(operationKey);
    if (attemptId === undefined) return null;
    const attempt = this.attempts.get(attemptId);
    return attempt === undefined ? null : cloneAttempt(attempt);
  }

  public async transitionAttempt(
    attemptId: string,
    expectedVersion: number,
    update: TransactionAttemptUpdate,
  ): Promise<TransactionAttemptRecord> {
    const current = this.attempts.get(attemptId);
    if (
      current === undefined ||
      current.version !== expectedVersion
    ) {
      throw new TransactionPersistenceConflictError(attemptId);
    }
    const next: TransactionAttemptRecord = {
      ...current,
      ...update,
      version: current.version + 1,
    };
    validateAttempt(next);
    assertImmutableAttempt(current, next);
    assertAttemptTransition(current, next);

    if (
      next.transactionHash !== null &&
      current.transactionHash === null
    ) {
      const hashKey = next.transactionHash.toLowerCase();
      const existingHashAttempt = this.transactionHashes.get(hashKey);
      if (
        existingHashAttempt !== undefined &&
        existingHashAttempt !== next.attemptId
      ) {
        throw new TransactionPersistenceConflictError(
          next.transactionHash,
        );
      }
      this.transactionHashes.set(hashKey, next.attemptId);
    }
    this.attempts.set(attemptId, next);
    return cloneAttempt(next);
  }

  public async listByNonce(
    scope: NonceScope,
    nonce: bigint,
  ): Promise<readonly TransactionAttemptRecord[]> {
    validateNonceScope(scope);
    if (nonce < 0n) throw new RangeError("nonce must be non-negative");
    return [...this.attempts.values()]
      .filter(
        (attempt) =>
          attempt.unsignedTransaction.chainId === scope.chainId &&
          attempt.unsignedTransaction.from.toLowerCase() ===
            scope.signer.toLowerCase() &&
          attempt.unsignedTransaction.nonce === nonce,
      )
      .map(cloneAttempt)
      .sort(compareAttempts);
  }

  public async listByIntentKey(
    intentKey: string,
  ): Promise<readonly TransactionAttemptRecord[]> {
    return [...this.attempts.values()]
      .filter((attempt) => attempt.intentKey === intentKey)
      .map(cloneAttempt)
      .sort(compareAttempts);
  }

  private requireOwned(lease: NonceLease): MutableNonceState {
    const state = this.nonceStates.get(nonceScopeKey(lease.scope));
    const nowMs = this.clock.nowMs();
    if (
      state === undefined ||
      state.ownerId !== lease.ownerId ||
      state.token !== lease.token ||
      state.generation !== lease.generation ||
      state.expiresAtMs !== lease.expiresAtMs ||
      state.expiresAtMs <= nowMs
    ) {
      throw new NonceOwnershipError(lease.scope);
    }
    return state;
  }

  private assertUnusedAttemptIdentity(
    attemptId: string,
    operationKey: string,
  ): void {
    if (
      this.attempts.has(attemptId) ||
      this.operationKeys.has(operationKey)
    ) {
      throw new TransactionPersistenceConflictError(
        `${attemptId}:${operationKey}`,
      );
    }
  }
}

function validateNonceScope(scope: NonceScope): void {
  if (!Number.isSafeInteger(scope.chainId) || scope.chainId <= 0) {
    throw new RangeError("chainId must be a positive safe integer");
  }
  assertAddress(scope.signer, "signer");
}

function normalizeNonceScope(scope: NonceScope): NonceScope {
  return {
    chainId: scope.chainId,
    signer: scope.signer.toLowerCase() as `0x${string}`,
  };
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
    generation: state.generation,
    expiresAtMs: state.expiresAtMs,
    nextNonce: state.nextNonce,
  };
}

function normalizeInitialInput(
  input: PrepareInitialAttemptInput,
): PrepareInitialAttemptInput {
  return {
    ...input,
    signer: input.signer.toLowerCase() as `0x${string}`,
    to: input.to.toLowerCase() as `0x${string}`,
    data: input.data.toLowerCase() as `0x${string}`,
    fees: { ...input.fees },
  };
}

function validateInitialInput(input: PrepareInitialAttemptInput): void {
  if (
    input.attemptId.trim().length === 0 ||
    input.intentKey.trim().length === 0 ||
    input.ownerId.trim().length === 0
  ) {
    throw new TypeError(
      "attemptId, intentKey, and ownerId must not be empty",
    );
  }
  validateNonceScope({ chainId: input.chainId, signer: input.signer });
  assertAddress(input.to, "to");
  assertHex(input.data, "data");
  assertTimestamp(input.createdAtMs, "createdAtMs");
  validateTransactionNumbers(
    input.value,
    input.gasLimit,
    input.fees,
  );
}

function validateReplacementInput(
  input: PrepareReplacementAttemptInput,
): void {
  if (
    input.attemptId.trim().length === 0 ||
    input.operationKey.trim().length === 0 ||
    input.ownerId.trim().length === 0 ||
    input.previousAttemptId.trim().length === 0
  ) {
    throw new TypeError("Replacement identities must not be empty");
  }
  assertTimestamp(input.createdAtMs, "createdAtMs");
  validateTransactionNumbers(0n, input.gasLimit, input.fees);
}

function validateAttempt(attempt: TransactionAttemptRecord): void {
  if (
    attempt.attemptId.trim().length === 0 ||
    attempt.intentKey.trim().length === 0 ||
    attempt.operationKey.trim().length === 0 ||
    attempt.ownerId.trim().length === 0
  ) {
    throw new TypeError("Transaction attempt identities must not be empty");
  }
  const transaction = attempt.unsignedTransaction;
  validateNonceScope({
    chainId: transaction.chainId,
    signer: transaction.from,
  });
  assertAddress(transaction.to, "to");
  assertHex(transaction.data, "data");
  assertTimestamp(attempt.createdAtMs, "createdAtMs");
  assertTimestamp(attempt.updatedAtMs, "updatedAtMs");
  if (attempt.updatedAtMs < attempt.createdAtMs) {
    throw new RangeError("updatedAtMs cannot precede createdAtMs");
  }
  if (
    !Number.isSafeInteger(attempt.version) ||
    attempt.version <= 0 ||
    transaction.nonce < 0n
  ) {
    throw new RangeError("Transaction attempt version/nonce is invalid");
  }
  validateTransactionNumbers(
    transaction.value,
    transaction.gasLimit,
    transaction.fees,
  );
  const requiresHash = attempt.status !== "prepared";
  if (
    (requiresHash && attempt.transactionHash === null) ||
    (!requiresHash && attempt.transactionHash !== null)
  ) {
    throw new Error(
      `Transaction status ${attempt.status} has inconsistent hash evidence`,
    );
  }
  if (attempt.transactionHash !== null) {
    assertBytes32(attempt.transactionHash, "transactionHash");
  }
  if (
    (attempt.receiptBlockNumber === null) !==
    (attempt.receiptBlockHash === null)
  ) {
    throw new Error("Receipt block number/hash must be recorded together");
  }
  if (attempt.receiptBlockNumber !== null) {
    if (attempt.receiptBlockNumber < 0n) {
      throw new RangeError("receiptBlockNumber must be non-negative");
    }
    if (attempt.receiptBlockHash === null) {
      throw new Error("receiptBlockHash is required");
    }
    assertBytes32(attempt.receiptBlockHash, "receiptBlockHash");
  }
  if (
    (attempt.status === "confirmed" || attempt.status === "reverted") &&
    attempt.receiptBlockNumber === null
  ) {
    throw new Error(`Transaction status ${attempt.status} requires a receipt`);
  }
}

function validateTransactionNumbers(
  value: bigint,
  gasLimit: bigint,
  fees: FeeParameters,
): void {
  if (
    value < 0n ||
    gasLimit <= 0n ||
    fees.maxFeePerGas <= 0n ||
    fees.maxPriorityFeePerGas < 0n ||
    fees.maxFeePerGas < fees.maxPriorityFeePerGas
  ) {
    throw new RangeError("Transaction numeric values are invalid");
  }
}

function assertLeaseMatchesInitial(
  state: MutableNonceState,
  input: PrepareInitialAttemptInput,
): void {
  if (
    state.scope.chainId !== input.chainId ||
    state.scope.signer.toLowerCase() !== input.signer.toLowerCase() ||
    state.ownerId !== input.ownerId
  ) {
    throw new NonceOwnershipError(state.scope);
  }
}

function sameIntentInput(
  intent: TransactionSemanticIntent,
  input: PrepareInitialAttemptInput,
): boolean {
  return (
    intent.intentKey === input.intentKey &&
    intent.chainId === input.chainId &&
    intent.signer.toLowerCase() === input.signer.toLowerCase() &&
    intent.to.toLowerCase() === input.to.toLowerCase() &&
    intent.data.toLowerCase() === input.data.toLowerCase() &&
    intent.value === input.value
  );
}

function sameReplacementInput(
  attempt: TransactionAttemptRecord,
  input: PrepareReplacementAttemptInput,
): boolean {
  return (
    attempt.attemptId === input.attemptId &&
    attempt.operationKey === input.operationKey &&
    attempt.ownerId === input.ownerId &&
    attempt.replacesAttemptId === input.previousAttemptId &&
    attempt.unsignedTransaction.gasLimit === input.gasLimit &&
    isDeepStrictEqual(attempt.unsignedTransaction.fees, input.fees)
  );
}

function assertImmutableAttempt(
  current: TransactionAttemptRecord,
  next: TransactionAttemptRecord,
): void {
  if (
    current.attemptId !== next.attemptId ||
    current.intentKey !== next.intentKey ||
    current.operationKey !== next.operationKey ||
    current.ownerId !== next.ownerId ||
    !isDeepStrictEqual(
      current.unsignedTransaction,
      next.unsignedTransaction,
    ) ||
    current.replacesAttemptId !== next.replacesAttemptId ||
    current.createdAtMs !== next.createdAtMs ||
    (
      current.transactionHash !== null &&
      current.transactionHash.toLowerCase() !==
        next.transactionHash?.toLowerCase()
    )
  ) {
    throw new TransactionPersistenceConflictError(current.attemptId);
  }
}

function assertAttemptTransition(
  current: TransactionAttemptRecord,
  next: TransactionAttemptRecord,
): void {
  if (next.updatedAtMs < current.updatedAtMs) {
    throw new TransactionPersistenceConflictError(current.attemptId);
  }
  const allowed: Readonly<
    Record<TransactionAttemptStatus, readonly TransactionAttemptStatus[]>
  > = {
    prepared: ["hash-recorded"],
    "hash-recorded": [
      "hash-recorded",
      "submitted",
      "broadcast-unknown",
      "confirmed",
      "reverted",
      "reorged",
      "replaced",
    ],
    submitted: [
      "submitted",
      "broadcast-unknown",
      "confirmed",
      "reverted",
      "reorged",
      "replaced",
    ],
    "broadcast-unknown": [
      "broadcast-unknown",
      "submitted",
      "confirmed",
      "reverted",
      "reorged",
      "replaced",
    ],
    confirmed: ["confirmed", "reorged", "replaced"],
    reverted: ["reverted", "reorged", "replaced"],
    reorged: [
      "reorged",
      "submitted",
      "broadcast-unknown",
      "confirmed",
      "reverted",
      "replaced",
    ],
    replaced: [
      "replaced",
      "submitted",
      "confirmed",
      "reverted",
      "reorged",
    ],
  };
  if (!allowed[current.status].includes(next.status)) {
    throw new TransactionPersistenceConflictError(current.attemptId);
  }
}

function compareAttempts(
  left: TransactionAttemptRecord,
  right: TransactionAttemptRecord,
): number {
  if (left.createdAtMs !== right.createdAtMs) {
    return left.createdAtMs - right.createdAtMs;
  }
  return left.attemptId.localeCompare(right.attemptId);
}

function cloneIntent(
  intent: TransactionSemanticIntent,
): TransactionSemanticIntent {
  return { ...intent };
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
