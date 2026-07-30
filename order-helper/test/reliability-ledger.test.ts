import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../src/canonical/canonical-json";
import {
  CandidateEvaluationRecord,
  DecisionBundle,
  DecisionLedgerConflictError,
  DecisionPayloadIntegrityError,
  DecisionStateEvent,
  InMemoryDecisionLedger,
  SHADOW_DECISION_CAPABILITY,
  SHADOW_DECISION_SCHEMA,
} from "../src/persistence/decision-ledger";
import {
  decodeReplayFixture,
  stringifyTaggedJson,
} from "../src/replay/fixture-codec";
import { buildUnapprovedReplayFixture } from "../src/replay/unapproved-fixture";
import { selectOrder } from "../src/selection";
import { hashCanonicalPayloadText } from "../src/selection/canonical";

const OPAQUE_PAYLOAD = canonicalJson({
  schema: SHADOW_DECISION_SCHEMA,
  capability: SHADOW_DECISION_CAPABILITY,
});
const OPAQUE_DECISION_ID = hashCanonicalPayloadText(OPAQUE_PAYLOAD);

const verifyPayload = (
  canonicalPayload: string,
  decisionId: `0x${string}`,
): boolean =>
  hashCanonicalPayloadText(canonicalPayload).toLowerCase() ===
  decisionId.toLowerCase();

test("decision ledger is hash-bound, idempotent, and collision-safe", async () => {
  const ledger = new InMemoryDecisionLedger(verifyPayload);
  const bundle = await decisionBundle();
  const collision = await decisionBundle(2n);
  const first = await ledger.appendDecision(bundle);
  const duplicate = await ledger.appendDecision(bundle);
  const mixedCaseDuplicate = await ledger.appendDecision({
    decision: {
      ...bundle.decision,
      decisionId: mixedCaseHex(bundle.decision.decisionId),
      diamondAddress: mixedCaseHex(bundle.decision.diamondAddress),
      orderId: mixedCaseHex(bundle.decision.orderId),
      snapshotBlockHash: mixedCaseHex(bundle.decision.snapshotBlockHash),
      policyHash: mixedCaseHex(bundle.decision.policyHash),
      witnessContentId: mixedCaseHex(bundle.decision.witnessContentId),
    },
    evaluations: bundle.evaluations.map((evaluation) => ({
      ...evaluation,
      decisionId: mixedCaseHex(evaluation.decisionId),
      merchant: mixedCaseHex(evaluation.merchant),
      channelId: evaluation.channelId === null
        ? null
        : mixedCaseHex(evaluation.channelId),
    })),
  });

  assert.equal(first.inserted, true);
  assert.equal(duplicate.inserted, false);
  assert.equal(mixedCaseDuplicate.inserted, false);
  assert.equal(
    mixedCaseDuplicate.value.decision.decisionId,
    bundle.decision.decisionId.toLowerCase(),
  );
  assert.equal(duplicate.value.currentState, "computed");
  assert.equal(
    duplicate.value.evaluations.length,
    bundle.evaluations.length,
  );
  assert.deepEqual(
    await ledger.getByOrderRound(
      bundle.decision.chainId,
      bundle.decision.orderId,
      bundle.decision.round,
    ),
    duplicate.value,
  );

  await assert.rejects(
    ledger.appendDecision({
      ...bundle,
      decision: {
        ...bundle.decision,
        canonicalPayload: collision.decision.canonicalPayload,
      },
    }),
    DecisionPayloadIntegrityError,
  );

  await assert.rejects(
    ledger.appendDecision(collision),
    DecisionLedgerConflictError,
  );
});

test("generic decision evidence binds its exact schema and metadata", async () => {
  const base = await decisionBundle();
  const mismatched: readonly DecisionBundle[] = [
    { ...base, decision: { ...base.decision, chainId: 1 } },
    {
      ...base,
      decision: {
        ...base.decision,
        diamondAddress: `0x${"51".repeat(20)}`,
      },
    },
    {
      ...base,
      decision: { ...base.decision, orderId: repeatedBytes32(0xb0) },
    },
    { ...base, decision: { ...base.decision, round: 2n } },
    {
      decision: { ...base.decision, snapshotBlock: 101n },
      evaluations: base.evaluations.map((evaluation) => ({
        ...evaluation,
        checkedAtBlock: 101n,
      })),
    },
    {
      ...base,
      decision: {
        ...base.decision,
        snapshotBlockHash: repeatedBytes32(0xb1),
      },
    },
    {
      ...base,
      decision: { ...base.decision, policyHash: repeatedBytes32(0xb2) },
    },
  ];
  for (const bundle of mismatched) {
    await assert.rejects(
      () => new InMemoryDecisionLedger(verifyPayload).appendDecision(bundle),
      DecisionPayloadIntegrityError,
    );
  }

  await assert.rejects(
    () =>
      new InMemoryDecisionLedger(verifyPayload).appendDecision(
        replaceDecisionPayload(base, OPAQUE_PAYLOAD, OPAQUE_DECISION_ID),
      ),
    DecisionPayloadIntegrityError,
  );

  const withUnknown = JSON.parse(base.decision.canonicalPayload) as Record<string, unknown>;
  withUnknown.executableAdapter = true;
  const unknownPayload = canonicalJson(withUnknown);
  await assert.rejects(
    () =>
      new InMemoryDecisionLedger(verifyPayload).appendDecision(
        replaceDecisionPayload(
          base,
          unknownPayload,
          hashCanonicalPayloadText(unknownPayload),
        ),
      ),
    DecisionPayloadIntegrityError,
  );
});

