import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryTransactionPersistence,
  NonceLease,
  NonceScope,
  PrepareInitialAttemptInput,
  TransactionPersistenceConflictError,
} from "../src/persistence/transaction-store";
import { ManualClock } from "../src/reliability/clock";
import {
  OfflineTransactionEvidenceRecorder,
  ReceiptHashMismatchError,
  SimulationResult,
  TransactionChainState,
  TransactionIntent,
  TransactionManager,
  TransactionReceipt,
  TransactionReconciler,
  TransactionSimulator,
} from "../src/reliability/transaction-manager";

const SIGNER = `0x${"11".repeat(20)}` as const;
const DIAMOND = `0x${"22".repeat(20)}` as const;
const OTHER_DIAMOND = `0x${"23".repeat(20)}` as const;
const HASH_ONE = `0x${"31".repeat(32)}` as const;
const HASH_TWO = `0x${"32".repeat(32)}` as const;
const BLOCK_HASH_ONE = `0x${"41".repeat(32)}` as const;
const BLOCK_HASH_TWO = `0x${"42".repeat(32)}` as const;
const SCOPE: NonceScope = { chainId: 84_532, signer: SIGNER };

class FixedSimulator implements TransactionSimulator {
  public calls = 0;
  public result: SimulationResult = {
    success: true,
    gasEstimate: 200_000n,
  };

  public async simulate(): Promise<SimulationResult> {
    this.calls += 1;
    return this.result;
  }
}

class FakeReadOnlyChainState implements TransactionChainState {
  public head = 0n;
  public readonly receipts = new Map<string, TransactionReceipt>();
  public readonly blockHashes = new Map<bigint, `0x${string}`>();

  public async latestBlockNumber(): Promise<bigint> {
    return this.head;
  }

  public async blockHash(
    _chainId: number,
    blockNumber: bigint,
  ): Promise<`0x${string}` | null> {
    return this.blockHashes.get(blockNumber) ?? null;
  }

  public async receipt(
    _chainId: number,
    transactionHash: `0x${string}`,
  ): Promise<TransactionReceipt | null> {
    return this.receipts.get(transactionHash.toLowerCase()) ?? null;
  }
}

test("public manager hard-blocks action requests before simulation", async () => {
  const simulator = new FixedSimulator();
  const manager = new TransactionManager(simulator, SIGNER);

  const blocked = await manager.execute(intent("blocked"), true);
  assert.equal(blocked.kind, "blocked");
  assert.equal(blocked.capability, "TRANSACTION_DISABLED_SHADOW_ONLY");
  assert.equal(simulator.calls, 0);

  const shadow = await manager.execute(intent("shadow"), false);
  assert.equal(shadow.kind, "simulated");
  assert.equal(simulator.calls, 1);
});

test("nonce leases use monotonic generation and exact expiry fencing", async () => {
  const clock = new ManualClock(0);
  const store = new InMemoryTransactionPersistence(clock, () => "same-token");
  const first = await requiredLease(store, "owner-a", 7n, 10);
  const renewed = await requiredLease(store, "owner-a", 7n, 10);

  assert.equal(renewed.token, first.token);
  assert.equal(renewed.generation, first.generation + 1n);
  await assert.rejects(store.assertNonceOwned(first), /not owned/);
  await store.assertNonceOwned(renewed);

  clock.set(10);
  await assert.rejects(store.assertNonceOwned(renewed), /not owned/);
  const fallback = await requiredLease(store, "owner-b", 7n, 10);
  assert.equal(fallback.generation, renewed.generation + 1n);
});

