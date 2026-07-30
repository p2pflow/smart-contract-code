import { canonicalJson } from "../canonical/canonical-json";
import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_DIAMOND_ADDRESS,
} from "../authority";
import {
  Bytes32,
  CandidateSnapshot,
  ChannelSnapshot,
  EligibilityResult,
  ExcludedCandidate,
  RankedCandidate,
} from "../domain/types";
import {
  isCanonicalCurrencyCode,
  isCanonicalRailGroup,
  isCanonicalVersionIdentifier,
} from "../domain/validation";
import {
  canonicalMerkleRoot,
  canonicalShadowEnvelope,
  decisionIdForEnvelope,
  hashCanonicalPayloadText,
} from "./canonical";
import {
  checkAuthoritativeEligibility,
  evaluateSnapshotEligibility,
} from "./eligibility";
import {
  compareBaseCandidates,
  compareRecoveryCandidates,
  isOperatorCooling,
  rankZeroConcentrationCount,
} from "./history";
import {
  leaseSchedule,
  validateTimingRunway,
} from "./leases";
import {
  baseVirtualFinishQ,
  forecastAcceptanceFinishQ,
  liveOfferUsdc,
  offerLoadQ,
  operatorInventoryImbalanceBps,
  rankingFinishQ,
} from "./math";
import {
  NormalizedSelectionInputs,
  normalizeSelectionInputs,
} from "./normalization";
import { canonicalPolicyWitness, selectionPolicyHash } from "./policy-witness";
import {
  CanonicalCandidateOutput,
  CanonicalEligibilityPrestate,
  CanonicalShadowDecisionEnvelope,
  CanonicalShadowSelectionWitness,
  CanonicalShadowWitnessOutput,
  CollapsedOperatorCandidate,
  OperatorRoutingSnapshot,
  RankedCandidateTuple,
  SelectionArtifacts,
  SelectionInput,
  ShadowNoServiceReason,
  ShadowSelectionResult,
  SHADOW_CAPABILITY,
} from "./types";

interface EvaluatedChannel {
  readonly candidate: CandidateSnapshot;
  readonly channel: ChannelSnapshot | null;
  readonly result: EligibilityResult;
}

interface CanonicalWitnessArtifact {
  readonly canonicalWitness: string;
  readonly witnessContentId: Bytes32;
}

export class ShadowSelectionInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ShadowSelectionInputError";
  }
}

