export type Address = `0x${string}`;
export type Bytes32 = `0x${string}`;
export type ChainId = number;
export type UsdcAtoms = bigint;
export type FiatAtoms = bigint;

export type OrderSide = "BUY" | "SELL";
export type HelperMode = "shadow" | "live";

export interface RoutingDomain {
  readonly chainId: ChainId;
  readonly fiatCurrency: string;
  readonly paymentRailGroup: string;
  readonly orderSide: OrderSide;
}

export interface OrderSnapshot {
  readonly chainId: ChainId;
  readonly diamond: Address;
  readonly orderId: Bytes32;
  readonly round: bigint;
  readonly side: OrderSide;
  readonly user: Address;
  readonly usdcAmount: UsdcAtoms;
  readonly fiatAmount: FiatAtoms;
  readonly quoteHash: Bytes32;
  readonly snapshotBlock: bigint;
  readonly snapshotBlockHash: Bytes32;
  readonly validUntil: bigint;
  readonly domain: RoutingDomain;
}

export type MerchantAccountStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "BLACKLISTED"
  | "DISPUTED";

export type MerchantAvailability = "ONLINE" | "OFFLINE";
export type ChannelStatus = "PENDING" | "APPROVED" | "REJECTED" | "TERMINATED";
export type ChannelAvailability = "ACTIVE" | "INACTIVE";

export interface ChannelSnapshot {
  readonly channelId: Bytes32;
  readonly merchant: Address;
  readonly fiatCurrency: string;
  readonly paymentRailGroup: string;
  readonly status: ChannelStatus;
  readonly availability: ChannelAvailability;
  readonly grossFiat: FiatAtoms;
  readonly reservedFiat: FiatAtoms;
  readonly fiatPrincipalUsdc: UsdcAtoms;
  readonly reservedPrincipalUsdc: UsdcAtoms;
  readonly dailyVolumeUsedUsdc: UsdcAtoms;
  readonly dailyLimitUsdc: UsdcAtoms | null;
  readonly monthlyVolumeUsedUsdc: UsdcAtoms;
  readonly monthlyLimitUsdc: UsdcAtoms | null;
  readonly protocolFiatDeficit: FiatAtoms;
  readonly reconciliationRequired: boolean;
  readonly openOfferCount: number;
}

export interface CandidateSnapshot {
  readonly merchant: Address;
  readonly accountStatus: MerchantAccountStatus;
  readonly availability: MerchantAvailability;
  readonly registered: boolean;
  readonly allowlisted: boolean;
  readonly allowlistEnabled: boolean;
  readonly unstakePending: boolean;
  readonly pendingRemoval: boolean;
  readonly principalTargetUsdc: UsdcAtoms;
  readonly usdcLiquidity: UsdcAtoms;
  readonly reservedUsdc: UsdcAtoms;
  readonly riskUsdc: UsdcAtoms;
  readonly activeAcceptedOrders: number;
  readonly maxActiveAcceptedOrders: number;
  readonly openOfferCount: number;
  readonly openOfferUsdc: UsdcAtoms;
  readonly virtualFinish: bigint | null;
  readonly lastAssignedAt: bigint | null;
  readonly lastAcceptedAt: bigint | null;
  readonly recentFailureTier: number;
  readonly channels: readonly ChannelSnapshot[];
  readonly observedAtBlock: bigint;
  readonly observedAtBlockHash: Bytes32;
}

