import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "../src/reliability/clock";
import {
  ExpiryRetrySweeper,
  InMemoryScheduledWorkStore,
  SweepProcessor,
  SweepReason,
} from "../src/reliability/expiry-retry-sweeper";

interface Payload {
  readonly orderId: string;
}

test("sweeper distinguishes one-time expiry handling from later retries", async () => {
  const clock = new ManualClock(0);
  const store = new InMemoryScheduledWorkStore<Payload>(
    clock,
    () => "sweep-token",
  );
  await store.schedule({
    id: "order-round-1",
    payload: { orderId: "order-1" },
    expiresAtMs: 100,
    retryAtMs: null,
    maxAttempts: 4,
  });
  const reasons: SweepReason[] = [];
  const processor: SweepProcessor<Payload> = {
    process: async (_work, reason) => {
      reasons.push(reason);
      if (reason === "expiry") {
        return {
          kind: "retry",
          retryAtMs: 150,
          errorCode: "ROUND_EXPIRED",
        };
      }
      return { kind: "complete" };
    },
  };
  const sweeper = new ExpiryRetrySweeper(
    store,
    processor,
    { owner: "sweeper", leaseMs: 20, failureRetryMs: 10 },
    clock,
  );

  clock.set(99);
  assert.deepEqual(await sweeper.runOnce(5), {
    claimed: 0,
    completed: 0,
    retried: 0,
    dead: 0,
  });
  clock.set(100);
  assert.deepEqual(await sweeper.runOnce(5), {
    claimed: 1,
    completed: 0,
    retried: 1,
    dead: 0,
  });
  assert.equal((await store.get("order-round-1"))?.expiryHandled, true);

  clock.set(150);
  assert.deepEqual(await sweeper.runOnce(5), {
    claimed: 1,
    completed: 1,
    retried: 0,
    dead: 0,
  });
  assert.deepEqual(reasons, ["expiry", "retry"]);
  assert.equal((await store.get("order-round-1"))?.status, "completed");
});

test("processor failures use bounded retries and then dead-letter", async () => {
  const clock = new ManualClock(0);
  const store = new InMemoryScheduledWorkStore<Payload>(
    clock,
    () => `lease-${clock.nowMs()}`,
  );
  await store.schedule({
    id: "retry-work",
    payload: { orderId: "order-2" },
    expiresAtMs: null,
    retryAtMs: 0,
    maxAttempts: 2,
  });
  const processor: SweepProcessor<Payload> = {
    process: async () => {
      throw new Error("sanitized by sweeper");
    },
  };
  const sweeper = new ExpiryRetrySweeper(
    store,
    processor,
    { owner: "sweeper", leaseMs: 5, failureRetryMs: 10 },
    clock,
  );

  assert.equal((await sweeper.runOnce(1)).retried, 1);
  assert.equal((await store.get("retry-work"))?.lastErrorCode, "PROCESSOR_FAILED");
  clock.set(10);
  assert.deepEqual(await sweeper.runOnce(1), {
    claimed: 1,
    completed: 0,
    retried: 0,
    dead: 1,
  });
  assert.equal((await store.get("retry-work"))?.status, "dead");
});