export async function selectOrder(
  input: SelectionInput,
): Promise<ShadowSelectionResult> {
  validateSelectionInput(input);
  const normalized = normalizeSelectionInputs(input);
  const universeRoot = canonicalMerkleRoot(
    "p2pflow.candidate-universe.v1",
    normalized.universeEntries,
  );
  const artifacts = await evaluateCandidates(input, normalized);
  const sortedPrestates = [...artifacts.prestates].sort(comparePrestates);
  const eligibilityPrestateRoot = canonicalMerkleRoot(
    "p2pflow.eligibility-prestate.v2",
    sortedPrestates,
  );

  const eligibleOperatorCount = artifacts.collapsed.length;
  const requiredReadiness =
    input.policy.candidateCount + input.shadowPolicy.readinessReserveF;
  if (eligibleOperatorCount < input.policy.candidateCount) {
    return noServiceResult(
      input,
      normalized,
      artifacts,
      sortedPrestates,
      universeRoot,
      eligibilityPrestateRoot,
      "NO_FOUR_ELIGIBLE_OPERATORS",
    );
  }
  if (eligibleOperatorCount < requiredReadiness) {
    return noServiceResult(
      input,
      normalized,
      artifacts,
      sortedPrestates,
      universeRoot,
      eligibilityPrestateRoot,
      "READINESS_GATE",
    );
  }
  const distinctFailureDomains = new Set(
    artifacts.collapsed.map((candidate) =>
      candidate.operator.failureDomainId.toLowerCase()
    ),
  ).size;
  if (distinctFailureDomains < requiredReadiness) {
    return noServiceResult(
      input,
      normalized,
      artifacts,
      sortedPrestates,
      universeRoot,
      eligibilityPrestateRoot,
      "FAILURE_DOMAIN_GATE",
    );
  }

  const selected = selectBoundedCohort(input, artifacts.collapsed);
  if (selected.length !== input.policy.candidateCount) {
    return noServiceResult(
      input,
      normalized,
      artifacts,
      sortedPrestates,
      universeRoot,
      eligibilityPrestateRoot,
      "FAILURE_DOMAIN_GATE",
    );
  }

  const schedule = leaseSchedule(
    input.assignedAt,
    input.order.validUntil,
    input.policy.leaseStepSeconds,
  );
  const ranked = toRankedTuple(selected, schedule);
  const canonicalCandidates: readonly CanonicalCandidateOutput[] = ranked.map(
    (candidate, index) => {
      const collapsed = selected[index];
      if (collapsed === undefined) {
        throw new Error("Selected operator lookup failed");
      }
      return {
        operatorId: collapsed.operator.operatorId,
        failureDomainId: collapsed.operator.failureDomainId,
        merchant: candidate.merchant,
        channelId: candidate.channelId,
        rank: candidate.rank,
        rankingFinishQ: candidate.rankingFinish,
        forecastFinishQ: candidate.commitFinish,
        unlockAt: candidate.unlockAt,
      };
    },
  );
  const outputRoot = canonicalMerkleRoot(
    "p2pflow.shadow-output.v2",
    [{ candidates: canonicalCandidates, leaseSchedule: schedule }],
  );
  const witness = buildCanonicalSelectionWitness(
    input,
    normalized,
    artifacts,
    sortedPrestates,
    {
      serviceStatus: "SHADOW_DECISION",
      noServiceReason: null,
      candidates: canonicalCandidates,
      leaseSchedule: schedule,
      outputRoot,
    },
  );
  const envelope: CanonicalShadowDecisionEnvelope = {
    schema: "p2pflow.shadow-assignment-decision.v2",
    capability: SHADOW_CAPABILITY,
    chainId: input.order.chainId,
    diamond: input.order.diamond,
    orderId: input.order.orderId,
    round: input.order.round,
    routingDomain: input.order.domain,
    domainEpoch: input.domainEpoch,
    sequence: input.sequence,
    stateBlock: input.order.snapshotBlock,
    stateBlockHash: input.order.snapshotBlockHash,
    assignedAt: input.assignedAt,
    validUntil: input.order.validUntil,
    quoteDeadline: input.quoteDeadline,
    quoteHash: input.order.quoteHash,
    policyHash: input.policy.policyHash,
    helperBuildHash: input.helperBuildHash,
    witnessContentId: witness.witnessContentId,
    universeCount: normalized.universeEntries.length,
    universeRoot,
    eligibilityPrestateRoot,
    candidates: canonicalCandidates,
    leaseSchedule: schedule,
    outputRoot,
  };
  const canonicalPayload = canonicalShadowEnvelope(envelope);
  const decisionId = decisionIdForEnvelope(envelope);

  return {
    outcome: {
      order: input.order,
      policy: input.policy,
      candidates: ranked,
      excluded: artifacts.excluded,
      decisionId,
      helperBuildVersion: input.helperBuildVersion,
    },
    trace: {
      capability: SHADOW_CAPABILITY,
      actionAuthorization: false,
      serviceStatus: "SHADOW_DECISION",
      noServiceReason: null,
      universeCount: normalized.universeEntries.length,
      universeRoot,
      eligibilityPrestateRoot,
      outputRoot,
      witnessContentId: witness.witnessContentId,
      canonicalWitness: witness.canonicalWitness,
      canonicalPayload,
      traceId: decisionId,
      envelope,
      selectedOperatorIds: selected.map(
        (candidate) => candidate.operator.operatorId,
      ),
      forecastOnly: true,
    },
  };
}