test("semantic intent and nonce reservation are one atomic idempotent write", async () => {
  const clock = new ManualClock(1_000);
  const store = new InMemoryTransactionPersistence(clock, () => "lease-token");
  const lease = await requiredLease(store, "worker", 7n, 1_000);

  const first = await store.prepareInitialAttempt(
    lease,
    initialAttempt("attempt-1", "intent-1", "worker", 1_000),
  );
  assert.equal(first.inserted, true);
  assert.equal(first.attempt.unsignedTransaction.nonce, 7n);

  const duplicate = await store.prepareInitialAttempt(lease, {
    ...initialAttempt("ignored-attempt", "intent-1", "worker", 1_001),
    gasLimit: 999_999n,
  });
  assert.equal(duplicate.inserted, false);
  assert.equal(duplicate.attempt.attemptId, "attempt-1");
  assert.equal(duplicate.attempt.unsignedTransaction.nonce, 7n);

  await assert.rejects(
    store.prepareInitialAttempt(lease, {
      ...initialAttempt("collision", "intent-1", "worker", 1_002),
      to: OTHER_DIAMOND,
    }),
    TransactionPersistenceConflictError,
  );
  await assert.rejects(
    store.prepareInitialAttempt(lease, {
      ...initialAttempt("invalid", "intent-2", "worker", 1_003),
      gasLimit: 0n,
    }),
    /numeric values are invalid/,
  );

  const second = await store.prepareInitialAttempt(
    lease,
    initialAttempt("attempt-2", "intent-2", "worker", 1_004),
  );
  assert.equal(second.attempt.unsignedTransaction.nonce, 8n);
});

test("derived hash is durable before imported submission evidence", async () => {
  const clock = new ManualClock(2_000);
  const store = new InMemoryTransactionPersistence(clock, () => "lease-token");
  const lease = await requiredLease(store, "worker", 3n, 1_000);
  await store.prepareInitialAttempt(
    lease,
    initialAttempt("attempt-1", "intent-1", "worker", 2_000),
  );
  const recorder = new OfflineTransactionEvidenceRecorder(store, clock);

  await assert.rejects(
    recorder.recordSubmissionObservation("attempt-1", "observed"),
    /hash must be durable/,
  );
  const hashed = await recorder.recordDerivedHash("attempt-1", HASH_ONE);
  assert.equal(hashed.status, "hash-recorded");
  assert.equal(hashed.transactionHash, HASH_ONE);

  clock.advance(1);
  const uncertain = await recorder.recordSubmissionObservation(
    "attempt-1",
    "outcome-unknown",
  );
  assert.equal(uncertain.status, "broadcast-unknown");
  assert.equal(uncertain.transactionHash, HASH_ONE);
});

test("nonce-family reconciliation lets the original win after a reorg", async () => {
  const clock = new ManualClock(3_000);
  const store = new InMemoryTransactionPersistence(clock, () => "lease-token");
  const lease = await requiredLease(store, "worker", 7n, 10_000);
  const first = await store.prepareInitialAttempt(
    lease,
    initialAttempt("attempt-1", "intent-1", "worker", 3_000),
  );
  const replacement = await store.prepareReplacementAttempt(lease, {
    attemptId: "attempt-2",
    operationKey: "replace:intent-1:1",
    ownerId: "worker",
    previousAttemptId: first.attempt.attemptId,
    gasLimit: 210_000n,
    fees: { maxFeePerGas: 120n, maxPriorityFeePerGas: 12n },
    createdAtMs: 3_001,
  });
  const duplicate = await store.prepareReplacementAttempt(lease, {
    attemptId: "attempt-2",
    operationKey: "replace:intent-1:1",
    ownerId: "worker",
    previousAttemptId: first.attempt.attemptId,
    gasLimit: 210_000n,
    fees: { maxFeePerGas: 120n, maxPriorityFeePerGas: 12n },
    createdAtMs: 3_001,
  });
  assert.equal(duplicate.inserted, false);
  assert.equal(replacement.attempt.unsignedTransaction.nonce, 7n);

  clock.set(3_001);
  const recorder = new OfflineTransactionEvidenceRecorder(store, clock);
  await recorder.recordDerivedHash("attempt-1", HASH_ONE);
  await recorder.recordSubmissionObservation("attempt-1", "observed");
  await recorder.recordDerivedHash("attempt-2", HASH_TWO);
  await recorder.recordSubmissionObservation("attempt-2", "observed");

  const chain = new FakeReadOnlyChainState();
  chain.receipts.set(HASH_TWO, receipt(HASH_TWO, 10n, BLOCK_HASH_ONE));
  chain.blockHashes.set(10n, BLOCK_HASH_ONE);
  chain.head = 11n;
  const reconciler = new TransactionReconciler(store, chain, clock);
  const replacementWins = await reconciler.reconcileNonceFamily(
    SCOPE,
    7n,
    2,
  );
  assert.equal(replacementWins.finalAttemptId, "attempt-2");
  assert.deepEqual(
    replacementWins.attempts.map((attempt) => attempt.status),
    ["replaced", "confirmed"],
  );

  chain.receipts.delete(HASH_TWO);
  chain.blockHashes.set(10n, BLOCK_HASH_TWO);
  chain.receipts.set(HASH_ONE, receipt(HASH_ONE, 12n, BLOCK_HASH_ONE));
  chain.blockHashes.set(12n, BLOCK_HASH_ONE);
  chain.head = 13n;
  clock.advance(1);
  const originalWins = await reconciler.reconcileNonceFamily(SCOPE, 7n, 2);
  assert.equal(originalWins.finalAttemptId, "attempt-1");
  assert.deepEqual(
    originalWins.attempts.map((attempt) => attempt.status),
    ["confirmed", "replaced"],
  );
});

