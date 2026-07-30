import { canonicalJson } from "../canonical/canonical-json";
import {
  AuthoritativeEligibilityAdapter,
  Bytes32,
  EligibilityCode,
} from "../domain/types";
import {
  AcceptanceLedgerState,
  applyCanonicalAcceptance,
  emptyAcceptanceLedger,
  operatorAcceptedState,
} from "../selection/acceptance-ledger";
import { hashCanonicalPayloadText } from "../selection/canonical";
import { isRankEligibleAt } from "../selection/leases";
import { selectOrder } from "../selection/selector";
import {
  OpenOfferSlot,
  SelectionHistoryEvent,
} from "../selection/types";
import {
  ExactJainIndex,
  VolumeSpread,
  exactJainIndex,
  volumeSpread,
} from "./fairness";
import {
  FixtureOperatorState,
  SimulationFixtureConfig,
  buildSimulationSelectionInput,
  fixtureAddress,
  fixtureBytes32,
} from "./fixture";
import { SeededPrng, SimulationSeed } from "./prng";

export const MIN_PRODUCTION_SHAPED_SIMULATION_ORDERS = 100_000;

export const CAPACITY_BINDING_ELIGIBILITY_CODES = [
  "TOO_MANY_OPEN_OFFERS",
  "TOO_MANY_ACTIVE_ORDERS",
  "DAILY_LIMIT_EXCEEDED",
  "MONTHLY_LIMIT_EXCEEDED",
  "INSUFFICIENT_USDC",
  "INSUFFICIENT_FIAT_PRINCIPAL",
  "INSUFFICIENT_PHYSICAL_FIAT",
] as const satisfies readonly EligibilityCode[];

const capacityBindingEligibilityCodes = new Set<EligibilityCode>(
  CAPACITY_BINDING_ELIGIBILITY_CODES,
);

export function isCapacityBindingExclusion(
  code: EligibilityCode,
): boolean {
  return capacityBindingEligibilityCodes.has(code);
}

export function commitCanonicalSimulationDecision(
  orderIndex: number,
  canonicalReorgEvery: number,
  commit: () => void,
): boolean {
  if (
    canonicalReorgEvery > 0 &&
    (orderIndex + 1) % canonicalReorgEvery === 0
  ) {
    return false;
  }
  commit();
  return true;
}

export interface SimulationConfig {
  readonly fixture: SimulationFixtureConfig;
  readonly seed: SimulationSeed;
  readonly orderCount: number;
  readonly orderSizesUsdc: readonly bigint[];
  readonly offlineCycleLength: number;
  readonly offlineDuration: number;
  readonly leaseFallbackEvery: number;
  readonly canonicalReorgEvery: number;
  readonly duplicateAcceptanceEvery: number;
  readonly syntheticOpenOfferEvery: number;
  readonly syntheticOpenOfferSlots: number;
  readonly walletRotationEvery: number;
  readonly stateCheckpointEvery: number;
  readonly comparableEligibilityMinimumBps: number;
  readonly minimumAcceptedServiceDecisions: number;
  readonly jainTargetScaled: bigint;
  readonly jainScale: bigint;
  readonly maxMinAllowanceUsdc: bigint;
}

export interface OperatorSimulationMetrics {
  readonly operatorId: Bytes32;
  readonly acceptedUsdc: bigint;
  readonly virtualFinishQ: bigint;
  readonly eligibleDecisions: number;
  readonly eligibleUsdc: bigint;
  readonly rankExposure: readonly [number, number, number, number];
  readonly rankZeroMisses: number;
  readonly walletRotations: number;
}