async function evaluateCandidates(
  input: SelectionInput,
  normalized: ReturnType<typeof normalizeSelectionInputs>,
): Promise<SelectionArtifacts> {
  const prestates: CanonicalEligibilityPrestate[] = [];
  const excluded: ExcludedCandidate[] = [];
  const collapsed: CollapsedOperatorCandidate[] = [];

  for (const operator of normalized.operators) {
    const operatorCandidates = normalized.candidates.filter((candidate) =>
      operator.wallets.some(
        (wallet) => wallet.toLowerCase() === candidate.merchant.toLowerCase(),
      )
    );
    const baseFinish = baseVirtualFinishQ(operator, input.domainFloorQ);
    const offerUsdc = liveOfferUsdc(operator.openOffers);
    const offersQ = offerLoadQ(offerUsdc, input.policy);
    const rankingFinish = rankingFinishQ(
      baseFinish,
      offersQ,
      input.order.usdcAmount,
    );
    const forecastFinish = forecastAcceptanceFinishQ(
      baseFinish,
      input.order.usdcAmount,
    );
    const inventory = operatorInventoryImbalanceBps(
      input.order.side,
      input.order.usdcAmount,
      operatorCandidates,
      input.policy.targetFiatShareBps,
    );
    const cooling = isOperatorCooling(
      operator,
      normalized.history,
      input.sequence,
      input.shadowPolicy,
    );
    const concentration = rankZeroConcentrationCount(
      operator,
      normalized.history,
      input.sequence,
      input.shadowPolicy,
    );
    const openOfferRoot = canonicalMerkleRoot(
      "p2pflow.operator-open-offers.v1",
      operator.openOffers,
    );

    const pending: Promise<EvaluatedChannel>[] = [];
    for (const candidate of operatorCandidates) {
      if (candidate.channels.length === 0) {
        pending.push(
          Promise.resolve({
            candidate,
            channel: null,
            result: snapshotResult(
              "CHANNEL_NOT_APPROVED",
              input.order.snapshotBlock,
            ),
          }),
        );
        continue;
      }
      for (const channel of candidate.channels) {
        const local = evaluateSnapshotEligibility(
          input.order,
          candidate,
          channel,
          input.policy,
          input.shadowPolicy,
          {
            openOfferCount: operator.openOffers.length,
            activeAcceptedOrders: operator.activeAcceptedOrders,
            maxActiveAcceptedOrders: operator.maxActiveAcceptedOrders,
          },
        );
        pending.push(
          local.code === "ELIGIBLE"
            ? checkAuthoritativeEligibility(
                input.authoritativeEligibility,
                input.order,
                candidate.merchant,
                channel.channelId,
                local.required,
              ).then((result) => ({ candidate, channel, result }))
            : Promise.resolve({ candidate, channel, result: local }),
        );
      }
    }

    const evaluated = await Promise.all(pending);
    for (const entry of evaluated) {
      prestates.push({
        operatorId: operator.operatorId,
        failureDomainId: operator.failureDomainId,
        merchant: entry.candidate.merchant,
        channelId: entry.channel?.channelId ?? null,
        eligibilityCode: entry.result.code,
        required: entry.result.required,
        available: entry.result.available,
        source: entry.result.source,
        checkedAtBlock: entry.result.checkedAtBlock,
        operatorAcceptedUsdc: operator.acceptedUsdc,
        operatorVirtualFinishQ: operator.virtualFinishQ,
        baseVirtualFinishQ: baseFinish,
        openOfferCount: operator.openOffers.length,
        openOfferRoot,
        liveOfferUsdc: offerUsdc,
        offerLoadQ: offersQ,
        activeAcceptedOrders: operator.activeAcceptedOrders,
        maxActiveAcceptedOrders: operator.maxActiveAcceptedOrders,
        rankingFinishQ: rankingFinish,
        forecastFinishQ: forecastFinish,
        inventoryImbalanceBps: inventory,
        cooling,
        concentrationCount: concentration,
      });
      if (entry.result.code !== "ELIGIBLE") {
        excluded.push({
          merchant: entry.candidate.merchant,
          channelId: entry.channel?.channelId ?? null,
          result: privacyMinimizedEligibility(entry.result),
        });
      }
    }

    const eligible = evaluated
      .filter(
        (
          entry,
        ): entry is EvaluatedChannel & { readonly channel: ChannelSnapshot } =>
          entry.channel !== null && entry.result.code === "ELIGIBLE",
      )
      .sort((left, right) => {
        const merchant = left.candidate.merchant.toLowerCase().localeCompare(
          right.candidate.merchant.toLowerCase(),
        );
        if (merchant !== 0) return merchant;
        return left.channel.channelId.toLowerCase().localeCompare(
          right.channel.channelId.toLowerCase(),
        );
      });
    const chosen = eligible[0];
    if (chosen === undefined) continue;
    collapsed.push({
      operator,
      merchant: chosen.candidate.merchant,
      channelId: chosen.channel.channelId,
      rankingFinishQ: rankingFinish,
      forecastFinishQ: forecastFinish,
      inventoryImbalanceBps: inventory,
      deterministicTieBreak: deterministicTieBreak(
        input,
        operator,
        chosen.candidate,
        chosen.channel,
      ),
      cooling,
      concentrationCount: concentration,
      lastAcceptedOrAssignedAt: operator.lastAcceptedOrAssignedAt,
    });
  }

  return {
    universeEntries: normalized.universeEntries,
    prestates,
    excluded: excluded.sort(compareExclusions),
    collapsed,
  };
}

