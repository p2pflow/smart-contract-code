import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthoritativeEligibilityAdapter,
  Bytes32,
  EligibilityResult,
  RoutingDomain,
} from "../src/domain/types";
import {
  acceptanceReceipt,
  acceptanceSemanticKey,
  applyCanonicalAcceptance,
  emptyAcceptanceLedger,
  operatorAcceptedState,
} from "../src/selection/acceptance-ledger";
import {
  verifyCanonicalPayloadText,
} from "../src/selection/canonical";
import {
  highestUnlockedRankAt,
  isRankEligibleAt,
  TimingRunwayError,
} from "../src/selection/leases";
import {
  buySafetyBuffer,
} from "../src/selection/math";
import {
  emptyOfferBook,
  liveOfferTotalUsdc,
  openOffer,
  offerSemanticKey,
  releaseOffer,
} from "../src/selection/offer-book";
import { selectionPolicyHash } from "../src/selection/policy-witness";
import { selectOrder } from "../src/selection/selector";
import {
  OpenOfferSlot,
  SelectionHistoryEvent,
  SelectionInput,
} from "../src/selection/types";
import {
  FixtureOperatorState,
  SimulationFixtureConfig,
  buildSimulationSelectionInput,
  fixtureAddress,
  fixtureBytes32,
} from "../src/simulator/fixture";
import {
  explicitUnapprovedSimulationFixture,
} from "../src/simulator/unapproved-fixture";

const USDC = 1_000_000n;

const offlineEligibility: AuthoritativeEligibilityAdapter = {
  async check(request) {
    return {
      code: "ELIGIBLE",
      required: request.minimumRequired,
      available: request.minimumRequired,
      source: "snapshot",
      checkedAtBlock: request.order.snapshotBlock,
    };
  },
};

test("accepted service is additive, rebased, monotone, and idempotent", () => {
  const domain = {
    chainId: 84_532,
    fiatCurrency: "INR",
    paymentRailGroup: "FIXTURE_RAIL",
    orderSide: "BUY" as const,
  };
  const epoch = fixtureBytes32("acceptance-vector-epoch");
  const operatorId = fixtureBytes32("acceptance-vector-operator");
  const base = emptyAcceptanceLedger(domain, epoch);
  const acceptanceA = acceptance(
    "A",
    operatorId,
    epoch,
    domain,
    10n * USDC,
  );
  const acceptanceB = acceptance(
    "B",
    operatorId,
    epoch,
    domain,
    12n * USDC,
  );

  const afterB = applyCanonicalAcceptance(base, acceptanceB);
  const bThenA = applyCanonicalAcceptance(afterB.state, acceptanceA);
  const afterA = applyCanonicalAcceptance(base, acceptanceA);
  const aThenB = applyCanonicalAcceptance(afterA.state, acceptanceB);
  const duplicate = applyCanonicalAcceptance(bThenA.state, acceptanceA);
  const finalBA = operatorAcceptedState(bThenA.state, operatorId);
  const finalAB = operatorAcceptedState(aThenB.state, operatorId);

  assert.equal(afterB.applied, true);
  assert.equal(
    operatorAcceptedState(afterB.state, operatorId)?.virtualFinishQ,
    48n * USDC,
  );
  assert.deepEqual(finalBA, finalAB);
  assert.equal(finalBA?.acceptedUsdc, 22n * USDC);
  assert.equal(finalBA?.virtualFinishQ, 88n * USDC);
  assert.equal(duplicate.applied, false);
  assert.strictEqual(duplicate.state, bThenA.state);

  const literalForecastA = 40n * USDC;
  const currentAfterB = 48n * USDC;
  assert.ok(literalForecastA < currentAfterB);
  assert.equal(
    currentAfterB + (4n * 10n * USDC),
    88n * USDC,
  );
});

