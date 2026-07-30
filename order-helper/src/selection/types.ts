import {
  Address,
  AuthoritativeEligibilityAdapter,
  Bytes32,
  CandidateSnapshot,
  DecisionOutcome,
  ExcludedCandidate,
  EligibilityResult,
  OrderSnapshot,
  RankedCandidate,
  RoutingDomain,
  SelectionPolicy,
} from "../domain/types";
import type { CanonicalPolicyWitness } from "./policy-witness";

export const SHADOW_CAPABILITY = "TRANSACTION_DISABLED_SHADOW_ONLY" as const;
export const VIRTUAL_FINISH_SCALE = 4n;

export interface OpenOfferSlot {
  readonly slotId: Bytes32;
  readonly orderId: Bytes32;
  readonly round: bigint;
  readonly operatorId: Bytes32;
  readonly merchant: Address;
  readonly channelId: Bytes32;
  readonly usdcAmount: bigint;
  readonly openedAtSequence: bigint;
}

export interface OperatorRoutingSnapshot {
  readonly operatorId: Bytes32;
  readonly failureDomainId: Bytes32;
  readonly wallets: readonly Address[];
  readonly acceptedUsdc: bigint;
  readonly virtualFinishQ: bigint | null;
  readonly openOffers: readonly OpenOfferSlot[];
  readonly activeAcceptedOrders: number;
  readonly maxActiveAcceptedOrders: number;
  readonly recentFailureTier: number;
  readonly lastAcceptedOrAssignedAt: bigint | null;
}

export type SelectionHistoryEventKind =
  | "RANK_ZERO_ASSIGNED"
  | "RANK_ZERO_MISSED"
  | "ACCEPTED"
  | "RESPONDED";

export interface SelectionHistoryEvent {
  readonly eventId: Bytes32;
  readonly operatorId: Bytes32;
  readonly decisionId: Bytes32;
  readonly orderId: Bytes32;
  readonly round: bigint;
  readonly sequence: bigint;
  readonly kind: SelectionHistoryEventKind;
}

export interface CandidateUniverseEvidence {
  readonly complete: boolean;
  readonly pageCount: number;
  readonly expectedEntryCount: number;
  readonly finalizedBlock: bigint;
  readonly finalizedBlockHash: Bytes32;
}

/**
 * These values are explicit simulation/shadow fixtures. This interface does
 * not represent governance approval and cannot enable transaction output.
 */
export interface ShadowSelectionPolicy {
  readonly schema: "p2pflow.shadow-selection-policy.v1";
  readonly readinessReserveF: number;
  readonly minimumFinalAcceptanceWindowSeconds: number;
  readonly allowUnlimitedChannelLimits: boolean;
  readonly concentrationWindowSequences: number;
  readonly maxRankZeroPerOperatorInWindow: number;
  readonly nonresponseCooldownSequences: bigint;
  readonly cohortExpansionPerCoolingOperator: number;
  readonly maxCohortExpansion: number;
}

export interface SelectionInput {
  readonly capability: typeof SHADOW_CAPABILITY;
  readonly order: OrderSnapshot;
  readonly candidates: readonly CandidateSnapshot[];
  readonly operators: readonly OperatorRoutingSnapshot[];
  readonly history: readonly SelectionHistoryEvent[];
  readonly universe: CandidateUniverseEvidence;
  readonly policy: SelectionPolicy;
  readonly shadowPolicy: ShadowSelectionPolicy;
  readonly domainEpoch: Bytes32;
  readonly sequence: bigint;
  readonly domainFloorQ: bigint;
  readonly assignedAt: bigint;
  readonly quoteDeadline: bigint;
  readonly helperBuildVersion: string;
  readonly helperBuildHash: Bytes32;
  readonly authoritativeEligibility: AuthoritativeEligibilityAdapter;
}

export type ShadowNoServiceReason =
  | "READINESS_GATE"
  | "FAILURE_DOMAIN_GATE"
  | "NO_FOUR_ELIGIBLE_OPERATORS";

export interface CanonicalUniverseEntry {
  readonly merchant: Address;
  readonly channelId: Bytes32 | null;
  readonly candidate: CandidateSnapshot;
}

export interface CanonicalEligibilityPrestate {
  readonly operatorId: Bytes32;
  readonly failureDomainId: Bytes32;
  readonly merchant: Address;
  readonly channelId: Bytes32 | null;
  readonly eligibilityCode: string;
  readonly required: bigint;
  readonly available: bigint;
  readonly source: "snapshot" | "contract";
  readonly checkedAtBlock: bigint;
  readonly operatorAcceptedUsdc: bigint;
  readonly operatorVirtualFinishQ: bigint | null;
  readonly baseVirtualFinishQ: bigint;
  readonly openOfferCount: number;
  readonly openOfferRoot: Bytes32;
  readonly liveOfferUsdc: bigint;
  readonly offerLoadQ: bigint;
  readonly activeAcceptedOrders: number;
  readonly maxActiveAcceptedOrders: number;
  readonly rankingFinishQ: bigint;
  readonly forecastFinishQ: bigint;
  readonly inventoryImbalanceBps: bigint;
  readonly cooling: boolean;
  readonly concentrationCount: number;
}

export interface LeaseScheduleEntry {
  readonly rank: 0 | 1 | 2 | 3;
  readonly unlockAt: bigint;
  readonly intervalEnd: bigint;
}