function selectBoundedCohort(
  input: SelectionInput,
  candidates: readonly CollapsedOperatorCandidate[],
): readonly CollapsedOperatorCandidate[] {
  const baseSorted = [...candidates].sort((left, right) =>
    compareBaseCandidates(left, right, input.shadowPolicy)
  );
  const base = baseSorted.slice(0, input.policy.candidateCount);
  const coolingCount = base.filter((candidate) => candidate.cooling).length;
  const requestedExpansion = Math.max(
    input.shadowPolicy.readinessReserveF,
    coolingCount *
      input.shadowPolicy.cohortExpansionPerCoolingOperator,
  );
  const expansion = Math.min(
    input.shadowPolicy.maxCohortExpansion,
    requestedExpansion,
  );
  const cohort = baseSorted
    .slice(0, input.policy.candidateCount + expansion)
    .sort((left, right) =>
      compareRecoveryCandidates(left, right, input.shadowPolicy)
    );
  const selected: CollapsedOperatorCandidate[] = [];
  const failureDomains = new Set<string>();
  for (const candidate of cohort) {
    const failureDomain = candidate.operator.failureDomainId.toLowerCase();
    if (failureDomains.has(failureDomain)) continue;
    failureDomains.add(failureDomain);
    selected.push(candidate);
    if (selected.length === input.policy.candidateCount) break;
  }
  return selected;
}

function toRankedTuple(
  selected: readonly CollapsedOperatorCandidate[],
  schedule: ReturnType<typeof leaseSchedule>,
): RankedCandidateTuple {
  if (selected.length !== 4 || schedule.length !== 4) {
    throw new RangeError("Shadow decisions require exactly four candidates");
  }
  const ranks = [0, 1, 2, 3] as const;
  const ranked = ranks.map((rank) => {
    const candidate = selected[rank];
    const lease = schedule[rank];
    if (candidate === undefined || lease === undefined) {
      throw new Error("Rank construction failed");
    }
    const value: RankedCandidate = {
      merchant: candidate.merchant,
      channelId: candidate.channelId,
      rank,
      rankingFinish: candidate.rankingFinishQ,
      commitFinish: candidate.forecastFinishQ,
      inventoryImbalanceBps: candidate.inventoryImbalanceBps,
      recentFailureTier: candidate.operator.recentFailureTier,
      lastAcceptedOrAssignedAt: candidate.lastAcceptedOrAssignedAt,
      deterministicTieBreak: candidate.deterministicTieBreak,
      unlockAt: lease.unlockAt,
    };
    return value;
  });
  return ranked as unknown as RankedCandidateTuple;
}