test("acceptance receipts are bound to the complete routing domain", () => {
  const epoch = fixtureBytes32("cross-domain-acceptance-epoch");
  const operatorId = fixtureBytes32("cross-domain-operator");
  const inrBuy: RoutingDomain = {
    chainId: 84_532,
    fiatCurrency: "INR",
    paymentRailGroup: "FIXTURE_RAIL",
    orderSide: "BUY",
  };
  const receipt = acceptance(
    "cross-domain",
    operatorId,
    epoch,
    inrBuy,
    10n * USDC,
  );
  const applied = applyCanonicalAcceptance(
    emptyAcceptanceLedger(inrBuy, epoch),
    receipt,
  );
  assert.equal(applied.applied, true);

  const usdSell: RoutingDomain = {
    ...inrBuy,
    fiatCurrency: "USD",
    paymentRailGroup: "ACH",
    orderSide: "SELL",
  };
  assert.throws(
    () =>
      applyCanonicalAcceptance(
        emptyAcceptanceLedger(usdSell, epoch),
        receipt,
      ),
    /routing domain mismatch/i,
  );
  assert.throws(
    () =>
      applyCanonicalAcceptance(
        emptyAcceptanceLedger({ ...inrBuy, chainId: 1 }, epoch),
        receipt,
      ),
    /routing domain mismatch/i,
  );

  const fetched = acceptanceReceipt(applied.state, receipt.acceptanceId);
  assert.ok(fetched !== null);
  if (fetched === null) return;
  (fetched.domain as { fiatCurrency: string }).fiatCurrency = "USD";
  assert.equal(
    acceptanceReceipt(applied.state, receipt.acceptanceId)?.domain.fiatCurrency,
    "INR",
  );
});