export interface SimulationReport {
  readonly schema: "p2pflow.offline-shadow-simulation.v2";
  readonly capability: "TRANSACTION_DISABLED_SHADOW_ONLY";
  readonly explicitFixtureOnly: true;
  readonly seed: string;
  readonly ordersRequested: number;
  readonly decisionsComputed: number;
  readonly acceptedDecisions: number;
  readonly unresolvedOrders: number;
  readonly canonicalReorgDiscards: number;
  readonly duplicateAcceptanceNoops: number;
  readonly stateCheckpoints: number;
  readonly eligibilityChanges: number;
  readonly reentries: number;
  readonly virtualFinishRegressions: number;
  readonly offerExposureDecisions: number;
  readonly leaseFallbackAcceptances: number;
  readonly capacityBindingExclusions: number;
  readonly largestOrderUsdc: bigint;
  readonly globalJain: ExactJainIndex;
  readonly comparableJain: ExactJainIndex;
  readonly globalSpread: VolumeSpread;
  readonly comparableSpread: VolumeSpread;
  readonly comparableOperatorCount: number;
  readonly rankExposureTotals: readonly [number, number, number, number];
  readonly totalRankZeroMisses: number;
  readonly traceRoot: Bytes32;
  readonly targets: {
    readonly jainTargetScaled: bigint;
    readonly minimumAcceptedServiceDecisions: number;
    readonly acceptedServiceCoveragePass: boolean;
    readonly globalJainPass: boolean;
    readonly comparableJainPass: boolean;
    readonly maxMinAllowanceUsdc: bigint;
    readonly globalMaxMinPass: boolean;
    readonly zeroRegressionPass: boolean;
  };
  readonly operators: readonly OperatorSimulationMetrics[];
}

interface MutableOperatorMetrics {
  acceptedUsdc: bigint;
  virtualFinishQ: bigint;
  eligibleDecisions: number;
  eligibleUsdc: bigint;
  rankExposure: [number, number, number, number];
  rankZeroMisses: number;
  walletRotations: number;
  lastActivity: bigint | null;
}

const fixtureEligibility: AuthoritativeEligibilityAdapter = {
  async check(request) {
    return {
      code: "ELIGIBLE",
      required: request.minimumRequired,
      available: request.minimumRequired,
      source: "snapshot",
      checkedAtBlock: request.order.snapshotBlock,
      detail: "Offline fixture result; never action-authoritative",
    };
  },
};

