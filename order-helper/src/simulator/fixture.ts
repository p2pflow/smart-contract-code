import { canonicalJson } from "../canonical/canonical-json";
import {
  Address,
  AuthoritativeEligibilityAdapter,
  Bytes32,
  CandidateSnapshot,
  SelectionPolicy,
} from "../domain/types";
import { hashCanonicalPayloadText } from "../selection/canonical";
import {
  OpenOfferSlot,
  OperatorRoutingSnapshot,
  SelectionHistoryEvent,
  SelectionInput,
  ShadowSelectionPolicy,
  SHADOW_CAPABILITY,
} from "../selection/types";

const stableFixtureIdentityCache = new Map<string, Bytes32>();

export interface SimulationFixtureConfig {
  readonly chainId: number;
  readonly diamond: Address;
  readonly fiatCurrency: string;
  readonly paymentRailGroup: string;
  readonly domainEpoch: Bytes32;
  readonly helperBuildVersion: string;
  readonly helperBuildHash: Bytes32;
  readonly policy: SelectionPolicy;
  readonly shadowPolicy: ShadowSelectionPolicy;
  readonly operatorCount: number;
  readonly channelsPerOperator: number;
  readonly failureDomainModulo: number;
  readonly operatorCapacityUsdc: bigint;
  readonly channelFiatPrincipalUsdc: bigint;
  readonly channelGrossFiat: bigint;
  readonly channelLimitUsdc: bigint | null;
  readonly fiatAtomsPerUsdcAtom: bigint;
  readonly startBlock: bigint;
  readonly startTimestamp: bigint;
  readonly quoteDeadlineExtraSeconds: number;
}

export interface FixtureOperatorState {
  readonly operatorIndex: number;
  readonly acceptedUsdc: bigint;
  readonly virtualFinishQ: bigint | null;
  readonly openOffers: readonly OpenOfferSlot[];
  readonly online: boolean;
  readonly walletVersion: number;
  readonly activeAcceptedOrders: number;
  readonly recentFailureTier: number;
  readonly lastAcceptedOrAssignedAt: bigint | null;
}

export interface SimulationFixtureState {
  readonly seed: string;
  readonly sequence: bigint;
  readonly usdcAmount: bigint;
  readonly domainFloorQ: bigint;
  readonly operatorStates: readonly FixtureOperatorState[];
  readonly history: readonly SelectionHistoryEvent[];
  readonly authoritativeEligibility: AuthoritativeEligibilityAdapter;
}