test("acceptance semantic identity deduplicates aliases and rejects conflicts", () => {
  const domain: RoutingDomain = {
    chainId: 84_532,
    fiatCurrency: "INR",
    paymentRailGroup: "FIXTURE_RAIL",
    orderSide: "BUY",
  };
  const epoch = fixtureBytes32("semantic-acceptance-epoch");
  const operatorId = fixtureBytes32("semantic-acceptance-operator");
  const receipt = acceptance(
    "semantic-acceptance",
    operatorId,
    epoch,
    domain,
    25n * USDC,
  );
  const first = applyCanonicalAcceptance(
    emptyAcceptanceLedger(domain, epoch),
    receipt,
  );
  const alias = {
    ...receipt,
    acceptanceId: fixtureBytes32("semantic-acceptance-alias"),
  };
  const duplicate = applyCanonicalAcceptance(first.state, alias);
  assert.equal(duplicate.applied, false);
  assert.notStrictEqual(duplicate.state, first.state);
  assert.equal(first.state.receiptCount, 1);
  assert.equal(duplicate.state.receiptCount, 1);
  assert.equal(first.state.aliasIndex, null);
  assert.ok(duplicate.state.aliasIndex !== null);
  assert.deepEqual(
    operatorAcceptedState(duplicate.state, operatorId),
    operatorAcceptedState(first.state, operatorId),
  );
  assert.equal(acceptanceReceipt(first.state, alias.acceptanceId), null);

  assert.equal(
    acceptanceReceipt(duplicate.state, alias.acceptanceId)?.acceptanceId,
    alias.acceptanceId,
  );

  const aliasReplay = applyCanonicalAcceptance(duplicate.state, alias);
  assert.equal(aliasReplay.applied, false);
  assert.strictEqual(aliasReplay.state, duplicate.state);

  assert.throws(
    () =>
      applyCanonicalAcceptance(duplicate.state, {
        ...alias,
        orderId: fixtureBytes32("semantic-alias-reused-order"),
      }),
    /conflicts with its receipt/i,
  );
  assert.throws(
    () =>
      applyCanonicalAcceptance(duplicate.state, {
        ...alias,
        acceptanceId: fixtureBytes32("semantic-acceptance-conflict"),
        usdcAmount: alias.usdcAmount + 1n,
      }),
    /semantic identity conflicts/i,
  );

  const branchReceipt = acceptance(
    "semantic-acceptance-branch",
    operatorId,
    epoch,
    domain,
    5n * USDC,
  );
  const branch = applyCanonicalAcceptance(
    duplicate.state,
    branchReceipt,
  ).state;
  assert.equal(first.state.receiptCount, 1);
  assert.equal(branch.receiptCount, 2);
  assert.equal(duplicate.state.receiptCount, 1);
  assert.equal(acceptanceReceipt(first.state, branchReceipt.acceptanceId), null);
  assert.ok((branch.semanticIndex?.height ?? 0) <= 2);
  assert.strictEqual(branch.aliasIndex, duplicate.state.aliasIndex);

  const otherEpoch = fixtureBytes32("semantic-acceptance-other-epoch");
  const epochReceipt = {
    ...receipt,
    acceptanceId: fixtureBytes32("semantic-acceptance-epoch-id"),
    domainEpoch: otherEpoch,
  };
  assert.notEqual(
    acceptanceSemanticKey(receipt),
    acceptanceSemanticKey(epochReceipt),
  );
  assert.equal(
    applyCanonicalAcceptance(
      emptyAcceptanceLedger(domain, otherEpoch),
      epochReceipt,
    ).applied,
    true,
  );
  const usdDomain = { ...domain, fiatCurrency: "USD" };
  const usdReceipt = {
    ...receipt,
    acceptanceId: fixtureBytes32("semantic-acceptance-domain-id"),
    domain: usdDomain,
  };
  assert.notEqual(
    acceptanceSemanticKey(receipt),
    acceptanceSemanticKey(usdReceipt),
  );
  assert.equal(
    applyCanonicalAcceptance(
      emptyAcceptanceLedger(usdDomain, epoch),
      usdReceipt,
    ).applied,
    true,
  );

  const mixedCaseAlias = {
    ...receipt,
    acceptanceId: fixtureBytes32("semantic-acceptance-case-alias"),
    orderId: mixedCaseHex(receipt.orderId),
    operatorId: mixedCaseHex(receipt.operatorId),
    domainEpoch: mixedCaseHex(receipt.domainEpoch),
    acceptedAtBlockHash: mixedCaseHex(receipt.acceptedAtBlockHash),
  };
  const mixedDuplicate = applyCanonicalAcceptance(
    first.state,
    mixedCaseAlias,
  );
  assert.equal(mixedDuplicate.applied, false);
  assert.equal(mixedDuplicate.state.receiptCount, 1);
  assert.equal(
    acceptanceReceipt(
      mixedDuplicate.state,
      mixedCaseAlias.acceptanceId,
    )?.orderId,
    receipt.orderId.toLowerCase(),
  );
  assert.throws(
    () =>
      applyCanonicalAcceptance(first.state, {
        ...mixedCaseAlias,
        acceptanceId: fixtureBytes32(
          "semantic-acceptance-case-conflict",
        ),
        usdcAmount: receipt.usdcAmount + 1n,
      }),
    /semantic identity conflicts/i,
  );
});

test("selector rejects every chain and Diamond identity outside its target", async () => {
  const input = fixtureInput(5, 1, 1n);
  await assert.rejects(
    () =>
      selectOrder({
        ...input,
        order: {
          ...input.order,
          chainId: 84_533,
          domain: { ...input.order.domain, chainId: 84_533 },
        },
      }),
    /Base Sepolia chain 84532/i,
  );
  await assert.rejects(
    () =>
      selectOrder({
        ...input,
        order: {
          ...input.order,
          domain: { ...input.order.domain, chainId: 1 },
        },
      }),
    /Routing domain\/order mismatch/i,
  );
  await assert.rejects(
    () =>
      selectOrder({
        ...input,
        order: {
          ...input.order,
          diamond: fixtureAddress(123_456),
        },
      }),
    /Base Sepolia Diamond/i,
  );
  await assert.rejects(
    () =>
      selectOrder({
        ...input,
        order: {
          ...input.order,
          diamond: "0x1234",
        },
      }),
    /Base Sepolia Diamond/i,
  );
});

