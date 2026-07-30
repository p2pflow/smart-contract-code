import {
  AuthoritativeEligibilityAdapter,
  EligibilityResult,
} from "../domain/types";
import { selectOrder } from "../selection";
import { buySafetyBuffer } from "../selection/math";
import {
  FixtureOperatorState,
  buildSimulationSelectionInput,
  explicitUnapprovedSimulationFixture,
} from "../simulator";
import {
  ReplayEligibilityEntry,
  ReplayFixture,
} from "./fixture-codec";

const USDC = 1_000_000n;

/**
 * Creates a wholly synthetic replay document. It is deliberately labelled as
 * snapshot evidence and must never be represented as a contract observation.
 */
export async function buildUnapprovedReplayFixture(): Promise<ReplayFixture> {
  const fixture = explicitUnapprovedSimulationFixture();
  const operatorStates: readonly FixtureOperatorState[] = Array.from(
    { length: fixture.operatorCount },
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
  const results = new Map<string, EligibilityResult>();
  const adapter: AuthoritativeEligibilityAdapter = {
    async check(request) {
      const key =
        `${request.merchant.toLowerCase()}:${request.channelId.toLowerCase()}`;
      const result = results.get(key);
      if (result === undefined) {
        throw new Error("Synthetic replay result is incomplete");
      }
      return { ...result };
    },
  };
  const input = buildSimulationSelectionInput(fixture, {
    seed: "unapproved-replay-fixture-v1",
    sequence: 1n,
    usdcAmount: 10n * USDC,
    domainFloorQ: 0n,
    operatorStates,
    history: [],
    authoritativeEligibility: adapter,
  });
  const authoritativeRequired =
    input.order.usdcAmount + buySafetyBuffer(
      input.order.usdcAmount,
      input.policy,
    );
  const authoritativeResults: ReplayEligibilityEntry[] = [];
  for (const candidate of input.candidates) {
    for (const channel of candidate.channels) {
      const result: EligibilityResult = {
        code: "ELIGIBLE",
        required: authoritativeRequired,
        available: candidate.usdcLiquidity,
        source: "snapshot",
        checkedAtBlock: input.order.snapshotBlock,
        detail: "Synthetic offline fixture; not a contract observation",
      };
      results.set(
        `${candidate.merchant.toLowerCase()}:${channel.channelId.toLowerCase()}`,
        result,
      );
      authoritativeResults.push({
        merchant: candidate.merchant,
        channelId: channel.channelId,
        result,
      });
    }
  }
  const selection = await selectOrder(input);
  const {
    authoritativeEligibility: ignoredAdapter,
    ...serializableInput
  } = input;
  void ignoredAdapter;
  return {
    schema: "p2pflow.shadow-selection-replay.v1",
    input: serializableInput,
    authoritativeResults,
    expectedTraceId: selection.trace.traceId,
  };
}
