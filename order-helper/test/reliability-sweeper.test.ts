import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "../src/reliability/clock";
import {
  type DurableWorkPayload,
  ExpiryRetrySweeper,
  InMemoryScheduledWorkStore,
  SweepLeaseError,
  SweepProcessor,
  SweepReason,
} from "../src/reliability/expiry-retry-sweeper";

const EXPIRY_WORK_ID = `0x${"71".repeat(32)}` as const;
const RETRY_WORK_ID = `0x${"72".repeat(32)}` as const;
const ISOLATED_WORK_ID = `0x${"73".repeat(32)}` as const;
const SUBJECT_ID = `0x${"81".repeat(32)}` as const;
const CONTEXT_ID = `0x${"82".repeat(32)}` as const;
const ALTERNATE_CONTEXT_ID = `0x${"83".repeat(32)}` as const;
const SWEEPER_OWNER = `0x${"91".repeat(32)}` as const;
const WORKER_OWNER = `0x${"92".repeat(32)}` as const;
const SWEEP_TOKEN = `0x${"a1".repeat(32)}` as const;

type MutableDurableWorkPayload = {
  -readonly [Key in keyof DurableWorkPayload]: DurableWorkPayload[Key];
};

function durablePayload(
  kind: DurableWorkPayload["kind"],
  contextId: DurableWorkPayload["contextId"] = CONTEXT_ID,
): MutableDurableWorkPayload {
  return {
    schema: "order-helper.durable-work.v1",
    kind,
    subjectId: SUBJECT_ID,
    contextId,
  };
}

test("sweeper distinguishes one-time expiry handling from later retries", async () => {
  const clock = new ManualClock(0);
  const store = new InMemoryScheduledWorkStore<DurableWorkPayload>(
    clock,
    () => SWEEP_TOKEN,
  );
  await store.schedule({
    id: EXPIRY_WORK_ID,
    payload: durablePayload("order-expiry"),
    expiresAtMs: 100,
    retryAtMs: null,
    maxAttempts: 4,
  });
  const reasons: SweepReason[] = [];
  const processor: SweepProcessor<DurableWorkPayload> = {
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
    { owner: SWEEPER_OWNER, leaseMs: 20, failureRetryMs: 10 },
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
  assert.equal((await store.get(EXPIRY_WORK_ID))?.expiryHandled, true);

  clock.set(150);
  assert.deepEqual(await sweeper.runOnce(5), {
    claimed: 1,
    completed: 1,
    retried: 0,
    dead: 0,
  });
  assert.deepEqual(reasons, ["expiry", "retry"]);
  assert.equal((await store.get(EXPIRY_WORK_ID))?.status, "completed");
});

test("processor failures use bounded retries and then dead-letter", async () => {
  const clock = new ManualClock(0);
  const store = new InMemoryScheduledWorkStore<DurableWorkPayload>(
    clock,
    () => SWEEP_TOKEN,
  );
  await store.schedule({
    id: RETRY_WORK_ID,
    payload: durablePayload("transaction-reconciliation", null),
    expiresAtMs: null,
    retryAtMs: 0,
    maxAttempts: 2,
  });
  const processor: SweepProcessor<DurableWorkPayload> = {
    process: async () => {
      throw new Error("sanitized by sweeper");
    },
  };
  const sweeper = new ExpiryRetrySweeper(
    store,
    processor,
    { owner: SWEEPER_OWNER, leaseMs: 5, failureRetryMs: 10 },
    clock,
  );

  assert.equal((await sweeper.runOnce(1)).retried, 1);
  assert.equal(
    (await store.get(RETRY_WORK_ID))?.lastErrorCode,
    "PROCESSOR_FAILED",
  );
  clock.set(10);
  assert.deepEqual(await sweeper.runOnce(1), {
    claimed: 1,
    completed: 0,
    retried: 0,
    dead: 1,
  });
  assert.equal((await store.get(RETRY_WORK_ID))?.status, "dead");
});

test("sweeper isolates reference payloads and fences reused lease tokens", async () => {
  const clock = new ManualClock(0);
  const store =
    new InMemoryScheduledWorkStore<MutableDurableWorkPayload>(
      clock,
      () => SWEEP_TOKEN,
    );
  const payload = durablePayload("order-evaluation");
  const scheduled = await store.schedule({
    id: ISOLATED_WORK_ID,
    payload,
    expiresAtMs: null,
    retryAtMs: 0,
    maxAttempts: 3,
  });

  payload.contextId = ALTERNATE_CONTEXT_ID;
  scheduled.work.payload.contextId = ALTERNATE_CONTEXT_ID;
  assert.equal(
    (await store.get(ISOLATED_WORK_ID))?.payload.contextId,
    CONTEXT_ID,
  );

  const first = await store.claimDue(WORKER_OWNER, 10);
  assert.ok(first);
  first.work.payload.contextId = ALTERNATE_CONTEXT_ID;
  clock.set(10);
  const fallback = await store.claimDue(WORKER_OWNER, 10);
  assert.ok(fallback);
  assert.equal(fallback.token, first.token);
  assert.equal(fallback.generation, first.generation + 1n);
  assert.equal(fallback.work.payload.contextId, CONTEXT_ID);
  await assert.rejects(store.complete(first), SweepLeaseError);
});

test("scheduled work canonicalizes mixed-case identity aliases", async () => {
  const clock = new ManualClock(0);
  const store = new InMemoryScheduledWorkStore<DurableWorkPayload>(
    clock,
    () => mixedCaseHex(SWEEP_TOKEN),
  );
  const id = `0x${"ab".repeat(32)}` as const;
  const subjectId = `0x${"cd".repeat(32)}` as const;
  const contextId = `0x${"ef".repeat(32)}` as const;
  const input = {
    id: mixedCaseHex(id),
    payload: {
      schema: "order-helper.durable-work.v1" as const,
      kind: "order-evaluation" as const,
      subjectId: mixedCaseHex(subjectId),
      contextId: mixedCaseHex(contextId),
    },
    expiresAtMs: null,
    retryAtMs: 0,
    maxAttempts: 2,
  };
  const first = await store.schedule(input);
  const alias = await store.schedule({
    ...input,
    id,
    payload: { ...input.payload, subjectId, contextId },
  });

  assert.equal(first.inserted, true);
  assert.equal(alias.inserted, false);
  assert.equal(alias.work.id, id);
  assert.equal(alias.work.payload.subjectId, subjectId);
  assert.equal(alias.work.payload.contextId, contextId);
  assert.deepEqual(await store.get(mixedCaseHex(id)), alias.work);

  const lease = await store.claimDue(mixedCaseHex(WORKER_OWNER), 10);
  assert.ok(lease !== null);
  assert.equal(lease.owner, WORKER_OWNER);
  assert.equal(lease.token, SWEEP_TOKEN);
});

function mixedCaseHex<T extends `0x${string}`>(value: T): T {
  return `0x${value.slice(2).toUpperCase()}` as T;
}
