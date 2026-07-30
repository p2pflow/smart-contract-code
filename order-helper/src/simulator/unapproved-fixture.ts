import type {
  SelectionPolicyMaterial,
  ShadowSelectionPolicy,
} from "../selection";
import { selectionPolicyHash } from "../selection";
import {
  SimulationFixtureConfig,
  fixtureBytes32,
} from "./fixture";
import { JAIN_SCALE } from "./fairness";
import {
  MIN_PRODUCTION_SHAPED_SIMULATION_ORDERS,
  SimulationConfig,
} from "./simulator";

const USDC = 1_000_000n;

/**
 * Every value returned here is an offline fixture, not a governance approval.
 */
export function explicitUnapprovedSimulationFixture(): SimulationFixtureConfig {
  const shadowPolicy: ShadowSelectionPolicy = {
    schema: "p2pflow.shadow-selection-policy.v1",
    readinessReserveF: 1,
    minimumFinalAcceptanceWindowSeconds: 15,
    allowUnlimitedChannelLimits: false,
    concentrationWindowSequences: 32,
    maxRankZeroPerOperatorInWindow: 8,
    nonresponseCooldownSequences: 4n,
    cohortExpansionPerCoolingOperator: 1,
    maxCohortExpansion: 4,
  };
  const policyMaterial: SelectionPolicyMaterial = {
    version: "unapproved-offline-wfq-v2",
    candidateCount: 4,
    assignmentTtlSeconds: 90,
    leaseStepSeconds: 15,
    maxStateAgeBlocks: 20,
    maxPendingOffersPerMerchant: 8,
    openOfferWeightNumerator: 1n,
    openOfferWeightDenominator: 4n,
    targetFiatShareBps: 5_000,
    buySafetyBufferBps: 500,
    minBuySafetyBufferUsdc: 1n * USDC,
    maxPriceDeviationBps: 100,
    minMerchantStakeUsdc: 300n * USDC,
    minOrderUsdc: 1n * USDC,
    maxOrderUsdc: 500n * USDC,
    acceptedOrderTimeoutSeconds: 900,
    disputeWindowSeconds: 600,
  };
  return {
    chainId: 84_532,
    diamond: "0xF40AD901CCfB5E5EdC5162D6Ac7DDd5Ed5899F3A",
    fiatCurrency: "INR",
    paymentRailGroup: "FIXTURE_RAIL",
    domainEpoch: fixtureBytes32("unapproved-domain-epoch-v1"),
    helperBuildVersion: "offline-simulator-v2",
    helperBuildHash: fixtureBytes32("offline-simulator-build-v2"),
    policy: {
      ...policyMaterial,
      policyHash: selectionPolicyHash(policyMaterial, shadowPolicy),
    },
    shadowPolicy,
    operatorCount: 6,
    channelsPerOperator: 1,
    failureDomainModulo: 6,
    operatorCapacityUsdc: 1_000_000n * USDC,
    channelFiatPrincipalUsdc: 500_000n * USDC,
    channelGrossFiat: 100_000_000_000_000n,
    channelLimitUsdc: 10_000_000n * USDC,
    fiatAtomsPerUsdcAtom: 90n,
    startBlock: 50_000_000n,
    startTimestamp: 2_000_000_000n,
    quoteDeadlineExtraSeconds: 30,
  };
}

export function explicitUnapprovedSimulationConfig(
  orderCount: number = MIN_PRODUCTION_SHAPED_SIMULATION_ORDERS,
  seed: string = "p2pflow-shadow-simulation-v2",
): SimulationConfig {
  return {
    fixture: explicitUnapprovedSimulationFixture(),
    seed,
    orderCount,
    orderSizesUsdc: [
      1n * USDC,
      5n * USDC,
      10n * USDC,
      25n * USDC,
      50n * USDC,
      100n * USDC,
      500n * USDC,
    ],
    offlineCycleLength: 2_000,
    offlineDuration: 100,
    leaseFallbackEvery: 97,
    canonicalReorgEvery: 997,
    duplicateAcceptanceEvery: 991,
    syntheticOpenOfferEvery: 211,
    syntheticOpenOfferSlots: 2,
    walletRotationEvery: 25_000,
    stateCheckpointEvery: 10_000,
    comparableEligibilityMinimumBps: 9_000,
    minimumAcceptedServiceDecisions: 1,
    jainTargetScaled: (JAIN_SCALE * 98n) / 100n,
    jainScale: JAIN_SCALE,
    maxMinAllowanceUsdc: 1_000n * USDC,
  };
}