export type EligibilityCode =
  | "ELIGIBLE"
  | "SNAPSHOT_BLOCK_MISMATCH"
  | "ORDER_NOT_OPEN"
  | "WRONG_ROUND"
  | "MERCHANT_NOT_REGISTERED"
  | "ACCOUNT_NOT_ACTIVE"
  | "MERCHANT_OFFLINE"
  | "UNSTAKE_PENDING"
  | "REMOVAL_PENDING"
  | "NOT_ALLOWLISTED"
  | "CHANNEL_NOT_OWNED"
  | "CHANNEL_NOT_APPROVED"
  | "CHANNEL_INACTIVE"
  | "CHANNEL_WRONG_DOMAIN"
  | "QUOTE_EXPIRED"
  | "DAILY_LIMIT_EXCEEDED"
  | "MONTHLY_LIMIT_EXCEEDED"
  | "TOO_MANY_OPEN_OFFERS"
  | "TOO_MANY_ACTIVE_ORDERS"
  | "INSUFFICIENT_USDC"
  | "INSUFFICIENT_FIAT_PRINCIPAL"
  | "INSUFFICIENT_PHYSICAL_FIAT"
  | "PROTOCOL_FIAT_DEFICIT"
  | "RECONCILIATION_REQUIRED"
  | "MISSING_RISK_CONFIGURATION"
  | "AUTHORITATIVE_CHECK_UNAVAILABLE";

export interface EligibilityResult {
  readonly code: EligibilityCode;
  readonly required: bigint;
  readonly available: bigint;
  readonly source: "snapshot" | "contract";
  readonly checkedAtBlock: bigint;
  readonly detail?: string;
}

export interface AuthoritativeEligibilityRequest {
  readonly order: OrderSnapshot;
  readonly merchant: Address;
  readonly channelId: Bytes32;
}

export interface AuthoritativeEligibilityAdapter {
  check(
    request: AuthoritativeEligibilityRequest,
  ): Promise<EligibilityResult>;
}

export interface SelectionPolicy {
  readonly version: string;
  readonly policyHash: Bytes32;
  readonly candidateCount: 4;
  readonly assignmentTtlSeconds: number;
  readonly leaseStepSeconds: number;
  readonly maxStateAgeBlocks: number;
  readonly maxPendingOffersPerMerchant: number;
  readonly openOfferWeightNumerator: bigint;
  readonly openOfferWeightDenominator: bigint;
  readonly targetFiatShareBps: number;
  readonly buySafetyBufferBps: number;
  readonly minBuySafetyBufferUsdc: UsdcAtoms;
  readonly maxPriceDeviationBps: number;
  readonly minMerchantStakeUsdc: UsdcAtoms;
  readonly minOrderUsdc: UsdcAtoms;
  readonly maxOrderUsdc: UsdcAtoms;
  readonly acceptedOrderTimeoutSeconds: number;
  readonly disputeWindowSeconds: number;
}

export interface RankedCandidate {
  readonly merchant: Address;
  readonly channelId: Bytes32;
  readonly rank: 0 | 1 | 2 | 3;
  readonly rankingFinish: bigint;
  readonly commitFinish: bigint;
  readonly inventoryImbalanceBps: bigint;
  readonly recentFailureTier: number;
  readonly lastAcceptedOrAssignedAt: bigint | null;
  readonly deterministicTieBreak: Bytes32;
  readonly unlockAt: bigint;
}

export interface ExcludedCandidate {
  readonly merchant: Address;
  readonly channelId: Bytes32 | null;
  readonly result: EligibilityResult;
}

export interface SelectionDecision {
  readonly order: OrderSnapshot;
  readonly policy: SelectionPolicy;
  readonly candidates: readonly [
    RankedCandidate,
    RankedCandidate,
    RankedCandidate,
    RankedCandidate,
  ];
  readonly excluded: readonly ExcludedCandidate[];
  readonly decisionId: Bytes32;
  readonly helperBuildVersion: string;
}

export interface NoSelectionDecision {
  readonly order: OrderSnapshot;
  readonly policy: SelectionPolicy;
  readonly status: "NO_FOUR_CANDIDATES";
  readonly eligibleMerchantCount: number;
  readonly excluded: readonly ExcludedCandidate[];
  readonly helperBuildVersion: string;
}

export type DecisionOutcome = SelectionDecision | NoSelectionDecision;