export interface CanonicalCandidateOutput {
  readonly operatorId: Bytes32;
  readonly failureDomainId: Bytes32;
  readonly merchant: Address;
  readonly channelId: Bytes32;
  readonly rank: 0 | 1 | 2 | 3;
  readonly rankingFinishQ: bigint;
  readonly forecastFinishQ: bigint;
  readonly unlockAt: bigint;
}

export interface CanonicalShadowWitnessInput {
  readonly order: OrderSnapshot;
  readonly candidates: readonly CandidateSnapshot[];
  readonly operators: readonly OperatorRoutingSnapshot[];
  readonly history: readonly SelectionHistoryEvent[];
  readonly universe: CandidateUniverseEvidence;
  readonly canonicalPolicyWitness: CanonicalPolicyWitness;
  readonly domainEpoch: Bytes32;
  readonly sequence: bigint;
  readonly domainFloorQ: bigint;
  readonly assignedAt: bigint;
  readonly quoteDeadline: bigint;
  readonly helperBuildVersion: string;
  readonly helperBuildHash: Bytes32;
}

export interface CanonicalShadowWitnessOutput {
  readonly serviceStatus: "SHADOW_DECISION" | "NO_SERVICE";
  readonly noServiceReason: ShadowNoServiceReason | null;
  readonly candidates: readonly CanonicalCandidateOutput[];
  readonly leaseSchedule: readonly LeaseScheduleEntry[];
  readonly outputRoot: Bytes32;
}

export interface CanonicalShadowSelectionWitness {
  readonly schema: "p2pflow.shadow-selection-witness.v1";
  readonly capability: typeof SHADOW_CAPABILITY;
  readonly actionAuthorization: false;
  readonly input: CanonicalShadowWitnessInput;
  readonly universeEntries: readonly CanonicalUniverseEntry[];
  readonly eligibilityPrestates: readonly CanonicalEligibilityPrestate[];
  readonly exclusions: readonly CanonicalExcludedCandidate[];
  readonly output: CanonicalShadowWitnessOutput;
}

export interface CanonicalExcludedCandidate {
  readonly merchant: Address;
  readonly channelId: Bytes32 | null;
  readonly result: Omit<EligibilityResult, "detail">;
}

export interface CanonicalShadowDecisionEnvelope {
  readonly schema: "p2pflow.shadow-assignment-decision.v2";
  readonly capability: typeof SHADOW_CAPABILITY;
  readonly chainId: number;
  readonly diamond: Address;
  readonly orderId: Bytes32;
  readonly round: bigint;
  readonly routingDomain: RoutingDomain;
  readonly domainEpoch: Bytes32;
  readonly sequence: bigint;
  readonly stateBlock: bigint;
  readonly stateBlockHash: Bytes32;
  readonly assignedAt: bigint;
  readonly validUntil: bigint;
  readonly quoteDeadline: bigint;
  readonly quoteHash: Bytes32;
  readonly policyHash: Bytes32;
  readonly helperBuildHash: Bytes32;
  readonly witnessContentId: Bytes32;
  readonly universeCount: number;
  readonly universeRoot: Bytes32;
  readonly eligibilityPrestateRoot: Bytes32;
  readonly candidates: readonly CanonicalCandidateOutput[];
  readonly leaseSchedule: readonly LeaseScheduleEntry[];
  readonly outputRoot: Bytes32;
}

export interface ShadowSelectionTrace {
  readonly capability: typeof SHADOW_CAPABILITY;
  readonly actionAuthorization: false;
  readonly serviceStatus: "SHADOW_DECISION" | "NO_SERVICE";
  readonly noServiceReason: ShadowNoServiceReason | null;
  readonly universeCount: number;
  readonly universeRoot: Bytes32;
  readonly eligibilityPrestateRoot: Bytes32;
  readonly outputRoot: Bytes32;
  readonly witnessContentId: Bytes32;
  readonly canonicalWitness: string;
  readonly canonicalPayload: string;
  readonly traceId: Bytes32;
  readonly envelope: CanonicalShadowDecisionEnvelope | null;
  readonly selectedOperatorIds: readonly Bytes32[];
  readonly forecastOnly: true;
}

export interface ShadowSelectionResult {
  readonly outcome: DecisionOutcome;
  readonly trace: ShadowSelectionTrace;
}

export interface CollapsedOperatorCandidate {
  readonly operator: OperatorRoutingSnapshot;
  readonly merchant: Address;
  readonly channelId: Bytes32;
  readonly rankingFinishQ: bigint;
  readonly forecastFinishQ: bigint;
  readonly inventoryImbalanceBps: bigint;
  readonly deterministicTieBreak: Bytes32;
  readonly cooling: boolean;
  readonly concentrationCount: number;
  readonly lastAcceptedOrAssignedAt: bigint | null;
}

export interface SelectionArtifacts {
  readonly universeEntries: readonly CanonicalUniverseEntry[];
  readonly prestates: readonly CanonicalEligibilityPrestate[];
  readonly excluded: readonly ExcludedCandidate[];
  readonly collapsed: readonly CollapsedOperatorCandidate[];
}

export type RankedCandidateTuple = readonly [
  RankedCandidate,
  RankedCandidate,
  RankedCandidate,
  RankedCandidate,
];