test("policy hash and canonical witness bind every policy field", async () => {
  const input = fixtureInput(5, 1, 2n);
  assert.equal(
    input.policy.policyHash,
    selectionPolicyHash(input.policy, input.shadowPolicy),
  );
  await assert.rejects(
    () =>
      selectOrder({
        ...input,
        policy: { ...input.policy, version: "tampered-policy-version-2" },
      }),
    /Policy hash does not match/i,
  );

  const shadowPolicy = {
    ...input.shadowPolicy,
    readinessReserveF: 0,
  };
  await assert.rejects(
    () => selectOrder({ ...input, shadowPolicy }),
    /Policy hash does not match/i,
  );
  const recomputed = await selectOrder({
    ...input,
    policy: {
      ...input.policy,
      policyHash: selectionPolicyHash(input.policy, shadowPolicy),
    },
    shadowPolicy,
  });
  assert.ok(!("status" in recomputed.outcome));
  assert.ok(
    verifyCanonicalPayloadText(
      recomputed.trace.canonicalWitness,
      recomputed.trace.witnessContentId,
    ),
  );
  assert.match(recomputed.trace.canonicalWitness, /"councilVerdict":"REJECT"/);
  const payload = JSON.parse(recomputed.trace.canonicalPayload) as Record<
    string,
    unknown
  >;
  assert.equal(payload.witnessContentId, recomputed.trace.witnessContentId);
});

test("selector rejects malformed authoritative ELIGIBLE evidence", async () => {
  const input = fixtureInput(5, 1, 1n);
  const localRequired =
    input.order.usdcAmount + buySafetyBuffer(
      input.order.usdcAmount,
      input.policy,
    );
  const malformed = [
    {
      required: 0n,
      available: 0n,
      checkedAtBlock: input.order.snapshotBlock,
    },
    {
      required: localRequired,
      available: localRequired - 1n,
      checkedAtBlock: input.order.snapshotBlock,
    },
    {
      required: input.order.usdcAmount,
      available: localRequired,
      checkedAtBlock: input.order.snapshotBlock,
    },
  ] as const;
  for (const evidence of malformed) {
    const result = await selectOrder({
      ...input,
      authoritativeEligibility: {
        async check() {
          return {
            code: "ELIGIBLE",
            source: "snapshot",
            ...evidence,
          };
        },
      },
    });
    assert.ok("status" in result.outcome);
    assert.equal(result.trace.noServiceReason, "NO_FOUR_ELIGIBLE_OPERATORS");
    assert.ok(
      result.outcome.excluded.every(
        (entry) =>
          entry.result.code === "AUTHORITATIVE_CHECK_UNAVAILABLE",
      ),
    );
  }

  const wrongBlock = await selectOrder({
    ...input,
    authoritativeEligibility: {
      async check(request) {
        return {
          code: "ELIGIBLE",
          required: request.minimumRequired,
          available: request.minimumRequired,
          source: "contract",
          checkedAtBlock: request.order.snapshotBlock + 1n,
        };
      },
    },
  });
  assert.ok("status" in wrongBlock.outcome);
  assert.ok(
    wrongBlock.outcome.excluded.every(
      (entry) => entry.result.code === "SNAPSHOT_BLOCK_MISMATCH",
    ),
  );

  const wrongSource = await selectOrder({
    ...input,
    authoritativeEligibility: {
      async check(request) {
        return {
          code: "ELIGIBLE",
          required: request.minimumRequired,
          available: request.minimumRequired,
          source: "subgraph",
          checkedAtBlock: request.order.snapshotBlock,
        } as unknown as EligibilityResult;
      },
    },
  });
  assert.ok("status" in wrongSource.outcome);
  assert.ok(
    wrongSource.outcome.excluded.every(
      (entry) =>
        entry.result.code === "AUTHORITATIVE_CHECK_UNAVAILABLE",
    ),
  );
});