test("receipt identity is checked before reconciliation mutates records", async () => {
  const clock = new ManualClock(4_000);
  const store = new InMemoryTransactionPersistence(clock, () => "lease-token");
  const lease = await requiredLease(store, "worker", 1n, 1_000);
  await store.prepareInitialAttempt(
    lease,
    initialAttempt("attempt-1", "intent-1", "worker", 4_000),
  );
  const recorder = new OfflineTransactionEvidenceRecorder(store, clock);
  await recorder.recordDerivedHash("attempt-1", HASH_ONE);
  await recorder.recordSubmissionObservation("attempt-1", "observed");

  const chain = new FakeReadOnlyChainState();
  chain.receipts.set(HASH_ONE, receipt(HASH_TWO, 1n, BLOCK_HASH_ONE));
  const reconciler = new TransactionReconciler(store, chain, clock);
  await assert.rejects(
    reconciler.reconcileNonceFamily(SCOPE, 1n, 1),
    ReceiptHashMismatchError,
  );
  assert.equal((await store.getAttempt("attempt-1"))?.status, "submitted");
});

async function requiredLease(
  store: InMemoryTransactionPersistence,
  ownerId: string,
  networkPendingNonce: bigint,
  leaseMs: number,
): Promise<NonceLease> {
  const lease = await store.acquireNonce(
    SCOPE,
    ownerId,
    networkPendingNonce,
    leaseMs,
  );
  if (lease === null) throw new Error("Expected nonce lease");
  return lease;
}

function initialAttempt(
  attemptId: string,
  intentKey: string,
  ownerId: string,
  createdAtMs: number,
): PrepareInitialAttemptInput {
  return {
    attemptId,
    intentKey,
    ownerId,
    chainId: SCOPE.chainId,
    signer: SCOPE.signer,
    to: DIAMOND,
    data: "0xabcdef",
    value: 0n,
    gasLimit: 200_000n,
    fees: { maxFeePerGas: 100n, maxPriorityFeePerGas: 10n },
    createdAtMs,
  };
}

function intent(idempotencyKey: string): TransactionIntent {
  return {
    idempotencyKey,
    chainId: SCOPE.chainId,
    to: DIAMOND,
    data: "0xabcdef",
    value: 0n,
  };
}

function receipt(
  transactionHash: `0x${string}`,
  blockNumber: bigint,
  blockHash: `0x${string}`,
): TransactionReceipt {
  return { transactionHash, blockNumber, blockHash, success: true };
}