function deterministicTieBreak(
  input: SelectionInput,
  operator: OperatorRoutingSnapshot,
  candidate: CandidateSnapshot,
  channel: ChannelSnapshot,
): `0x${string}` {
  return hashCanonicalPayloadText(
    canonicalJson({
      schema: "p2pflow.operator-tiebreak.v2",
      domainEpoch: input.domainEpoch,
      sequence: input.sequence,
      orderId: input.order.orderId,
      round: input.order.round,
      operatorId: operator.operatorId,
      merchant: candidate.merchant,
      channelId: channel.channelId,
    }),
  );
}

function buildCanonicalSelectionWitness(
  input: SelectionInput,
  normalized: NormalizedSelectionInputs,
  artifacts: SelectionArtifacts,
  sortedPrestates: readonly CanonicalEligibilityPrestate[],
  output: CanonicalShadowWitnessOutput,
): CanonicalWitnessArtifact {
  const witness: CanonicalShadowSelectionWitness = {
    schema: "p2pflow.shadow-selection-witness.v1",
    capability: SHADOW_CAPABILITY,
    actionAuthorization: false,
    input: {
      order: input.order,
      candidates: normalized.candidates,
      operators: normalized.operators,
      history: normalized.history,
      universe: { ...input.universe },
      canonicalPolicyWitness: canonicalPolicyWitness(
        input.policy,
        input.shadowPolicy,
      ),
      domainEpoch: input.domainEpoch,
      sequence: input.sequence,
      domainFloorQ: input.domainFloorQ,
      assignedAt: input.assignedAt,
      quoteDeadline: input.quoteDeadline,
      helperBuildVersion: input.helperBuildVersion,
      helperBuildHash: input.helperBuildHash,
    },
    universeEntries: normalized.universeEntries,
    eligibilityPrestates: sortedPrestates,
    exclusions: [...artifacts.excluded].sort(compareExclusions),
    output,
  };
  const canonicalWitnessText = canonicalJson(witness);
  return {
    canonicalWitness: canonicalWitnessText,
    witnessContentId: hashCanonicalPayloadText(canonicalWitnessText),
  };
}

function noServiceResult(
  input: SelectionInput,
  normalized: NormalizedSelectionInputs,
  artifacts: SelectionArtifacts,
  sortedPrestates: readonly CanonicalEligibilityPrestate[],
  universeRoot: `0x${string}`,
  eligibilityPrestateRoot: `0x${string}`,
  reason: ShadowNoServiceReason,
): ShadowSelectionResult {
  const outputRoot = canonicalMerkleRoot(
    "p2pflow.shadow-no-service-output.v2",
    [{ reason }],
  );
  const witness = buildCanonicalSelectionWitness(
    input,
    normalized,
    artifacts,
    sortedPrestates,
    {
      serviceStatus: "NO_SERVICE",
      noServiceReason: reason,
      candidates: [],
      leaseSchedule: [],
      outputRoot,
    },
  );
  const payload = canonicalJson({
    schema: "p2pflow.shadow-no-service.v2",
    capability: SHADOW_CAPABILITY,
    actionAuthorization: false,
    chainId: input.order.chainId,
    diamond: input.order.diamond,
    orderId: input.order.orderId,
    round: input.order.round,
    routingDomain: input.order.domain,
    domainEpoch: input.domainEpoch,
    sequence: input.sequence,
    stateBlock: input.order.snapshotBlock,
    stateBlockHash: input.order.snapshotBlockHash,
    quoteHash: input.order.quoteHash,
    policyHash: input.policy.policyHash,
    helperBuildHash: input.helperBuildHash,
    witnessContentId: witness.witnessContentId,
    universeCount: normalized.universeEntries.length,
    universeRoot,
    eligibilityPrestateRoot,
    outputRoot,
    reason,
  });
  return {
    outcome: {
      order: input.order,
      policy: input.policy,
      status: "NO_FOUR_CANDIDATES",
      eligibleMerchantCount: artifacts.collapsed.length,
      excluded: artifacts.excluded,
      helperBuildVersion: input.helperBuildVersion,
    },
    trace: {
      capability: SHADOW_CAPABILITY,
      actionAuthorization: false,
      serviceStatus: "NO_SERVICE",
      noServiceReason: reason,
      universeCount: normalized.universeEntries.length,
      universeRoot,
      eligibilityPrestateRoot,
      outputRoot,
      witnessContentId: witness.witnessContentId,
      canonicalWitness: witness.canonicalWitness,
      canonicalPayload: payload,
      traceId: hashCanonicalPayloadText(payload),
      envelope: null,
      selectedOperatorIds: [],
      forecastOnly: true,
    },
  };
}