test("canonical candidate and channel permutations produce one v2 digest", async () => {
  const input = fixtureInput(5, 1, 7n);
  const permuted: SelectionInput = {
    ...input,
    candidates: [...input.candidates]
      .reverse()
      .map((candidate) => ({
        ...candidate,
        channels: [...candidate.channels].reverse(),
      })),
    operators: [...input.operators].reverse(),
  };

  const left = await selectOrder(input);
  const right = await selectOrder(permuted);
  assert.ok(!("status" in left.outcome));
  assert.ok(!("status" in right.outcome));
  if ("status" in left.outcome || "status" in right.outcome) return;
  assert.equal(left.outcome.decisionId, right.outcome.decisionId);
  assert.deepEqual(left.outcome.candidates, right.outcome.candidates);
  assert.equal(left.trace.canonicalWitness, right.trace.canonicalWitness);
  assert.equal(left.trace.witnessContentId, right.trace.witnessContentId);
  assert.ok(
    verifyCanonicalPayloadText(
      left.trace.canonicalWitness,
      left.trace.witnessContentId,
    ),
  );
  assert.equal(left.trace.universeCount, 10);
  assert.equal(left.trace.actionAuthorization, false);
  assert.equal(left.trace.forecastOnly, true);
  assert.ok(
    verifyCanonicalPayloadText(
      left.trace.canonicalPayload,
      left.outcome.decisionId,
    ),
  );
});

test("identical golden input fixes ranks, roots, and decision digest", async () => {
  const input = fixtureInput(5, 1, 11n);
  const result = await selectOrder(input);
  assert.ok(!("status" in result.outcome));
  if ("status" in result.outcome) return;
  assert.equal(result.outcome.candidates.length, 4);
  assert.deepEqual(
    result.outcome.candidates.map((candidate) => candidate.rank),
    [0, 1, 2, 3],
  );
  assert.equal(
    result.outcome.decisionId,
    "0xf4581c7c76e58d115fd44c3210c115d3e66dda67b4d9a0512b40f40170c0c9c3",
  );
  assert.equal(
    result.trace.witnessContentId,
    "0xaefe30d51c98693892cbb4e0fe729690fda806d38af824e8f0c81b92c9213f04",
  );
  assert.equal(
    input.policy.policyHash,
    "0x23b59e9e68f085862233233a12d8cb82f168e1da16ba5354de93b4b105e8ab4d",
  );
  assert.equal(
    result.trace.universeRoot,
    "0x66598f2b5a714c335c33d7c05b9daff224e2e36aba46dff9b4dfb79a8f95d7d9",
  );
  assert.equal(
    result.trace.eligibilityPrestateRoot,
    "0xcb8801299619b8d12f5c0ae76014b756315b416c1b2d8e5b2e954230cadd43c5",
  );
  assert.equal(
    result.trace.outputRoot,
    "0x185b067b00845648764f75f2b1482540d68f4576413f1b8988b344fae7c57746",
  );
});

test("two, three, four, and four-plus-reserve readiness are explicit", async () => {
  for (const count of [2, 3]) {
    const result = await selectOrder(fixtureInput(count, 0, 1n));
    assert.ok("status" in result.outcome);
    assert.equal(result.trace.noServiceReason, "NO_FOUR_ELIGIBLE_OPERATORS");
    assert.equal(result.trace.actionAuthorization, false);
  }

  const four = await selectOrder(fixtureInput(4, 0, 1n));
  assert.ok(!("status" in four.outcome));

  const fourWithReserve = await selectOrder(fixtureInput(4, 1, 1n));
  assert.ok("status" in fourWithReserve.outcome);
  assert.equal(fourWithReserve.trace.noServiceReason, "READINESS_GATE");
  assert.ok(
    verifyCanonicalPayloadText(
      fourWithReserve.trace.canonicalWitness,
      fourWithReserve.trace.witnessContentId,
    ),
  );
  assert.match(fourWithReserve.trace.canonicalWitness, /"candidates":\[\]/);

  const fiveWithReserve = await selectOrder(fixtureInput(5, 1, 1n));
  assert.ok(!("status" in fiveWithReserve.outcome));
});

