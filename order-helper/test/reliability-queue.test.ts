import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "../src/reliability/clock";
import {
  InMemoryIdempotentQueue,
  QueueConflictError,
  StaleLeaseError,
  orderJobKey,
} from "../src/reliability/idempotent-queue";

const ORDER_ID = `0x${"11".repeat(32)}` as const;

test("queue keys deduplicate identical deliveries and reject collisions", async () => {
  const clock = new ManualClock(1_000);
  const queue = new InMemoryIdempotentQueue<{ readonly source: string }>(
    clock,
    () => "lease-1",
  );
  const identity = { chainId: 84_532, orderId: ORDER_ID, round: 3n };

  assert.equal(
    orderJobKey(identity),
    `84532:${ORDER_ID}:3`,
  );
  const first = await queue.enqueue(identity, { source: "scanner" });
  const duplicate = await queue.enqueue(identity, { source: "scanner" });

  assert.equal(first.inserted, true);
  assert.equal(duplicate.inserted, false);
  assert.equal((await queue.depth()).scheduled, 1);
  await assert.rejects(
    queue.enqueue(identity, { source: "listener" }),
    QueueConflictError,
  );
});

test("expired leases fall back to another worker with fencing", async () => {
  const clock = new ManualClock(10_000);
  const tokens = ["worker-a-token", "worker-b-token", "worker-b-retry"];
  const queue = new InMemoryIdempotentQueue<{ readonly order: string }>(
    clock,
    () => tokens.shift() ?? "unexpected-token",
  );
  await queue.enqueue(
    { chainId: 84_532, orderId: ORDER_ID, round: 1n },
    { order: ORDER_ID },
    { maxAttempts: 3 },
  );

  const first = await queue.leaseNext("worker-a", 100);
  assert.ok(first);
  assert.equal(first.job.attempts, 1);
  clock.advance(100);

  const fallback = await queue.leaseNext("worker-b", 100);
  assert.ok(fallback);
  assert.equal(fallback.job.attempts, 2);
  assert.notEqual(fallback.token, first.token);
  await assert.rejects(queue.complete(first), StaleLeaseError);

  await queue.retry(fallback, {
    availableAtMs: 10_500,
    errorCode: "RPC_UNAVAILABLE",
  });
  assert.equal(await queue.leaseNext("worker-b", 100), null);
  clock.set(10_500);
  const retry = await queue.leaseNext("worker-b", 100);
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
  const queue = new InMemoryIdempotentQueue<null>(
    clock,
    () => "single-token",
  );
  await queue.enqueue(
    { chainId: 1, orderId: ORDER_ID, round: 0n },
    null,
    { maxAttempts: 1 },
  );
  const lease = await queue.leaseNext("worker", 10);
  assert.ok(lease);
  const result = await queue.retry(lease, {
    availableAtMs: 20,
    errorCode: "PERMANENT",
  });
  assert.equal(result.status, "dead-letter");
});

test("an abandoned final lease is dead-lettered after expiry", async () => {
  const clock = new ManualClock(0);
  const queue = new InMemoryIdempotentQueue<null>(
    clock,
    () => "abandoned-token",
  );
  const identity = { chainId: 1, orderId: ORDER_ID, round: 9n };
  await queue.enqueue(identity, null, { maxAttempts: 1 });
  assert.ok(await queue.leaseNext("worker", 10));

  clock.set(10);
  assert.equal(await queue.leaseNext("fallback", 10), null);
  assert.equal((await queue.get(orderJobKey(identity)))?.status, "dead-letter");
});
