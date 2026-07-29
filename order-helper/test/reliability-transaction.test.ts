import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "../src/reliability/clock";
import {
  FeeParameters,
  InMemoryNonceOwnershipStore,
  InMemoryTransactionAttemptStore,
  NonceScope,
  UnsignedTransaction,
} from "../src/persistence/transaction-store";
import {
  BroadcastAuthorizationGate,
  DenyAllBroadcastGate,
  FeeProvider,
  SimulationResult,
  TransactionBroadcaster,
  TransactionChainState,
  TransactionIntent,
  TransactionManager,
  TransactionReceipt,
  TransactionSigner,
  TransactionSimulator,
} from "../src/reliability/transaction-manager";

const SIGNER = `0x${"11".repeat(20)}` as const;
const DIAMOND = `0x${"22".repeat(20)}` as const;
const HASH_ONE = `0x${"31".repeat(32)}` as const;
const HASH_TWO = `0x${"32".repeat(32)}` as const;
const BLOCK_HASH = `0x${"41".repeat(32)}` as const;

class FixedSimulator implements TransactionSimulator {
  public result: SimulationResult = {
    success: true,
    gasEstimate: 200_000n,
  };

  public async simulate(): Promise<SimulationResult> {
    return this.result;
  }
}

class FakeSigner implements TransactionSigner {
  public signCalls = 0;
  public readonly transactions: UnsignedTransaction[] = [];

  public async address(): Promise<typeof SIGNER> {
    return SIGNER;
  }

  public async signTransaction(
    transaction: UnsignedTransaction,
  ): Promise<`0x${string}`> {
    this.signCalls += 1;
    this.transactions.push(transaction);
    return "0x1234";
  }
}

class FakeBroadcaster implements TransactionBroadcaster {
  public calls = 0;
  public readonly hashes = [HASH_ONE, HASH_TWO];

  public async broadcast(): Promise<`0x${string}`> {
    this.calls += 1;
    const hash = this.hashes.shift();
    if (hash === undefined) throw new Error("No fake hash configured");
    return hash;
  }
}

class FakeChainState implements TransactionChainState {
  public pending = 7n;
  public head = 0n;
  public receiptValue: TransactionReceipt | null = null;
  public readonly hashes = new Map<bigint, `0x${string}`>();

  public async pendingNonce(_scope: NonceScope): Promise<bigint> {
    return this.pending;
  }

  public async latestBlockNumber(): Promise<bigint> {
    return this.head;
  }

  public async blockHash(
    _chainId: number,
    blockNumber: bigint,
  ): Promise<`0x${string}` | null> {
    return this.hashes.get(blockNumber) ?? null;
  }

  public async receipt(): Promise<TransactionReceipt | null> {
    return this.receiptValue;
  }
}

class FixedFeeProvider implements FeeProvider {
  public async initialFees(): Promise<FeeParameters> {
    return {
      maxFeePerGas: 100n,
      maxPriorityFeePerGas: 10n,
    };
  }

  public async replacementFees(): Promise<FeeParameters> {
    return {
      maxFeePerGas: 120n,
      maxPriorityFeePerGas: 12n,
    };
  }
}

const allowGate: BroadcastAuthorizationGate = {
  authorize: async () => ({ authorized: true, blockers: [] }),
};

test("shadow execution and deny-all gate cannot reach signing or broadcast", async () => {
  const clock = new ManualClock(1_000);
  const signer = new FakeSigner();
  const broadcaster = new FakeBroadcaster();
  const manager = makeManager(
    new DenyAllBroadcastGate(),
    signer,
    broadcaster,
    new FakeChainState(),
    new InMemoryNonceOwnershipStore(clock, () => "nonce-token"),
    new InMemoryTransactionAttemptStore(),
    clock,
  );

  const shadow = await manager.execute(intent("shadow"), false);
  assert.equal(shadow.kind, "simulated");
  const blocked = await manager.execute(intent("blocked"), true);
  assert.equal(blocked.kind, "blocked");
  assert.equal(signer.signCalls, 0);
  assert.equal(broadcaster.calls, 0);
});