test("ineligible snapshots and duplicate universe rows fail closed", async () => {
  const input = fixtureInput(5, 0, 3n);
  const offlineCandidate = input.candidates[0];
  assert.ok(offlineCandidate !== undefined);
  const withOffline: SelectionInput = {
    ...input,
    candidates: input.candidates.map((candidate, index) =>
      index === 0
        ? { ...candidate, availability: "OFFLINE" as const }
        : candidate
    ),
  };
  const result = await selectOrder(withOffline);
  assert.ok(!("status" in result.outcome));
  assert.ok(
    result.outcome.excluded.some(
      (entry) => entry.result.code === "MERCHANT_OFFLINE",
    ),
  );

  const duplicate: SelectionInput = {
    ...input,
    candidates: [...input.candidates, offlineCandidate],
  };
  const original = await selectOrder(input);
  const deduplicated = await selectOrder(duplicate);
  assert.equal(original.trace.traceId, deduplicated.trace.traceId);

  const conflict: SelectionInput = {
    ...duplicate,
    candidates: [
      ...input.candidates,
      { ...offlineCandidate, availability: "OFFLINE" as const },
    ],
  };
  await assert.rejects(() => selectOrder(conflict), /conflicting prestate/);
  await assert.rejects(
    () =>
      selectOrder({
        ...input,
        universe: {
          ...input.universe,
          expectedEntryCount: input.universe.expectedEntryCount - 1,
        },
      }),
    /universe count mismatch/i,
  );
});

test("event-sourced cooldown expands past a nonresponsive quartet", async () => {
  const sequence = 20n;
  const input = fixtureInput(5, 1, sequence, (states) =>
    states.map((state, index) => ({
      ...state,
      virtualFinishQ: index < 4 ? 0n : 1_000n * USDC,
    }))
  );
  const history: SelectionHistoryEvent[] = Array.from(
    { length: 4 },
    (_, index) => ({
      eventId: fixtureBytes32(`miss-event:${index}`),
      operatorId: fixtureBytes32(`operator:${index}`),
      decisionId: fixtureBytes32(`miss-decision:${index}`),
      orderId: fixtureBytes32(`miss-order:${index}`),
      round: 1n,
      sequence: sequence - 1n,
      kind: "RANK_ZERO_MISSED",
    }),
  );
  const result = await selectOrder({ ...input, history });
  assert.ok(!("status" in result.outcome));
  assert.equal(
    result.trace.selectedOperatorIds[0],
    fixtureBytes32("operator:4"),
  );
});

test("operator re-entry clamps to the monotone domain floor", async () => {
  const input = fixtureInput(5, 1, 4n, (states) =>
    states.map((state) => ({ ...state, virtualFinishQ: 0n }))
  );
  const floor = 100n * USDC;
  const result = await selectOrder({ ...input, domainFloorQ: floor });
  assert.ok(!("status" in result.outcome));
  if ("status" in result.outcome) return;
  assert.ok(
    result.outcome.candidates.every(
      (candidate) =>
        candidate.commitFinish ===
        floor + (4n * input.order.usdcAmount),
    ),
  );
});

test("half-open lease seconds and quote runway reject ambiguity", async () => {
  const assignedAt = 0n;
  const validUntil = 90n;
  const expected: readonly (0 | 1 | 2 | 3 | null)[] = [
    null,
    0,
    0,
    1,
    1,
    2,
    2,
    3,
    3,
    null,
  ];
  const seconds = [-1n, 0n, 14n, 15n, 29n, 30n, 44n, 45n, 89n, 90n];
  assert.deepEqual(
    seconds.map((second) =>
      highestUnlockedRankAt(second, assignedAt, validUntil, 15)
    ),
    expected,
  );
  assert.equal(isRankEligibleAt(0, 44n, assignedAt, validUntil, 15), true);
  assert.equal(isRankEligibleAt(3, 44n, assignedAt, validUntil, 15), false);
  assert.equal(isRankEligibleAt(3, 45n, assignedAt, validUntil, 15), true);

  const input = fixtureInput(5, 1, 1n);
  const invalid: SelectionInput = {
    ...input,
    assignedAt: 20n,
    quoteDeadline: 60n,
    order: {
      ...input.order,
      validUntil: 90n,
    },
  };
  await assert.rejects(
    () => selectOrder(invalid),
    TimingRunwayError,
  );
});

