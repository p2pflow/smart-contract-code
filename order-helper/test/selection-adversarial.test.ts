import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthoritativeEligibilityAdapter,
} from "../src/domain/types";
import { selectionPolicyHash } from "../src/selection/policy-witness";
import { selectOrder } from "../src/selection/selector";
import {
  SelectionHistoryEvent,
  SelectionInput,
} from "../src/selection/types";
import {
  FixtureOperatorState,
  buildSimulationSelectionInput,
  fixtureAddress,
  fixtureBytes32,
} from "../src/simulator/fixture";
import {
  explicitUnapprovedSimulationFixture,
} from "../src/simulator/unapproved-fixture";

const USDC = 1_000_000n;

const fixtureEligibility: AuthoritativeEligibilityAdapter = {
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

test("concentration demotes a saturated operator before order-ID hash grinding", async () => {
  const sequence = 100n;
  const base = fiveOperatorInput(sequence);
  const saturatedOperator = fixtureBytes32("operator:0");
  const history: SelectionHistoryEvent[] = [90n, 91n].map(
    (eventSequence, index) => ({
      eventId: fixtureBytes32(`concentration-event:${index}`),
      operatorId: saturatedOperator,
      decisionId: fixtureBytes32(`concentration-decision:${index}`),
      orderId: fixtureBytes32(`concentration-order:${index}`),
      round: 1n,
      sequence: eventSequence,
      kind: "RANK_ZERO_ASSIGNED",
    }),
  );
  const shadowPolicy = {
    ...base.shadowPolicy,
    concentrationWindowSequences: 32,
    maxRankZeroPerOperatorInWindow: 2,
  };
  const policy = {
    ...base.policy,
    policyHash: selectionPolicyHash(base.policy, shadowPolicy),
  };

  for (let grind = 0; grind < 128; grind += 1) {
    const result = await selectOrder({
      ...base,
      history,
      policy,
      shadowPolicy,
      order: {
        ...base.order,
        orderId: fixtureBytes32(`adversarial-order-id:${grind}`),
      },
    });
    assert.ok(!("status" in result.outcome));
    assert.notEqual(result.trace.selectedOperatorIds[0], saturatedOperator);
  }
});

test("wallet splitting and paginated channel permutations retain one operator weight", async () => {
  const input = fiveOperatorInput(12n);
  const first = input.candidates[0];
  const firstOperator = input.operators[0];
  assert.ok(first !== undefined);
  assert.ok(firstOperator !== undefined);
  const splitWallet = fixtureAddress(77_777);
  const splitCandidate = {
    ...first,
    merchant: splitWallet,
    channels: first.channels.map((channel, index) => ({
      ...channel,
      channelId: fixtureBytes32(`split-channel:${index}`),
      merchant: splitWallet,
    })),
  };
  const split: SelectionInput = {
    ...input,
    candidates: [
      splitCandidate,
      ...[...input.candidates].reverse().map((candidate) => ({
        ...candidate,
        channels: [...candidate.channels].reverse(),
      })),
    ],
    operators: input.operators.map((operator, index) =>
      index === 0
        ? {
            ...operator,
            wallets: [...operator.wallets, splitWallet],
          }
        : operator
    ),
    universe: {
      ...input.universe,
      pageCount: input.universe.pageCount + 1,
      expectedEntryCount:
        input.universe.expectedEntryCount + splitCandidate.channels.length,
    },
  };
  const result = await selectOrder(split);
  assert.ok(!("status" in result.outcome));
  assert.equal(new Set(result.trace.selectedOperatorIds).size, 4);
  assert.ok(
    result.trace.selectedOperatorIds.filter(
      (operatorId) =>
        operatorId.toLowerCase() === firstOperator.operatorId.toLowerCase(),
    ).length <= 1,
  );
});

function fiveOperatorInput(sequence: bigint): SelectionInput {
  const base = explicitUnapprovedSimulationFixture();
  const shadowPolicy = {
    ...base.shadowPolicy,
    readinessReserveF: 1,
    maxCohortExpansion: 4,
  };
  const fixture = {
    ...base,
    operatorCount: 5,
    channelsPerOperator: 2,
    failureDomainModulo: 5,
    policy: {
      ...base.policy,
      policyHash: selectionPolicyHash(base.policy, shadowPolicy),
    },
    shadowPolicy,
  };
  const operatorStates: readonly FixtureOperatorState[] = Array.from(
    { length: 5 },
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
    seed: "selection-adversarial-test",
    sequence,
    usdcAmount: 10n * USDC,
    domainFloorQ: 0n,
    operatorStates,
    history: [],
    authoritativeEligibility: fixtureEligibility,
  });
}