test("candidate checks are pinned to the decision snapshot", async () => {
  const ledger = new InMemoryDecisionLedger(verifyPayload);
  const bundle = await decisionBundle();
  await assert.rejects(
    ledger.appendDecision({
      ...bundle,
      evaluations: bundle.evaluations.map((evaluation) => ({
        ...evaluation,
        checkedAtBlock: 99n,
      })),
    }),
    /snapshot block/,
  );
});

test("candidate evaluations exactly project canonical witness prestates", async () => {
  const bundle = await decisionBundle();
  const first = bundle.evaluations[0];
  const second = bundle.evaluations[1];
  assert.ok(first !== undefined);
  assert.ok(second !== undefined);
  const reordered = [...bundle.evaluations];
  reordered[0] = { ...second, ordinal: 0 };
  reordered[1] = { ...first, ordinal: 1 };
  const cases: readonly DecisionBundle[] = [
    {
      ...bundle,
      evaluations: bundle.evaluations.slice(1).map(
        (evaluation, ordinal) => ({ ...evaluation, ordinal }),
      ),
    },
    { ...bundle, evaluations: reordered },
    {
      ...bundle,
      evaluations: bundle.evaluations.map((evaluation, index) =>
        index === 0
          ? { ...evaluation, merchant: `0x${"51".repeat(20)}` }
          : evaluation
      ),
    },
    {
      ...bundle,
      evaluations: bundle.evaluations.map((evaluation, index) =>
        index === 0
          ? { ...evaluation, channelId: repeatedBytes32(0x52) }
          : evaluation
      ),
    },
    {
      ...bundle,
      evaluations: bundle.evaluations.map((evaluation, index) =>
        index === 0
          ? { ...evaluation, eligibilityCode: "ORDER_NOT_OPEN" }
          : evaluation
      ),
    },
    {
      ...bundle,
      evaluations: bundle.evaluations.map((evaluation, index) =>
        index === 0
          ? { ...evaluation, required: evaluation.required + 1n }
          : evaluation
      ),
    },
    {
      ...bundle,
      evaluations: bundle.evaluations.map((evaluation, index) =>
        index === 0
          ? { ...evaluation, available: evaluation.available + 1n }
          : evaluation
      ),
    },
    {
      ...bundle,
      evaluations: bundle.evaluations.map((evaluation, index) =>
        index === 0
          ? {
              ...evaluation,
              source: evaluation.source === "snapshot"
                ? "contract"
                : "snapshot",
            }
          : evaluation
      ),
    },
  ];
  for (const candidate of cases) {
    await assert.rejects(
      () => new InMemoryDecisionLedger(verifyPayload).appendDecision(candidate),
      DecisionLedgerConflictError,
    );
  }
});

test("state history is append-only, chronological, and shadow-only", async () => {
  const ledger = new InMemoryDecisionLedger(verifyPayload);
  const bundle = await decisionBundle();
  await ledger.appendDecision(bundle);
  const simulated: DecisionStateEvent = {
    eventId: repeatedBytes32(0xc0),
    decisionId: bundle.decision.decisionId,
    fromState: "computed",
    toState: "simulated",
    occurredAtMs: 2_000,
    reasonCode: "READ_ONLY_SIMULATION",
    transactionAttemptId: repeatedBytes32(0xca),
  };

  assert.equal((await ledger.appendStateEvent(simulated)).inserted, true);
  assert.equal(
    (await ledger.appendStateEvent({
      ...simulated,
      eventId: mixedCaseHex(simulated.eventId),
      decisionId: mixedCaseHex(simulated.decisionId),
      transactionAttemptId: simulated.transactionAttemptId === null
        ? null
        : mixedCaseHex(simulated.transactionAttemptId),
    })).inserted,
    false,
  );
  await assert.rejects(
    ledger.appendStateEvent({
      ...simulated,
      eventId: repeatedBytes32(0xc1),
      fromState: "simulated",
      toState: "shadowed",
      occurredAtMs: 1_999,
    }),
    /predates the decision history/,
  );
  await assert.rejects(
    ledger.appendStateEvent({
      ...simulated,
      eventId: repeatedBytes32(0xc2),
      fromState: "simulated",
      toState: "simulation-failed",
      occurredAtMs: 2_001,
    }),
    /not allowed/,
  );

  const shadowed = await ledger.appendStateEvent({
    ...simulated,
    eventId: repeatedBytes32(0xc3),
    fromState: "simulated",
    toState: "shadowed",
    occurredAtMs: 2_001,
    reasonCode: "SHADOW_MODE",
  });
  assert.equal(shadowed.inserted, true);
  assert.equal((await ledger.getById(bundle.decision.decisionId))?.currentState, "shadowed");

  await assert.rejects(
    ledger.appendStateEvent({
      ...simulated,
      occurredAtMs: 2_002,
    }),
    DecisionLedgerConflictError,
  );

  await assert.rejects(
    ledger.appendStateEvent({
      ...simulated,
      eventId: repeatedBytes32(0xc4),
      reasonCode: "plaintext user identity" as DecisionStateEvent["reasonCode"],
    }),
    /privacy-safe code/,
  );
});