export function buildSimulationSelectionInput(
  config: SimulationFixtureConfig,
  state: SimulationFixtureState,
): SelectionInput {
  validateFixtureConfig(config, state);
  const snapshotBlock = config.startBlock + state.sequence;
  const snapshotBlockHash = fixtureBytes32(
    `${state.seed}:block:${snapshotBlock}`,
  );
  const assignedAt =
    config.startTimestamp +
    (state.sequence * BigInt(config.policy.assignmentTtlSeconds + 1));
  const validUntil =
    assignedAt + BigInt(config.policy.assignmentTtlSeconds);
  const operators: OperatorRoutingSnapshot[] = [];
  const candidates: CandidateSnapshot[] = [];

  for (const dynamic of [...state.operatorStates].sort(
    (left, right) => left.operatorIndex - right.operatorIndex,
  )) {
    const operatorId = fixtureBytes32(`operator:${dynamic.operatorIndex}`);
    const failureDomainId = fixtureBytes32(
      `failure-domain:${dynamic.operatorIndex % config.failureDomainModulo}`,
    );
    const wallet = fixtureAddress(
      1_000 +
        dynamic.operatorIndex +
        (dynamic.walletVersion * 100_000),
    );
    const channels = Array.from(
      { length: config.channelsPerOperator },
      (_, channelIndex) => ({
        channelId: fixtureBytes32(
          `channel:${dynamic.operatorIndex}:${dynamic.walletVersion}:${channelIndex}`,
        ),
        merchant: wallet,
        fiatCurrency: config.fiatCurrency,
        paymentRailGroup: config.paymentRailGroup,
        status: "APPROVED" as const,
        availability: "ACTIVE" as const,
        grossFiat: config.channelGrossFiat,
        reservedFiat: 0n,
        fiatPrincipalUsdc: config.channelFiatPrincipalUsdc,
        reservedPrincipalUsdc: 0n,
        dailyVolumeUsedUsdc: 0n,
        dailyLimitUsdc: config.channelLimitUsdc,
        monthlyVolumeUsedUsdc: 0n,
        monthlyLimitUsdc: config.channelLimitUsdc,
        protocolFiatDeficit: 0n,
        reconciliationRequired: false,
        openOfferCount: dynamic.openOffers.length,
      }),
    );
    const openOfferTotal = dynamic.openOffers.reduce(
      (total, offer) => total + offer.usdcAmount,
      0n,
    );
    candidates.push({
      merchant: wallet,
      accountStatus: "ACTIVE",
      availability: dynamic.online ? "ONLINE" : "OFFLINE",
      registered: true,
      allowlisted: true,
      allowlistEnabled: true,
      unstakePending: false,
      pendingRemoval: false,
      principalTargetUsdc: config.operatorCapacityUsdc,
      usdcLiquidity: config.operatorCapacityUsdc,
      reservedUsdc: 0n,
      riskUsdc: 0n,
      activeAcceptedOrders: dynamic.activeAcceptedOrders,
      maxActiveAcceptedOrders: 1,
      openOfferCount: dynamic.openOffers.length,
      openOfferUsdc: openOfferTotal,
      virtualFinish: null,
      lastAssignedAt: dynamic.lastAcceptedOrAssignedAt,
      lastAcceptedAt: dynamic.lastAcceptedOrAssignedAt,
      recentFailureTier: dynamic.recentFailureTier,
      channels,
      observedAtBlock: snapshotBlock,
      observedAtBlockHash: snapshotBlockHash,
    });
    operators.push({
      operatorId,
      failureDomainId,
      wallets: [wallet],
      acceptedUsdc: dynamic.acceptedUsdc,
      virtualFinishQ: dynamic.virtualFinishQ,
      openOffers: dynamic.openOffers,
      activeAcceptedOrders: dynamic.activeAcceptedOrders,
      maxActiveAcceptedOrders: 1,
      recentFailureTier: dynamic.recentFailureTier,
      lastAcceptedOrAssignedAt: dynamic.lastAcceptedOrAssignedAt,
    });
  }

  const orderId = fixtureBytes32(
    canonicalJson({
      schema: "p2pflow.simulation-order.v1",
      seed: state.seed,
      sequence: state.sequence,
    }),
  );
  const orderSide = "BUY" as const;
  return {
    capability: SHADOW_CAPABILITY,
    order: {
      chainId: config.chainId,
      diamond: config.diamond,
      orderId,
      round: 1n,
      side: orderSide,
      user: fixtureAddress(900_000),
      usdcAmount: state.usdcAmount,
      fiatAmount: state.usdcAmount * config.fiatAtomsPerUsdcAtom,
      quoteHash: fixtureBytes32(`${state.seed}:quote:${state.sequence}`),
      snapshotBlock,
      snapshotBlockHash,
      validUntil,
      domain: {
        chainId: config.chainId,
        fiatCurrency: config.fiatCurrency,
        paymentRailGroup: config.paymentRailGroup,
        orderSide,
      },
    },
    candidates,
    operators,
    history: state.history,
    universe: {
      complete: true,
      pageCount: Math.max(1, Math.ceil(candidates.length / 3)),
      expectedEntryCount:
        config.operatorCount * config.channelsPerOperator,
      finalizedBlock: snapshotBlock,
      finalizedBlockHash: snapshotBlockHash,
    },
    policy: config.policy,
    shadowPolicy: config.shadowPolicy,
    domainEpoch: config.domainEpoch,
    sequence: state.sequence,
    domainFloorQ: state.domainFloorQ,
    assignedAt,
    quoteDeadline:
      validUntil + BigInt(config.quoteDeadlineExtraSeconds),
    helperBuildVersion: config.helperBuildVersion,
    helperBuildHash: config.helperBuildHash,
    authoritativeEligibility: state.authoritativeEligibility,
  };
}

export function fixtureAddress(index: number): Address {
  if (!Number.isSafeInteger(index) || index <= 0) {
    throw new RangeError("Fixture address index must be positive");
  }
  return `0x${index.toString(16).padStart(40, "0")}` as Address;
}

export function fixtureBytes32(label: string): Bytes32 {
  if (label.length === 0) {
    throw new TypeError("Fixture hash label must not be empty");
  }
  const cacheable = /^(operator|failure-domain|channel):/.test(label);
  const cached = cacheable
    ? stableFixtureIdentityCache.get(label)
    : undefined;
  if (cached !== undefined) return cached;
  const digest = hashCanonicalPayloadText(
    canonicalJson({
      schema: "p2pflow.fixture-identity.v1",
      label,
    }),
  );
  if (cacheable) stableFixtureIdentityCache.set(label, digest);
  return digest;
}

function validateFixtureConfig(
  config: SimulationFixtureConfig,
  state: SimulationFixtureState,
): void {
  if (
    !Number.isSafeInteger(config.operatorCount) ||
    config.operatorCount <= 0 ||
    !Number.isSafeInteger(config.channelsPerOperator) ||
    config.channelsPerOperator <= 0 ||
    !Number.isSafeInteger(config.failureDomainModulo) ||
    config.failureDomainModulo <= 0 ||
    config.failureDomainModulo > config.operatorCount ||
    config.operatorCapacityUsdc <= 0n ||
    config.channelFiatPrincipalUsdc < 0n ||
    config.channelGrossFiat < 0n ||
    config.fiatAtomsPerUsdcAtom <= 0n ||
    config.startBlock < 0n ||
    config.startTimestamp < 0n ||
    !Number.isSafeInteger(config.quoteDeadlineExtraSeconds) ||
    config.quoteDeadlineExtraSeconds < 0
  ) {
    throw new RangeError("Simulation fixture configuration is invalid");
  }
  if (state.operatorStates.length !== config.operatorCount) {
    throw new RangeError("Simulation operator-state count mismatch");
  }
  const indexes = new Set<number>();
  for (const operator of state.operatorStates) {
    if (
      !Number.isSafeInteger(operator.operatorIndex) ||
      operator.operatorIndex < 0 ||
      operator.operatorIndex >= config.operatorCount ||
      indexes.has(operator.operatorIndex)
    ) {
      throw new RangeError("Simulation operator indexes must be complete");
    }
    indexes.add(operator.operatorIndex);
  }
}