function validateSelectionInput(input: SelectionInput): void {
  if (input.capability !== SHADOW_CAPABILITY) {
    throw new ShadowSelectionInputError(
      "Selector is restricted to transaction-disabled shadow output",
    );
  }
  assertBytes32(input.domainEpoch, "domainEpoch");
  assertBytes32(input.helperBuildHash, "helperBuildHash");
  assertBytes32(input.policy.policyHash, "policyHash");
  if (
    /^0x0{64}$/i.test(input.domainEpoch) ||
    /^0x0{64}$/i.test(input.helperBuildHash) ||
    /^0x0{64}$/i.test(input.policy.policyHash)
  ) {
    throw new ShadowSelectionInputError(
      "Domain, build, and policy identities must be nonzero",
    );
  }
  if (
    !Number.isSafeInteger(input.order.chainId) ||
    input.order.chainId !== BASE_SEPOLIA_CHAIN_ID
  ) {
    throw new ShadowSelectionInputError(
      "Selector is pinned to Base Sepolia chain 84532",
    );
  }
  if (
    !/^0x[0-9a-fA-F]{40}$/.test(input.order.diamond) ||
    input.order.diamond.toLowerCase() !==
      BASE_SEPOLIA_DIAMOND_ADDRESS.toLowerCase()
  ) {
    throw new ShadowSelectionInputError(
      "Selector is pinned to the documented Base Sepolia Diamond",
    );
  }
  if (
    input.order.domain.chainId !== input.order.chainId ||
    input.order.domain.orderSide !== input.order.side
  ) {
    throw new ShadowSelectionInputError("Routing domain/order mismatch");
  }
  if (
    !isCanonicalCurrencyCode(input.order.domain.fiatCurrency) ||
    !isCanonicalRailGroup(input.order.domain.paymentRailGroup)
  ) {
    throw new ShadowSelectionInputError(
      "Routing domain must use canonical public codes",
    );
  }
  if (
    input.order.usdcAmount < input.policy.minOrderUsdc ||
    input.order.usdcAmount > input.policy.maxOrderUsdc ||
    input.order.usdcAmount <= 0n
  ) {
    throw new ShadowSelectionInputError(
      "Order amount is outside the explicit fixture bounds",
    );
  }
  if (
    input.sequence < 0n ||
    input.domainFloorQ < 0n ||
    !isCanonicalVersionIdentifier(input.helperBuildVersion)
  ) {
    throw new ShadowSelectionInputError(
      "Sequence, domain floor, and canonical build version are required",
    );
  }
  validateSelectionPolicy(input);
  const expectedPolicyHash = selectionPolicyHash(
    input.policy,
    input.shadowPolicy,
  );
  if (input.policy.policyHash.toLowerCase() !== expectedPolicyHash.toLowerCase()) {
    throw new ShadowSelectionInputError(
      "Policy hash does not match the canonical Council-bound policy witness",
    );
  }
  validateTimingRunway(
    input.assignedAt,
    input.order.validUntil,
    input.quoteDeadline,
    input.policy,
    input.shadowPolicy,
  );
}