async function decisionBundle(
  sequenceOverride?: bigint,
): Promise<DecisionBundle> {
  const fixture = await buildUnapprovedReplayFixture();
  const authoritativeResults = fixture.authoritativeResults.map((entry) => ({
    ...entry,
    result: entry.result.code === "ELIGIBLE"
      ? {
          ...entry.result,
          required: fixture.input.order.usdcAmount * 2n,
        }
      : entry.result,
  }));
  const decoded = decodeReplayFixture(stringifyTaggedJson({
    ...fixture,
    authoritativeResults,
    expectedTraceId: undefined,
  }));
  const input = sequenceOverride === undefined
    ? decoded.input
    : { ...decoded.input, sequence: sequenceOverride };
  const selection = await selectOrder(input);
  assert.equal(selection.trace.serviceStatus, "SHADOW_DECISION");
  assert.ok(selection.trace.envelope !== null);
  assert.ok("decisionId" in selection.outcome);
  const decisionId = selection.outcome.decisionId;
  return {
    decision: {
      schema: SHADOW_DECISION_SCHEMA,
      capability: SHADOW_DECISION_CAPABILITY,
      decisionId,
      chainId: input.order.chainId,
      diamondAddress: input.order.diamond,
      orderId: input.order.orderId,
      round: input.order.round,
      snapshotBlock: input.order.snapshotBlock,
      snapshotBlockHash: input.order.snapshotBlockHash,
      policyHash: input.policy.policyHash,
      witnessContentId: selection.trace.witnessContentId,
      canonicalWitness: selection.trace.canonicalWitness,
      helperBuildVersion: input.helperBuildVersion,
      canonicalPayload: selection.trace.canonicalPayload,
      initialState: "computed",
      createdAtMs: 1_000,
    },
    evaluations: evaluationsFromWitness(
      selection.trace.canonicalWitness,
      decisionId,
    ),
  };
}

function evaluationsFromWitness(
  source: string,
  decisionId: `0x${string}`,
): readonly CandidateEvaluationRecord[] {
  const witness = requireTestRecord(
    JSON.parse(source) as unknown,
    "canonicalWitness",
  );
  const prestates = witness.eligibilityPrestates;
  assert.ok(Array.isArray(prestates));
  return prestates.map((value, ordinal) => {
    const prestate = requireTestRecord(
      value,
      `canonicalWitness.eligibilityPrestates[${ordinal}]`,
    );
    assert.equal(typeof prestate.merchant, "string");
    assert.ok(
      prestate.channelId === null || typeof prestate.channelId === "string",
    );
    assert.equal(typeof prestate.eligibilityCode, "string");
    assert.equal(typeof prestate.required, "string");
    assert.equal(typeof prestate.available, "string");
    assert.ok(prestate.source === "snapshot" || prestate.source === "contract");
    assert.equal(typeof prestate.checkedAtBlock, "string");
    const required = prestate.required as string;
    const available = prestate.available as string;
    const checkedAtBlock = prestate.checkedAtBlock as string;
    return {
      decisionId,
      ordinal,
      merchant: prestate.merchant as `0x${string}`,
      channelId: prestate.channelId as `0x${string}` | null,
      eligibilityCode:
        prestate.eligibilityCode as CandidateEvaluationRecord["eligibilityCode"],
      required: BigInt(required),
      available: BigInt(available),
      source: prestate.source,
      checkedAtBlock: BigInt(checkedAtBlock),
    };
  });
}

function replaceDecisionPayload(
  bundle: DecisionBundle,
  canonicalPayload: string,
  decisionId: `0x${string}`,
): DecisionBundle {
  return {
    decision: { ...bundle.decision, decisionId, canonicalPayload },
    evaluations: bundle.evaluations.map((evaluation) => ({
      ...evaluation,
      decisionId,
    })),
  };
}

function requireTestRecord(
  value: unknown,
  name: string,
): Record<string, unknown> {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${name} must be an object`,
  );
  return value as Record<string, unknown>;
}

function repeatedBytes32(byte: number): `0x${string}` {
  return `0x${byte.toString(16).padStart(2, "0").repeat(32)}`;
}

function mixedCaseHex<T extends `0x${string}`>(value: T): T {
  return `0x${value.slice(2).toUpperCase()}` as T;
}