test("nonce ownership uses expiring fencing leases", async () => {
  const clock = new ManualClock(0);
  const tokens = ["owner-a-token", "owner-b-token"];
  const store = new InMemoryNonceOwnershipStore(
    clock,
    () => tokens.shift() ?? "unexpected-token",
  );
  const scope = { chainId: 84_532, signer: SIGNER };
  const ownerA = await store.acquire(scope, "owner-a", 5n, 10);
  assert.ok(ownerA);
  assert.equal(await store.reserve(ownerA), 5n);
  assert.equal(await store.acquire(scope, "owner-b", 5n, 10), null);

  clock.set(10);
  const ownerB = await store.acquire(scope, "owner-b", 5n, 10);
  assert.ok(ownerB);
  await assert.rejects(store.reserve(ownerA), /not owned/);
  assert.equal(await store.reserve(ownerB), 6n);
});

test("replacement keeps the nonce, bumps fees, and reconciles finality", async () => {
  const clock = new ManualClock(2_000);
  const signer = new FakeSigner();
  const broadcaster = new FakeBroadcaster();
  const chain = new FakeChainState();
  const nonceStore = new InMemoryNonceOwnershipStore(
    clock,
    () => "nonce-owner-token",
  );
  const attempts = new InMemoryTransactionAttemptStore();
  const manager = makeManager(
    allowGate,
    signer,
    broadcaster,
    chain,
    nonceStore,
    attempts,
    clock,
  );

  const first = await manager.execute(intent("decision-1"), true);
  if (first.kind !== "submitted") {
    throw new Error(`Expected submitted, received ${first.kind}`);
  }
  assert.equal(first.attempt.unsignedTransaction.nonce, 7n);
  assert.equal(first.attempt.transactionHash, HASH_ONE);

  const replacement = await manager.replace(first.attempt.attemptId);
  if (replacement.kind !== "submitted") {
    throw new Error(`Expected replacement submit, received ${replacement.kind}`);
  }
  assert.equal(replacement.attempt.unsignedTransaction.nonce, 7n);
  assert.deepEqual(replacement.attempt.unsignedTransaction.fees, {
    maxFeePerGas: 120n,
    maxPriorityFeePerGas: 12n,
  });
  assert.equal(
    (await attempts.get(first.attempt.attemptId))?.status,
    "replaced",
  );
  assert.equal(
    (await attempts.listByNonce(
      { chainId: 84_532, signer: SIGNER },
      7n,
    )).length,
    2,
  );

  chain.receiptValue = {
    transactionHash: HASH_TWO,
    blockNumber: 10n,
    blockHash: BLOCK_HASH,
    success: true,
  };
  chain.hashes.set(10n, BLOCK_HASH);
  chain.head = 10n;
  const provisional = await manager.reconcile(
    replacement.attempt.attemptId,
    2,
  );
  assert.equal(provisional.status, "submitted");
  assert.equal(provisional.receiptBlockNumber, 10n);

  chain.head = 11n;
  const confirmed = await manager.reconcile(
    replacement.attempt.attemptId,
    2,
  );
  assert.equal(confirmed.status, "confirmed");
  assert.equal(signer.signCalls, 2);
  assert.equal(broadcaster.calls, 2);
});

function makeManager(
  gate: BroadcastAuthorizationGate,
  signer: TransactionSigner,
  broadcaster: TransactionBroadcaster,
  chain: TransactionChainState,
  nonceStore: InMemoryNonceOwnershipStore,
  attempts: InMemoryTransactionAttemptStore,
  clock: ManualClock,
): TransactionManager {
  let attemptNumber = 0;
  return new TransactionManager(
    new FixedSimulator(),
    gate,
    signer,
    broadcaster,
    chain,
    new FixedFeeProvider(),
    nonceStore,
    attempts,
    {
      ownerId: "transaction-worker",
      nonceLeaseMs: 1_000,
      minimumReplacementBumpBps: 1_000,
    },
    clock,
    () => {
      attemptNumber += 1;
      return `attempt-${attemptNumber}`;
    },
  );
}

function intent(idempotencyKey: string): TransactionIntent {
  return {
    idempotencyKey,
    chainId: 84_532,
    to: DIAMOND,
    data: "0xabcdef",
    value: 0n,
  };
}
