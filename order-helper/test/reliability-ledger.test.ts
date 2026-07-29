import assert from "node:assert/strict";
import test from "node:test";
import {
  DecisionBundle,
  DecisionLedgerConflictError,
  DecisionStateEvent,
  InMemoryDecisionLedger,
} from "../src/persistence/decision-ledger";

const DECISION_ID = `0x${"10".repeat(32)}` as const;
const ORDER_ID = `0x${"20".repeat(32)}` as const;
const BLOCK_HASH = `0x${"30".repeat(32)}` as const;
const POLICY_HASH = `0x${"40".repeat(32)}` as const;
const DIAMOND = `0x${"50".repeat(20)}` as const;
const MERCHANT = `0x${"60".repeat(20)}` as const;
const CHANNEL = `0x${"70".repeat(32)}` as const;

test("decision ledger is idempotent and rejects identity collisions", async () => {
  const ledger = new InMemoryDecisionLedger();
  const bundle = decisionBundle();
  const first = await ledger.appendDecision(bundle);
  const duplicate = await ledger.appendDecision(bundle);

  assert.equal(first.inserted, true);
  assert.equal(duplicate.inserted, false);
  assert.equal(duplicate.value.currentState, "computed");
  assert.equal(duplicate.value.evaluations.length, 1);
  assert.deepEqual(
    await ledger.getByOrderRound(84_532, ORDER_ID, 1n),
    duplicate.value,
  );

  await assert.rejects(
    ledger.appendDecision({
      ...bundle,
      decision: {
        ...bundle.decision,
        canonicalPayload: '{"changed":true}',
      },
    }),
    DecisionLedgerConflictError,
  );

  const differentId = `0x${"99".repeat(32)}` as const;
  await assert.rejects(
    ledger.appendDecision({
      ...bundle,
      decision: { ...bundle.decision, decisionId: differentId },
      evaluations: bundle.evaluations.map((evaluation) => ({
        ...evaluation,
        decisionId: differentId,
      })),
    }),
    DecisionLedgerConflictError,
  );
});

test("state changes are append-only, fenced, and replay-safe", async () => {
  const ledger = new InMemoryDecisionLedger();
  await ledger.appendDecision(decisionBundle());
  const shadowed: DecisionStateEvent = {
    eventId: "event-shadowed",
    decisionId: DECISION_ID,
    fromState: "computed",
    toState: "shadowed",
    occurredAtMs: 2_000,
    reasonCode: "SHADOW_MODE",
    transactionAttemptId: null,
    metadataJson: "{}",
  };

  assert.equal((await ledger.appendStateEvent(shadowed)).inserted, true);
  assert.equal((await ledger.appendStateEvent(shadowed)).inserted, false);
  assert.equal((await ledger.getById(DECISION_ID))?.currentState, "shadowed");

  await assert.rejects(
    ledger.appendStateEvent({
      ...shadowed,
      eventId: "bad-transition",
      toState: "submitted",
    }),
    /is shadowed, not computed/,
  );
  await assert.rejects(
    ledger.appendStateEvent({
      ...shadowed,
      reasonCode: "COLLIDING_EVENT",
    }),
    DecisionLedgerConflictError,
  );
});

function decisionBundle(): DecisionBundle {
  return {
    decision: {
      decisionId: DECISION_ID,
      chainId: 84_532,
      diamondAddress: DIAMOND,
      orderId: ORDER_ID,
      round: 1n,
      snapshotBlock: 100n,
      snapshotBlockHash: BLOCK_HASH,
      policyHash: POLICY_HASH,
      helperBuildVersion: "test-build",
      canonicalPayload: '{"schema":"test"}',
      initialState: "computed",
      createdAtMs: 1_000,
    },
    evaluations: [
      {
        decisionId: DECISION_ID,
        ordinal: 0,
        merchant: MERCHANT,
        channelId: CHANNEL,
        eligibilityCode: "ELIGIBLE",
        required: 10n,
        available: 20n,
        source: "contract",
        detail: null,
      },
    ],
  };
}