export async function runSimulation(
  config: SimulationConfig,
): Promise<SimulationReport> {
  validateSimulationConfig(config);
  const seedText =
    typeof config.seed === "bigint"
      ? config.seed.toString(10)
      : config.seed.normalize("NFC");
  const random = new SeededPrng(config.seed);
  const domain = {
    chainId: config.fixture.chainId,
    fiatCurrency: config.fixture.fiatCurrency,
    paymentRailGroup: config.fixture.paymentRailGroup,
    orderSide: "BUY" as const,
  };
  let ledger = emptyAcceptanceLedger(domain, config.fixture.domainEpoch);
  let history: SelectionHistoryEvent[] = [];
  let domainFloorQ = 0n;
  let traceRoot = fixtureBytes32(`simulation-trace:${seedText}`);
  let acceptedDecisions = 0;
  let unresolvedOrders = 0;
  let canonicalReorgDiscards = 0;
  let duplicateAcceptanceNoops = 0;
  let stateCheckpoints = 0;
  let eligibilityChanges = 0;
  let reentries = 0;
  let virtualFinishRegressions = 0;
  let offerExposureDecisions = 0;
  let leaseFallbackAcceptances = 0;
  let capacityBindingExclusions = 0;
  let largestOrderUsdc = 0n;
  const previousOnline = Array.from(
    { length: config.fixture.operatorCount },
    () => true,
  );
  const previousWalletVersion = Array.from(
    { length: config.fixture.operatorCount },
    () => 0,
  );
  const metrics = Array.from(
    { length: config.fixture.operatorCount },
    (): MutableOperatorMetrics => ({
      acceptedUsdc: 0n,
      virtualFinishQ: 0n,
      eligibleDecisions: 0,
      eligibleUsdc: 0n,
      rankExposure: [0, 0, 0, 0],
      rankZeroMisses: 0,
      walletRotations: 0,
      lastActivity: null,
    }),
  );
  const operatorIndexById = new Map<string, number>(
    Array.from({ length: config.fixture.operatorCount }, (_, index) => [
      fixtureBytes32(`operator:${index}`).toLowerCase(),
      index,
    ]),
  );

  for (let orderIndex = 0; orderIndex < config.orderCount; orderIndex += 1) {
    if (orderIndex > 0 && orderIndex % 256 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const sequence = BigInt(orderIndex);
    const sizeIndex = Number(
      random.nextBelow(BigInt(config.orderSizesUsdc.length)),
    );
    const orderUsdc = config.orderSizesUsdc[sizeIndex];
    if (orderUsdc === undefined) {
      throw new Error("Order-size draw failed");
    }
    const walletVersion =
      config.walletRotationEvery === 0
        ? 0
        : Math.floor(orderIndex / config.walletRotationEvery);
    const offlineIndex = offlineOperatorAt(config, orderIndex);
    const operatorStates: FixtureOperatorState[] = [];
    let decisionEligibilityChanges = 0;
    let decisionReentries = 0;
    let decisionOfferExposures = 0;

    for (
      let operatorIndex = 0;
      operatorIndex < config.fixture.operatorCount;
      operatorIndex += 1
    ) {
      const operatorMetrics = metrics[operatorIndex];
      if (operatorMetrics === undefined) {
        throw new Error("Operator metric lookup failed");
      }
      const online = operatorIndex !== offlineIndex;
      const wasOnline = previousOnline[operatorIndex];
      if (wasOnline === undefined) {
        throw new Error("Previous eligibility state lookup failed");
      }
      if (wasOnline !== online) {
        decisionEligibilityChanges += 1;
        if (!wasOnline && online) decisionReentries += 1;
      }
      const accepted = operatorAcceptedState(
        ledger,
        fixtureBytes32(`operator:${operatorIndex}`),
      );
      const offers = syntheticOffers(
        config,
        seedText,
        orderIndex,
        operatorIndex,
        walletVersion,
        orderUsdc,
      );
      if (offers.length > 0) decisionOfferExposures += 1;
      operatorStates.push({
        operatorIndex,
        acceptedUsdc: accepted?.acceptedUsdc ?? 0n,
        virtualFinishQ: accepted?.virtualFinishQ ?? null,
        openOffers: offers,
        online,
        walletVersion,
        activeAcceptedOrders: 0,
        recentFailureTier: 0,
        lastAcceptedOrAssignedAt: operatorMetrics.lastActivity,
      });
    }

    const input = buildSimulationSelectionInput(config.fixture, {
      seed: seedText,
      sequence,
      usdcAmount: orderUsdc,
      domainFloorQ,
      operatorStates,
      history,
      authoritativeEligibility: fixtureEligibility,
    });
    const result = await selectOrder(input);
    const decisionCapacityBindingExclusions = result.outcome.excluded.reduce(
      (count, exclusion) =>
        count +
        (isCapacityBindingExclusion(exclusion.result.code) ? 1 : 0),
      0,
    );
    const nextTraceRoot = hashCanonicalPayloadText(
      canonicalJson({
        schema: "p2pflow.simulation-trace-chain.v1",
        previous: traceRoot,
        next: result.trace.traceId,
      }),
    );
    const commitObservedDecision = (): void => {
      if (orderUsdc > largestOrderUsdc) largestOrderUsdc = orderUsdc;
      eligibilityChanges += decisionEligibilityChanges;
      reentries += decisionReentries;
      offerExposureDecisions += decisionOfferExposures;
      capacityBindingExclusions += decisionCapacityBindingExclusions;
      traceRoot = nextTraceRoot;
      for (const operatorState of operatorStates) {
        const operatorMetrics = metrics[operatorState.operatorIndex];
        const priorWalletVersion =
          previousWalletVersion[operatorState.operatorIndex];
        if (
          operatorMetrics === undefined ||
          priorWalletVersion === undefined
        ) {
          throw new Error("Canonical operator state lookup failed");
        }
        previousOnline[operatorState.operatorIndex] =
          operatorState.online;
        previousWalletVersion[operatorState.operatorIndex] =
          operatorState.walletVersion;
        if (operatorState.online) {
          operatorMetrics.eligibleDecisions += 1;
          operatorMetrics.eligibleUsdc += orderUsdc;
        }
        if (priorWalletVersion !== operatorState.walletVersion) {
          operatorMetrics.walletRotations += 1;
        }
      }
    };

    if ("status" in result.outcome) {
      commitObservedDecision();
      unresolvedOrders += 1;
      history = pruneHistory(history, sequence, config);
      continue;
    }
    const selectedOperatorMetrics = result.outcome.candidates.map(
      (candidate) => {
        const operatorId = result.trace.selectedOperatorIds[candidate.rank];
        if (operatorId === undefined) {
          throw new Error("Selected operator trace is incomplete");
        }
        const operatorIndex = operatorIndexById.get(operatorId.toLowerCase());
        const operatorMetrics =
          operatorIndex === undefined ? undefined : metrics[operatorIndex];
        if (operatorMetrics === undefined) {
          throw new Error("Selected operator is outside the fixture universe");
        }
        return { candidate, operatorMetrics };
      },
    );

    const decisionId = result.outcome.decisionId;
    const rankZeroOperator = result.trace.selectedOperatorIds[0];
    if (rankZeroOperator === undefined) {
      throw new Error("Rank-zero operator is missing");
    }
    const fallback =
      config.leaseFallbackEvery > 0 &&
      (orderIndex + 1) % config.leaseFallbackEvery === 0;
    const acceptedRank = fallback ? 1 : 0;
    const rankZeroIndex = operatorIndexById.get(
      rankZeroOperator.toLowerCase(),
    );
    const rankZeroMetrics =
      rankZeroIndex === undefined ? undefined : metrics[rankZeroIndex];
    if (rankZeroMetrics === undefined) {
      throw new Error("Rank-zero metric lookup failed");
    }
    const acceptedOperator =
      result.trace.selectedOperatorIds[acceptedRank];
    const acceptedCandidate = result.outcome.candidates[acceptedRank];
    if (acceptedOperator === undefined || acceptedCandidate === undefined) {
      throw new Error("Lease fallback candidate is missing");
    }
    const acceptedAt =
      input.assignedAt +
      BigInt(acceptedRank * config.fixture.policy.leaseStepSeconds);
    if (
      !isRankEligibleAt(
        acceptedCandidate.rank,
        acceptedAt,
        input.assignedAt,
        input.order.validUntil,
        config.fixture.policy.leaseStepSeconds,
      )
    ) {
      throw new Error("Simulation attempted acceptance outside a lease");
    }
    const acceptance = {
      acceptanceId: fixtureBytes32(
        `${seedText}:acceptance:${orderIndex}:${acceptedOperator}`,
      ),
      orderId: input.order.orderId,
      round: input.order.round,
      operatorId: acceptedOperator,
      domainEpoch: config.fixture.domainEpoch,
      domain: input.order.domain,
      usdcAmount: orderUsdc,
      governedDomainFloorQ: domainFloorQ,
      acceptedAtBlock: input.order.snapshotBlock + 1n,
      acceptedAtBlockHash: fixtureBytes32(
        `${seedText}:acceptance-block:${orderIndex}`,
      ),
    };
    const committed = commitCanonicalSimulationDecision(
      orderIndex,
      config.canonicalReorgEvery,
      () => {
        commitObservedDecision();
        for (const entry of selectedOperatorMetrics) {
          entry.operatorMetrics.rankExposure[
            entry.candidate.rank
          ] += 1;
          entry.operatorMetrics.lastActivity = input.assignedAt;
        }
        history.push(
          historyEvent(
            "RANK_ZERO_ASSIGNED",
            sequence,
            decisionId,
            input.order.orderId,
            input.order.round,
            rankZeroOperator,
          ),
        );
        if (fallback) {
          leaseFallbackAcceptances += 1;
          rankZeroMetrics.rankZeroMisses += 1;
          history.push(
            historyEvent(
              "RANK_ZERO_MISSED",
              sequence,
              decisionId,
              input.order.orderId,
              input.order.round,
              rankZeroOperator,
            ),
          );
        }
        const before = operatorAcceptedState(ledger, acceptedOperator);
        const applied = applyCanonicalAcceptance(ledger, acceptance);
        ledger = applied.state;
        const after = operatorAcceptedState(ledger, acceptedOperator);
        if (
          before !== null &&
          after !== null &&
          after.virtualFinishQ < before.virtualFinishQ
        ) {
          virtualFinishRegressions += 1;
        }
        if (
          config.duplicateAcceptanceEvery > 0 &&
          (orderIndex + 1) % config.duplicateAcceptanceEvery === 0
        ) {
          const duplicate = applyCanonicalAcceptance(ledger, acceptance);
          if (duplicate.applied) {
            throw new Error("Duplicate acceptance changed accepted service");
          }
          duplicateAcceptanceNoops += 1;
        }
        acceptedDecisions += 1;
        history.push(
          historyEvent(
            "ACCEPTED",
            sequence,
            decisionId,
            input.order.orderId,
            input.order.round,
            acceptedOperator,
          ),
        );
        domainFloorQ = nextMonotoneDomainFloor(
          domainFloorQ,
          ledger,
          config.fixture.operatorCount,
        );
        history = pruneHistory(history, sequence, config);

        if (
          config.stateCheckpointEvery > 0 &&
          (orderIndex + 1) % config.stateCheckpointEvery === 0
        ) {
          ledger = cloneLedger(ledger);
          history = history.map((event) => ({ ...event }));
          stateCheckpoints += 1;
        }
      },
    );
    if (!committed) {
      canonicalReorgDiscards += 1;
    }
  }

  const operatorReports = metrics.map((entry, operatorIndex) => {
    const accepted = operatorAcceptedState(
      ledger,
      fixtureBytes32(`operator:${operatorIndex}`),
    );
    entry.acceptedUsdc = accepted?.acceptedUsdc ?? 0n;
    entry.virtualFinishQ = accepted?.virtualFinishQ ?? 0n;
    return {
      operatorId: fixtureBytes32(`operator:${operatorIndex}`),
      acceptedUsdc: entry.acceptedUsdc,
      virtualFinishQ: entry.virtualFinishQ,
      eligibleDecisions: entry.eligibleDecisions,
      eligibleUsdc: entry.eligibleUsdc,
      rankExposure: entry.rankExposure,
      rankZeroMisses: entry.rankZeroMisses,
      walletRotations: entry.walletRotations,
    };
  });
  const globalVolumes = operatorReports.map((entry) => entry.acceptedUsdc);
  const maximumEligibility = operatorReports.reduce(
    (maximum, entry) =>
      entry.eligibleDecisions > maximum
        ? entry.eligibleDecisions
        : maximum,
    0,
  );
  const comparable = operatorReports.filter(
    (entry) =>
      BigInt(entry.eligibleDecisions) * 10_000n >=
      BigInt(maximumEligibility) *
        BigInt(config.comparableEligibilityMinimumBps),
  );
  if (comparable.length === 0) {
    throw new Error("Comparable fairness cohort is empty");
  }
  const comparableVolumes = comparable.map((entry) => entry.acceptedUsdc);
  const globalJain = exactJainIndex(globalVolumes, config.jainScale);
  const comparableJain = exactJainIndex(
    comparableVolumes,
    config.jainScale,
  );
  const globalSpread = volumeSpread(globalVolumes);
  const comparableSpread = volumeSpread(comparableVolumes);
  const rankExposureTotals = operatorReports.reduce(
    (totals, entry) => {
      totals[0] += entry.rankExposure[0];
      totals[1] += entry.rankExposure[1];
      totals[2] += entry.rankExposure[2];
      totals[3] += entry.rankExposure[3];
      return totals;
    },
    [0, 0, 0, 0] as [number, number, number, number],
  );

  return {
    schema: "p2pflow.offline-shadow-simulation.v2",
    capability: "TRANSACTION_DISABLED_SHADOW_ONLY",
    explicitFixtureOnly: true,
    seed: seedText,
    ordersRequested: config.orderCount,
    decisionsComputed: config.orderCount,
    acceptedDecisions,
    unresolvedOrders,
    canonicalReorgDiscards,
    duplicateAcceptanceNoops,
    stateCheckpoints,
    eligibilityChanges,
    reentries,
    virtualFinishRegressions,
    offerExposureDecisions,
    leaseFallbackAcceptances,
    capacityBindingExclusions,
    largestOrderUsdc,
    globalJain,
    comparableJain,
    globalSpread,
    comparableSpread,
    comparableOperatorCount: comparable.length,
    rankExposureTotals,
    totalRankZeroMisses: operatorReports.reduce(
      (total, entry) => total + entry.rankZeroMisses,
      0,
    ),
    traceRoot,
    targets: {
      jainTargetScaled: config.jainTargetScaled,
      minimumAcceptedServiceDecisions:
        config.minimumAcceptedServiceDecisions,
      acceptedServiceCoveragePass:
        acceptedDecisions >= config.minimumAcceptedServiceDecisions,
      globalJainPass: globalJain.scaled >= config.jainTargetScaled,
      comparableJainPass:
        comparableJain.scaled >= config.jainTargetScaled,
      maxMinAllowanceUsdc: config.maxMinAllowanceUsdc,
      globalMaxMinPass:
        globalSpread.difference <= config.maxMinAllowanceUsdc,
      zeroRegressionPass: virtualFinishRegressions === 0,
    },
    operators: operatorReports,
  };
}

function validateSimulationConfig(config: SimulationConfig): void {
  if (
    !Number.isSafeInteger(config.orderCount) ||
    config.orderCount < MIN_PRODUCTION_SHAPED_SIMULATION_ORDERS ||
    config.orderSizesUsdc.length === 0 ||
    config.orderSizesUsdc.some(
      (size) =>
        size < config.fixture.policy.minOrderUsdc ||
        size > config.fixture.policy.maxOrderUsdc,
    ) ||
    !isNonNegativeSafeInteger(config.offlineCycleLength) ||
    !isNonNegativeSafeInteger(config.offlineDuration) ||
    config.offlineDuration > config.offlineCycleLength ||
    !isNonNegativeSafeInteger(config.leaseFallbackEvery) ||
    !isNonNegativeSafeInteger(config.canonicalReorgEvery) ||
    !isNonNegativeSafeInteger(config.duplicateAcceptanceEvery) ||
    !isNonNegativeSafeInteger(config.syntheticOpenOfferEvery) ||
    !isNonNegativeSafeInteger(config.syntheticOpenOfferSlots) ||
    config.syntheticOpenOfferSlots >=
      config.fixture.policy.maxPendingOffersPerMerchant ||
    !isNonNegativeSafeInteger(config.walletRotationEvery) ||
    !isNonNegativeSafeInteger(config.stateCheckpointEvery) ||
    !Number.isSafeInteger(config.comparableEligibilityMinimumBps) ||
    config.comparableEligibilityMinimumBps < 0 ||
    config.comparableEligibilityMinimumBps > 10_000 ||
    !Number.isSafeInteger(config.minimumAcceptedServiceDecisions) ||
    config.minimumAcceptedServiceDecisions <= 0 ||
    config.minimumAcceptedServiceDecisions > config.orderCount ||
    config.jainTargetScaled < 0n ||
    config.jainTargetScaled > config.jainScale ||
    config.jainScale <= 0n ||
    config.maxMinAllowanceUsdc < 0n
  ) {
    throw new RangeError(
      "Simulation parameters must be explicit, bounded fixture values",
    );
  }
}

function offlineOperatorAt(
  config: SimulationConfig,
  orderIndex: number,
): number | null {
  if (
    config.offlineCycleLength === 0 ||
    config.offlineDuration === 0
  ) {
    return null;
  }
  const withinCycle = orderIndex % config.offlineCycleLength;
  if (withinCycle >= config.offlineDuration) return null;
  return (
    Math.floor(orderIndex / config.offlineCycleLength) %
    config.fixture.operatorCount
  );
}

function syntheticOffers(
  config: SimulationConfig,
  seed: string,
  orderIndex: number,
  operatorIndex: number,
  walletVersion: number,
  orderUsdc: bigint,
): readonly OpenOfferSlot[] {
  if (
    config.syntheticOpenOfferEvery === 0 ||
    (orderIndex + 1) % config.syntheticOpenOfferEvery !== 0 ||
    operatorIndex !==
      Math.floor(orderIndex / config.syntheticOpenOfferEvery) %
        config.fixture.operatorCount
  ) {
    return [];
  }
  const wallet = fixtureAddress(
    1_000 + operatorIndex + (walletVersion * 100_000),
  );
  return Array.from(
    { length: config.syntheticOpenOfferSlots },
    (_, slotIndex) => ({
      slotId: fixtureBytes32(
        `${seed}:offer-slot:${orderIndex}:${operatorIndex}:${slotIndex}`,
      ),
      orderId: fixtureBytes32(
        `${seed}:offer-order:${orderIndex}:${operatorIndex}:${slotIndex}`,
      ),
      round: 1n,
      operatorId: fixtureBytes32(`operator:${operatorIndex}`),
      merchant: wallet,
      channelId: fixtureBytes32(
        `channel:${operatorIndex}:${walletVersion}:0`,
      ),
      usdcAmount: orderUsdc,
      openedAtSequence: BigInt(orderIndex),
    }),
  );
}

function historyEvent(
  kind: SelectionHistoryEvent["kind"],
  sequence: bigint,
  decisionId: Bytes32,
  orderId: Bytes32,
  round: bigint,
  operatorId: Bytes32,
): SelectionHistoryEvent {
  return {
    eventId: fixtureBytes32(
      `${kind}:${sequence}:${decisionId}:${operatorId}`,
    ),
    operatorId,
    decisionId,
    orderId,
    round,
    sequence,
    kind,
  };
}

function pruneHistory(
  history: readonly SelectionHistoryEvent[],
  sequence: bigint,
  config: SimulationConfig,
): SelectionHistoryEvent[] {
  const retention = BigInt(
    Math.max(
      config.fixture.shadowPolicy.concentrationWindowSequences,
      Number(config.fixture.shadowPolicy.nonresponseCooldownSequences),
    ) + 2,
  );
  const lowerBound = sequence > retention ? sequence - retention : 0n;
  return history.filter((event) => event.sequence >= lowerBound);
}

function nextMonotoneDomainFloor(
  current: bigint,
  ledger: AcceptanceLedgerState,
  operatorCount: number,
): bigint {
  let minimum: bigint | null = null;
  for (let index = 0; index < operatorCount; index += 1) {
    const finish =
      operatorAcceptedState(
        ledger,
        fixtureBytes32(`operator:${index}`),
      )?.virtualFinishQ ?? 0n;
    minimum = minimum === null || finish < minimum ? finish : minimum;
  }
  return minimum !== null && minimum > current ? minimum : current;
}

function cloneLedger(
  ledger: AcceptanceLedgerState,
): AcceptanceLedgerState {
  return {
    ...ledger,
    domain: { ...ledger.domain },
    operators: ledger.operators.map((operator) => ({ ...operator })),
    receiptIndex: ledger.receiptIndex,
  };
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