function validateSelectionPolicy(input: SelectionInput): void {
  const policy = input.policy;
  const shadow = input.shadowPolicy;
  if (
    policy.candidateCount !== 4 ||
    !isCanonicalVersionIdentifier(policy.version) ||
    policy.assignmentTtlSeconds <= 0 ||
    policy.leaseStepSeconds <= 0 ||
    policy.maxStateAgeBlocks <= 0 ||
    policy.maxPendingOffersPerMerchant <= 0 ||
    policy.openOfferWeightNumerator < 0n ||
    policy.openOfferWeightDenominator <= 0n ||
    policy.openOfferWeightNumerator >= policy.openOfferWeightDenominator ||
    policy.targetFiatShareBps < 0 ||
    policy.targetFiatShareBps > 10_000 ||
    policy.buySafetyBufferBps < 0 ||
    policy.buySafetyBufferBps > 10_000 ||
    policy.minBuySafetyBufferUsdc < 0n ||
    policy.maxPriceDeviationBps <= 0 ||
    policy.maxPriceDeviationBps > 10_000 ||
    policy.minMerchantStakeUsdc <= 0n ||
    policy.minOrderUsdc <= 0n ||
    policy.maxOrderUsdc < policy.minOrderUsdc ||
    policy.acceptedOrderTimeoutSeconds <= 0 ||
    policy.disputeWindowSeconds <= 0
  ) {
    throw new ShadowSelectionInputError(
      "Selection policy is missing an explicit risk fixture",
    );
  }
  if (
    shadow.schema !== "p2pflow.shadow-selection-policy.v1" ||
    !Number.isSafeInteger(shadow.readinessReserveF) ||
    shadow.readinessReserveF < 0 ||
    !Number.isSafeInteger(shadow.minimumFinalAcceptanceWindowSeconds) ||
    shadow.minimumFinalAcceptanceWindowSeconds <= 0 ||
    !Number.isSafeInteger(shadow.concentrationWindowSequences) ||
    shadow.concentrationWindowSequences <= 0 ||
    !Number.isSafeInteger(shadow.maxRankZeroPerOperatorInWindow) ||
    shadow.maxRankZeroPerOperatorInWindow <= 0 ||
    shadow.maxRankZeroPerOperatorInWindow >
      shadow.concentrationWindowSequences ||
    shadow.nonresponseCooldownSequences <= 0n ||
    !Number.isSafeInteger(shadow.cohortExpansionPerCoolingOperator) ||
    shadow.cohortExpansionPerCoolingOperator <= 0 ||
    !Number.isSafeInteger(shadow.maxCohortExpansion) ||
    shadow.maxCohortExpansion < shadow.readinessReserveF
  ) {
    throw new ShadowSelectionInputError(
      "Shadow policy is missing an explicit recovery/readiness fixture",
    );
  }
}

function comparePrestates(
  left: CanonicalEligibilityPrestate,
  right: CanonicalEligibilityPrestate,
): number {
  const operator = left.operatorId.toLowerCase().localeCompare(
    right.operatorId.toLowerCase(),
  );
  if (operator !== 0) return operator;
  const merchant = left.merchant.toLowerCase().localeCompare(
    right.merchant.toLowerCase(),
  );
  if (merchant !== 0) return merchant;
  return (left.channelId ?? "").toLowerCase().localeCompare(
    (right.channelId ?? "").toLowerCase(),
  );
}

function compareExclusions(
  left: ExcludedCandidate,
  right: ExcludedCandidate,
): number {
  const merchant = left.merchant.toLowerCase().localeCompare(
    right.merchant.toLowerCase(),
  );
  if (merchant !== 0) return merchant;
  return (left.channelId ?? "").toLowerCase().localeCompare(
    (right.channelId ?? "").toLowerCase(),
  );
}

function privacyMinimizedEligibility(
  eligibility: EligibilityResult,
): Omit<EligibilityResult, "detail"> {
  return {
    code: eligibility.code,
    required: eligibility.required,
    available: eligibility.available,
    source: eligibility.source,
    checkedAtBlock: eligibility.checkedAtBlock,
  };
}

function snapshotResult(
  code: EligibilityResult["code"],
  checkedAtBlock: bigint,
): EligibilityResult {
  return {
    code,
    required: 0n,
    available: 0n,
    source: "snapshot",
    checkedAtBlock,
  };
}

function assertBytes32(value: string, name: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError(`${name} must be a 32-byte hexadecimal value`);
  }
}