test("offer exposure is exact, reversible once, and not collateral", () => {
  const operatorId = fixtureBytes32("offer-operator");
  const slot = offerSlot(operatorId, 0, 100n * USDC);
  const opened = openOffer(
    emptyOfferBook(),
    fixtureBytes32("offer-open"),
    slot,
  );
  const duplicate = openOffer(
    opened.state,
    fixtureBytes32("offer-open"),
    slot,
  );
  assert.equal(opened.applied, true);
  assert.equal(duplicate.applied, false);
  assert.equal(
    liveOfferTotalUsdc(opened.state, operatorId),
    100n * USDC,
  );

  const released = releaseOffer(
    opened.state,
    fixtureBytes32("offer-release"),
    slot.slotId,
    "CANONICAL_REORG_REPLACEMENT",
  );
  const releasedAgain = releaseOffer(
    released.state,
    fixtureBytes32("offer-release"),
    slot.slotId,
    "CANONICAL_REORG_REPLACEMENT",
  );
  assert.equal(released.applied, true);
  assert.equal(releasedAgain.applied, false);
  assert.equal(liveOfferTotalUsdc(released.state, operatorId), 0n);
});


test("offer semantic identity prevents different-slot double opens", () => {
  const operatorId = fixtureBytes32("semantic-offer-operator");
  const slot = offerSlot(operatorId, 10, 100n * USDC);
  const first = openOffer(
    emptyOfferBook(),
    fixtureBytes32("semantic-offer-open"),
    slot,
  );
  const alias = {
    ...slot,
    slotId: fixtureBytes32("semantic-offer-alias-slot"),
  };
  assert.equal(offerSemanticKey(slot), offerSemanticKey(alias));
  const duplicate = openOffer(
    first.state,
    fixtureBytes32("semantic-offer-alias-event"),
    alias,
  );
  assert.equal(duplicate.applied, false);
  assert.strictEqual(duplicate.state, first.state);
  assert.equal(first.state.records.length, 1);

  assert.throws(
    () =>
      openOffer(
        first.state,
        fixtureBytes32("semantic-offer-conflict-event"),
        {
          ...alias,
          slotId: fixtureBytes32("semantic-offer-conflict-slot"),
          usdcAmount: alias.usdcAmount + 1n,
        },
      ),
    /semantic identity was reused/i,
  );

  const distinct = offerSlot(operatorId, 11, 25n * USDC);
  assert.notEqual(offerSemanticKey(slot), offerSemanticKey(distinct));
  const branch = openOffer(
    first.state,
    fixtureBytes32("semantic-offer-branch-event"),
    distinct,
  ).state;
  assert.equal(first.state.records.length, 1);
  assert.equal(branch.records.length, 2);
  assert.equal(liveOfferTotalUsdc(first.state, operatorId), 100n * USDC);
  assert.equal(liveOfferTotalUsdc(branch, operatorId), 125n * USDC);

  const released = releaseOffer(
    first.state,
    fixtureBytes32("semantic-offer-release"),
    slot.slotId,
    "CANCELLED",
  ).state;
  assert.throws(
    () => openOffer(released, fixtureBytes32("semantic-offer-reopen"), alias),
    /semantic identity was reused/i,
  );

  const mixedCaseAlias = {
    ...distinct,
    slotId: fixtureBytes32("semantic-offer-case-alias-slot"),
    orderId: mixedCaseHex(distinct.orderId),
    operatorId: mixedCaseHex(distinct.operatorId),
    merchant: mixedCaseHex(distinct.merchant),
    channelId: mixedCaseHex(distinct.channelId),
  };
  const mixedDuplicate = openOffer(
    branch,
    mixedCaseHex(fixtureBytes32("semantic-offer-case-alias-event")),
    mixedCaseAlias,
  );
  assert.equal(mixedDuplicate.applied, false);
  assert.equal(mixedDuplicate.state.records.length, 2);
  assert.equal(
    mixedDuplicate.state.records[1]?.slot.operatorId,
    distinct.operatorId.toLowerCase(),
  );
  assert.throws(
    () =>
      openOffer(
        branch,
        fixtureBytes32("semantic-offer-case-conflict-event"),
        {
          ...mixedCaseAlias,
          slotId: fixtureBytes32("semantic-offer-case-conflict-slot"),
          usdcAmount: mixedCaseAlias.usdcAmount + 1n,
        },
      ),
    /semantic identity was reused/i,
  );
});

