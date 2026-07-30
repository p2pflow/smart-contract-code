import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "../src/reliability/clock";
import {
  type DurableWorkPayload,
  InMemoryIdempotentQueue,
  QueueConflictError,
  StaleLeaseError,
  orderJobKey,
} from "../src/reliability/idempotent-queue";

const ORDER_ID = `0x${"11".repeat(32)}` as const;
const SUBJECT_ID = `0x${"22".repeat(32)}` as const;
const CONTEXT_ID = `0x${"33".repeat(32)}` as const;
const ALTERNATE_CONTEXT_ID = `0x${"44".repeat(32)}` as const;
const WORKER_A = `0x${"51".repeat(32)}` as const;
const WORKER_B = `0x${"52".repeat(32)}` as const;
const LEASE_TOKEN_A = `0x${"61".repeat(32)}` as const;
const LEASE_TOKEN_B = `0x${"62".repeat(32)}` as const;
const LEASE_TOKEN_C = `0x${"63".repeat(32)}` as const;

type MutableDurableWorkPayload = {
  -readonly [Key in keyof DurableWorkPayload]: DurableWorkPayload[Key];
};

function durablePayload(
  kind: DurableWorkPayload["kind"] = "order-evaluation",
  contextId: DurableWorkPayload["contextId"] = CONTEXT_ID,
): MutableDurableWorkPayload {
  return {
    schema: "order-helper.durable-work.v1",
    kind,
    subjectId: SUBJECT_ID,
    contextId,
  };
}

test("queue keys deduplicate identical deliveries and reject collisions", async () => {
  const clock = new ManualClock(1_000);
  const queue = new InMemoryIdempotentQueue<DurableWorkPayload>(
    clock,
    () => LEASE_TOKEN_A,
  );
  const identity = { chainId: 84_532, orderId: ORDER_ID, round: 3n };

  assert.equal(
    orderJobKey(identity),
    `84532:${ORDER_ID}:3`,
  );
  const first = await queue.enqueue(identity, durablePayload());
  const duplicate = await queue.enqueue(identity, durablePayload());

  assert.equal(first.inserted, true);
  assert.equal(duplicate.inserted, false);
  assert.equal((await queue.depth()).scheduled, 1);
  await assert.rejects(
    queue.enqueue(identity, durablePayload("order-expiry")),
    QueueConflictError,
  );
});

test("expired leases fall back to another worker with fencing", async () => {
  const clock = new ManualClock(10_000);
  const tokens = [LEASE_TOKEN_A, LEASE_TOKEN_B, LEASE_TOKEN_C];
  const queue = new InMemoryIdempotentQueue<DurableWorkPayload>(
    clock,
    () => tokens.shift() ?? LEASE_TOKEN_C,
  );
  await queue.enqueue(
    { chainId: 84_532, orderId: ORDER_ID, round: 1n },
    durablePayload("order-expiry"),
    { maxAttempts: 3 },
  );

  const first = await queue.leaseNext(WORKER_A, 100);
  assert.ok(first);
  assert.equal(first.job.attempts, 1);
  clock.advance(100);

  const fallback = await queue.leaseNext(WORKER_B, 100);
  assert.ok(fallback);
  assert.equal(fallback.job.attempts, 2);
  assert.notEqual(fallback.token, first.token);
  await assert.rejects(queue.complete(first), StaleLeaseError);

  await queue.retry(fallback, {
    availableAtMs: 10_500,
    errorCode: "RPC_UNAVAILABLE",
  });
  assert.equal(await queue.leaseNext(WORKER_B, 100), null);
  clock.set(10_500);
  const retry = await queue.leaseNext(WORKER_B, 100);
  assert.ok(retry);
  assert.equal(retry.job.attempts, 3);
  const completed = await queue.complete(retry);
  assert.equal(completed.status, "succeeded");
  assert.deepEqual(await queue.depth(), {
    scheduled: 0,
    leased: 0,
    succeeded: 1,
    "dead-letter": 0,
  });
});

test("retry exhaustion moves a job to the dead-letter state", async () => {
  const clock = new ManualClock(0);
  const queue = new InMemoryIdempotentQueue<DurableWorkPayload>(
    clock,
    () => LEASE_TOKEN_A,
  );
  await queue.enqueue(
    { chainId: 1, orderId: ORDER_ID, round: 0n },
    durablePayload("order-evaluation", null),
    { maxAttempts: 1 },
  );
  const lease = await queue.leaseNext(WORKER_A, 10);
  assert.ok(lease);
  const result = await queue.retry(lease, {
    availableAtMs: 20,
    errorCode: "PROCESSING_FAILED",
  });
  assert.equal(result.status, "dead-letter");
});

test("an abandoned final lease is dead-lettered after expiry", async () => {
  const clock = new ManualClock(0);
  const queue = new InMemoryIdempotentQueue<DurableWorkPayload>(
    clock,
    () => LEASE_TOKEN_A,
  );
  const identity = { chainId: 1, orderId: ORDER_ID, round: 9n };
  await queue.enqueue(
    identity,
    durablePayload("order-expiry"),
    { maxAttempts: 1 },
  );
  assert.ok(await queue.leaseNext(WORKER_A, 10));

  clock.set(10);
  assert.equal(await queue.leaseNext(WORKER_B, 10), null);
  assert.equal((await queue.get(orderJobKey(identity)))?.status, "dead-letter");
});

test("queue isolates reference payloads and fences reused lease tokens", async () => {
  const clock = new ManualClock(0);
  const queue = new InMemoryIdempotentQueue<MutableDurableWorkPayload>(
    clock,
    () => LEASE_TOKEN_A,
  );
  const identity = { chainId: 1, orderId: ORDER_ID, round: 11n };
  const payload = durablePayload();
  const inserted = await queue.enqueue(identity, payload, { maxAttempts: 3 });

  payload.contextId = ALTERNATE_CONTEXT_ID;
  inserted.job.payload.contextId = ALTERNATE_CONTEXT_ID;
  assert.equal(
    (await queue.get(orderJobKey(identity)))?.payload.contextId,
    CONTEXT_ID,
  );

  const first = await queue.leaseNext(WORKER_A, 10);
  assert.ok(first);
  first.job.payload.contextId = ALTERNATE_CONTEXT_ID;
  clock.set(10);
  const fallback = await queue.leaseNext(WORKER_A, 10);
  assert.ok(fallback);
  assert.equal(fallback.token, first.token);
  assert.equal(fallback.generation, first.generation + 1n);
  assert.equal(fallback.job.payload.contextId, CONTEXT_ID);
  await assert.rejects(queue.complete(first), StaleLeaseError);
});