test("block hash, build manifest, and quote changes alter shadow digest", async () => {
  const input = fixtureInput(5, 1, 8n);
  const base = await selectOrder(input);
  const changedHash = fixtureBytes32("changed-finalized-block");
  const reorged = await selectOrder({
    ...input,
    order: { ...input.order, snapshotBlockHash: changedHash },
    universe: { ...input.universe, finalizedBlockHash: changedHash },
    candidates: input.candidates.map((candidate) => ({
      ...candidate,
      observedAtBlockHash: changedHash,
    })),
  });
  const changedBuild = await selectOrder({
    ...input,
    helperBuildHash: fixtureBytes32("changed-build"),
  });
  const changedQuote = await selectOrder({
    ...input,
    order: {
      ...input.order,
      quoteHash: fixtureBytes32("changed-quote"),
    },
  });
  assert.notEqual(base.trace.traceId, reorged.trace.traceId);
  assert.notEqual(base.trace.traceId, changedBuild.trace.traceId);
  assert.notEqual(base.trace.traceId, changedQuote.trace.traceId);
});

function fixtureInput(
  operatorCount: number,
  readinessReserveF: number,
  sequence: bigint,
  transform?: (
    states: readonly FixtureOperatorState[],
  ) => readonly FixtureOperatorState[],
): SelectionInput {
  const fixture = fixtureConfig(operatorCount, readinessReserveF);
  const states: readonly FixtureOperatorState[] = Array.from(
    { length: operatorCount },
    (_, operatorIndex) => ({
      operatorIndex,
      acceptedUsdc: 0n,
      virtualFinishQ: 0n,
      openOffers: [],
      online: true,
      walletVersion: 0,
      activeAcceptedOrders: 0,
      recentFailureTier: 0,
      lastAcceptedOrAssignedAt: null,
    }),
  );
  return buildSimulationSelectionInput(fixture, {
    seed: "selection-test",
    sequence,
    usdcAmount: 10n * USDC,
    domainFloorQ: 0n,
    operatorStates: transform === undefined ? states : transform(states),
    history: [],
    authoritativeEligibility: offlineEligibility,
  });
}

function fixtureConfig(
  operatorCount: number,
  readinessReserveF: number,
): SimulationFixtureConfig {
  const base = explicitUnapprovedSimulationFixture();
  const shadowPolicy = {
    ...base.shadowPolicy,
    readinessReserveF,
    maxCohortExpansion: Math.max(4, readinessReserveF),
  };
  return {
    ...base,
    operatorCount,
    channelsPerOperator: 2,
    failureDomainModulo: operatorCount,
    policy: {
      ...base.policy,
      policyHash: selectionPolicyHash(base.policy, shadowPolicy),
    },
    shadowPolicy,
  };
}

function acceptance(
  label: string,
  operatorId: Bytes32,
  domainEpoch: Bytes32,
  domain: RoutingDomain,
  usdcAmount: bigint,
) {
  return {
    acceptanceId: fixtureBytes32(`acceptance:${label}`),
    orderId: fixtureBytes32(`order:${label}`),
    round: 1n,
    operatorId,
    domainEpoch,
    domain,
    usdcAmount,
    governedDomainFloorQ: 0n,
    acceptedAtBlock: 100n,
    acceptedAtBlockHash: fixtureBytes32(`block:${label}`),
  };
}

function offerSlot(
  operatorId: Bytes32,
  index: number,
  usdcAmount: bigint,
): OpenOfferSlot {
  return {
    slotId: fixtureBytes32(`slot:${index}`),
    orderId: fixtureBytes32(`offer-order:${index}`),
    round: 1n,
    operatorId,
    merchant: fixtureAddress(1_000),
    channelId: fixtureBytes32(`offer-channel:${index}`),
    usdcAmount,
    openedAtSequence: 1n,
  };
}

function mixedCaseHex<T extends `0x${string}`>(value: T): T {
  return `0x${value.slice(2).toUpperCase()}` as T;
}
