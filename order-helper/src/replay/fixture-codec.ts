import {
  Address,
  AuthoritativeEligibilityAdapter,
  Bytes32,
  CandidateSnapshot,
  ChannelSnapshot,
  EligibilityCode,
  EligibilityResult,
  OrderSnapshot,
  RoutingDomain,
  SelectionPolicy,
} from "../domain/types";
import {
  CandidateUniverseEvidence,
  OpenOfferSlot,
  OperatorRoutingSnapshot,
  SelectionHistoryEvent,
  SelectionInput,
  ShadowSelectionPolicy,
  ShadowSelectionResult,
  SHADOW_CAPABILITY,
  selectOrder,
} from "../selection";

const REPLAY_SCHEMA = "p2pflow.shadow-selection-replay.v1" as const;
const BIGINT_TAG = "$bigint";
const BASE_SEPOLIA_CHAIN_ID = 84_532;
const TARGET_DIAMOND =
  "0xf40ad901ccfb5e5edc5162d6ac7ddd5ed5899f3a" as Address;

const ELIGIBILITY_CODES: ReadonlySet<string> = new Set([
  "ELIGIBLE",
  "SNAPSHOT_BLOCK_MISMATCH",
  "ORDER_NOT_OPEN",
  "WRONG_ROUND",
  "MERCHANT_NOT_REGISTERED",
  "ACCOUNT_NOT_ACTIVE",
  "MERCHANT_OFFLINE",
  "UNSTAKE_PENDING",
  "REMOVAL_PENDING",
  "NOT_ALLOWLISTED",
  "CHANNEL_NOT_OWNED",
  "CHANNEL_NOT_APPROVED",
  "CHANNEL_INACTIVE",
  "CHANNEL_WRONG_DOMAIN",
  "QUOTE_EXPIRED",
  "DAILY_LIMIT_EXCEEDED",
  "MONTHLY_LIMIT_EXCEEDED",
  "TOO_MANY_OPEN_OFFERS",
  "TOO_MANY_ACTIVE_ORDERS",
  "INSUFFICIENT_USDC",
  "INSUFFICIENT_FIAT_PRINCIPAL",
  "INSUFFICIENT_PHYSICAL_FIAT",
  "PROTOCOL_FIAT_DEFICIT",
  "RECONCILIATION_REQUIRED",
  "MISSING_RISK_CONFIGURATION",
  "AUTHORITATIVE_CHECK_UNAVAILABLE",
]);

type SerializableSelectionInput = Omit<
  SelectionInput,
  "authoritativeEligibility"
>;

export interface ReplayFixture {
  readonly schema: typeof REPLAY_SCHEMA;
  readonly input: SerializableSelectionInput;
  readonly authoritativeResults: readonly ReplayEligibilityEntry[];
  readonly expectedTraceId?: Bytes32;
}

export interface ReplayEligibilityEntry {
  readonly merchant: Address;
  readonly channelId: Bytes32;
  readonly result: EligibilityResult;
}

export interface DecodedReplayFixture {
  readonly input: SelectionInput;
  readonly expectedTraceId: Bytes32 | null;
}

export class ReplayFixtureError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ReplayFixtureError";
  }
}

export function stringifyTaggedJson(
  value: unknown,
  pretty = false,
): string {
  return JSON.stringify(
    value,
    (_key: string, entry: unknown): unknown =>
      typeof entry === "bigint"
        ? { [BIGINT_TAG]: entry.toString(10) }
        : entry,
    pretty ? 2 : undefined,
  );
}

export function parseTaggedJson(source: string): unknown {
  try {
    return JSON.parse(
      source,
      (_key: string, entry: unknown): unknown => {
        if (!isRecord(entry)) return entry;
        const keys = Object.keys(entry);
        if (keys.length !== 1 || keys[0] !== BIGINT_TAG) return entry;
        const encoded = entry[BIGINT_TAG];
        if (
          typeof encoded !== "string" ||
          !/^(0|[1-9][0-9]*)$/.test(encoded)
        ) {
          throw new ReplayFixtureError("Invalid tagged bigint");
        }
        return BigInt(encoded);
      },
    ) as unknown;
  } catch (error: unknown) {
    if (error instanceof ReplayFixtureError) throw error;
    throw new ReplayFixtureError("Replay fixture is not valid tagged JSON");
  }
}

export function decodeReplayFixture(source: string): DecodedReplayFixture {
  const parsed = requireExactRecord(
    parseTaggedJson(source),
    "fixture",
    ["schema", "input", "authoritativeResults"],
    ["expectedTraceId"],
  );
  if (parsed.schema !== REPLAY_SCHEMA) {
    throw new ReplayFixtureError("Unsupported replay fixture schema");
  }
  const serializable = decodeSelectionInput(parsed.input);

  if (!Array.isArray(parsed.authoritativeResults)) {
    throw new ReplayFixtureError(
      "authoritativeResults must be a complete array",
    );
  }
  const results = parsed.authoritativeResults.map(
    (entry, index) => decodeEligibilityEntry(entry, index),
  );
  const adapter = new ReplayEligibilityAdapter(results);
  const expectedTraceId =
    parsed.expectedTraceId === undefined
      ? null
      : requireBytes32(parsed.expectedTraceId, "expectedTraceId");
  return {
    input: {
      ...serializable,
      authoritativeEligibility: adapter,
    },
    expectedTraceId,
  };
}

export async function executeReplayFixture(
  fixture: DecodedReplayFixture,
): Promise<ShadowSelectionResult> {
  const selection = await selectOrder(fixture.input);
  if (
    fixture.expectedTraceId !== null &&
    selection.trace.traceId.toLowerCase() !==
      fixture.expectedTraceId.toLowerCase()
  ) {
    throw new ReplayFixtureError(
      "Replay trace does not match expectedTraceId",
    );
  }
  return selection;
}

class ReplayEligibilityAdapter implements AuthoritativeEligibilityAdapter {
  private readonly results = new Map<string, EligibilityResult>();

  public constructor(entries: readonly ReplayEligibilityEntry[]) {
    for (const entry of entries) {
      const key = eligibilityKey(entry.merchant, entry.channelId);
      if (this.results.has(key)) {
        throw new ReplayFixtureError(
          "Duplicate authoritative eligibility entry",
        );
      }
      this.results.set(key, { ...entry.result });
    }
  }

  public async check(
    request: Parameters<AuthoritativeEligibilityAdapter["check"]>[0],
  ): Promise<EligibilityResult> {
    const result = this.results.get(
      eligibilityKey(request.merchant, request.channelId),
    );
    if (result === undefined) {
      throw new ReplayFixtureError(
        "Authoritative eligibility table is incomplete",
      );
    }
    return { ...result };
  }
}

function decodeSelectionInput(
  value: unknown,
): SerializableSelectionInput {
  const input = requireExactRecord(
    value,
    "input",
    [
      "capability",
      "order",
      "candidates",
      "operators",
      "history",
      "universe",
      "policy",
      "shadowPolicy",
      "domainEpoch",
      "sequence",
      "domainFloorQ",
      "assignedAt",
      "quoteDeadline",
      "helperBuildVersion",
      "helperBuildHash",
    ],
  );
  if (input.capability !== SHADOW_CAPABILITY) {
    throw new ReplayFixtureError(
      "Replay input must be transaction-disabled shadow-only",
    );
  }
  const order = decodeOrder(input.order);
  const policy = decodeSelectionPolicy(input.policy);
  const shadowPolicy = decodeShadowPolicy(input.shadowPolicy);
  return {
    capability: SHADOW_CAPABILITY,
    order,
    candidates: requireArray(input.candidates, "input.candidates").map(
      (candidate, index) =>
        decodeCandidate(candidate, `input.candidates[${index}]`),
    ),
    operators: requireArray(input.operators, "input.operators").map(
      (operator, index) =>
        decodeOperator(operator, `input.operators[${index}]`),
    ),
    history: requireArray(input.history, "input.history").map(
      (event, index) =>
        decodeHistoryEvent(event, `input.history[${index}]`),
    ),
    universe: decodeUniverse(input.universe),
    policy,
    shadowPolicy,
    domainEpoch: requireBytes32(input.domainEpoch, "input.domainEpoch"),
    sequence: requireUint256(input.sequence, "input.sequence"),
    domainFloorQ: requireUint256(
      input.domainFloorQ,
      "input.domainFloorQ",
    ),
    assignedAt: requireUint256(input.assignedAt, "input.assignedAt"),
    quoteDeadline: requireUint256(
      input.quoteDeadline,
      "input.quoteDeadline",
    ),
    helperBuildVersion: requireBoundedString(
      input.helperBuildVersion,
      "input.helperBuildVersion",
      128,
    ),
    helperBuildHash: requireBytes32(
      input.helperBuildHash,
      "input.helperBuildHash",
    ),
  };
}

function decodeOrder(value: unknown): OrderSnapshot {
  const order = requireExactRecord(
    value,
    "input.order",
    [
      "chainId",
      "diamond",
      "orderId",
      "round",
      "side",
      "user",
      "usdcAmount",
      "fiatAmount",
      "quoteHash",
      "snapshotBlock",
      "snapshotBlockHash",
      "validUntil",
      "domain",
    ],
  );
  const chainId = requireSafeInteger(
    order.chainId,
    "input.order.chainId",
    1,
  );
  const side = requireEnum(
    order.side,
    "input.order.side",
    ["BUY", "SELL"] as const,
  );
  const domain = decodeRoutingDomain(order.domain);
  if (domain.chainId !== chainId || domain.orderSide !== side) {
    throw new ReplayFixtureError(
      "input.order.domain must match the order chain and side",
    );
  }
  const diamond = requireAddress(order.diamond, "input.order.diamond");
  if (
    chainId !== BASE_SEPOLIA_CHAIN_ID ||
    diamond !== TARGET_DIAMOND
  ) {
    throw new ReplayFixtureError(
      "Replay input is restricted to the pinned Base Sepolia Diamond",
    );
  }
  return {
    chainId,
    diamond,
    orderId: requireBytes32(order.orderId, "input.order.orderId"),
    round: requireUint256(order.round, "input.order.round"),
    side,
    user: requireAddress(order.user, "input.order.user"),
    usdcAmount: requirePositiveUint256(
      order.usdcAmount,
      "input.order.usdcAmount",
    ),
    fiatAmount: requirePositiveUint256(
      order.fiatAmount,
      "input.order.fiatAmount",
    ),
    quoteHash: requireBytes32(order.quoteHash, "input.order.quoteHash"),
    snapshotBlock: requireUint256(
      order.snapshotBlock,
      "input.order.snapshotBlock",
    ),
    snapshotBlockHash: requireBytes32(
      order.snapshotBlockHash,
      "input.order.snapshotBlockHash",
    ),
    validUntil: requireUint256(
      order.validUntil,
      "input.order.validUntil",
    ),
    domain,
  };
}

function decodeRoutingDomain(value: unknown): RoutingDomain {
  const domain = requireExactRecord(
    value,
    "input.order.domain",
    [
      "chainId",
      "fiatCurrency",
      "paymentRailGroup",
      "orderSide",
    ],
  );
  return {
    chainId: requireSafeInteger(
      domain.chainId,
      "input.order.domain.chainId",
      1,
    ),
    fiatCurrency: requireBoundedString(
      domain.fiatCurrency,
      "input.order.domain.fiatCurrency",
      32,
    ),
    paymentRailGroup: requireBoundedString(
      domain.paymentRailGroup,
      "input.order.domain.paymentRailGroup",
      64,
    ),
    orderSide: requireEnum(
      domain.orderSide,
      "input.order.domain.orderSide",
      ["BUY", "SELL"] as const,
    ),
  };
}

function decodeCandidate(
  value: unknown,
  name: string,
): CandidateSnapshot {
  const candidate = requireExactRecord(
    value,
    name,
    [
      "merchant",
      "accountStatus",
      "availability",
      "registered",
      "allowlisted",
      "allowlistEnabled",
      "unstakePending",
      "pendingRemoval",
      "principalTargetUsdc",
      "usdcLiquidity",
      "reservedUsdc",
      "riskUsdc",
      "activeAcceptedOrders",
      "maxActiveAcceptedOrders",
      "openOfferCount",
      "openOfferUsdc",
      "virtualFinish",
      "lastAssignedAt",
      "lastAcceptedAt",
      "recentFailureTier",
      "channels",
      "observedAtBlock",
      "observedAtBlockHash",
    ],
  );
  return {
    merchant: requireAddress(candidate.merchant, `${name}.merchant`),
    accountStatus: requireEnum(
      candidate.accountStatus,
      `${name}.accountStatus`,
      ["ACTIVE", "INACTIVE", "BLACKLISTED", "DISPUTED"] as const,
    ),
    availability: requireEnum(
      candidate.availability,
      `${name}.availability`,
      ["ONLINE", "OFFLINE"] as const,
    ),
    registered: requireBoolean(
      candidate.registered,
      `${name}.registered`,
    ),
    allowlisted: requireBoolean(
      candidate.allowlisted,
      `${name}.allowlisted`,
    ),
    allowlistEnabled: requireBoolean(
      candidate.allowlistEnabled,
      `${name}.allowlistEnabled`,
    ),
    unstakePending: requireBoolean(
      candidate.unstakePending,
      `${name}.unstakePending`,
    ),
    pendingRemoval: requireBoolean(
      candidate.pendingRemoval,
      `${name}.pendingRemoval`,
    ),
    principalTargetUsdc: requireUint256(
      candidate.principalTargetUsdc,
      `${name}.principalTargetUsdc`,
    ),
    usdcLiquidity: requireUint256(
      candidate.usdcLiquidity,
      `${name}.usdcLiquidity`,
    ),
    reservedUsdc: requireUint256(
      candidate.reservedUsdc,
      `${name}.reservedUsdc`,
    ),
    riskUsdc: requireUint256(
      candidate.riskUsdc,
      `${name}.riskUsdc`,
    ),
    activeAcceptedOrders: requireSafeInteger(
      candidate.activeAcceptedOrders,
      `${name}.activeAcceptedOrders`,
      0,
    ),
    maxActiveAcceptedOrders: requireSafeInteger(
      candidate.maxActiveAcceptedOrders,
      `${name}.maxActiveAcceptedOrders`,
      1,
    ),
    openOfferCount: requireSafeInteger(
      candidate.openOfferCount,
      `${name}.openOfferCount`,
      0,
    ),
    openOfferUsdc: requireUint256(
      candidate.openOfferUsdc,
      `${name}.openOfferUsdc`,
    ),
    virtualFinish: requireNullableUint256(
      candidate.virtualFinish,
      `${name}.virtualFinish`,
    ),
    lastAssignedAt: requireNullableUint256(
      candidate.lastAssignedAt,
      `${name}.lastAssignedAt`,
    ),
    lastAcceptedAt: requireNullableUint256(
      candidate.lastAcceptedAt,
      `${name}.lastAcceptedAt`,
    ),
    recentFailureTier: requireSafeInteger(
      candidate.recentFailureTier,
      `${name}.recentFailureTier`,
      0,
    ),
    channels: requireArray(
      candidate.channels,
      `${name}.channels`,
    ).map((channel, index) =>
      decodeChannel(channel, `${name}.channels[${index}]`)
    ),
    observedAtBlock: requireUint256(
      candidate.observedAtBlock,
      `${name}.observedAtBlock`,
    ),
    observedAtBlockHash: requireBytes32(
      candidate.observedAtBlockHash,
      `${name}.observedAtBlockHash`,
    ),
  };
}

function decodeChannel(
  value: unknown,
  name: string,
): ChannelSnapshot {
  const channel = requireExactRecord(
    value,
    name,
    [
      "channelId",
      "merchant",
      "fiatCurrency",
      "paymentRailGroup",
      "status",
      "availability",
      "grossFiat",
      "reservedFiat",
      "fiatPrincipalUsdc",
      "reservedPrincipalUsdc",
      "dailyVolumeUsedUsdc",
      "dailyLimitUsdc",
      "monthlyVolumeUsedUsdc",
      "monthlyLimitUsdc",
      "protocolFiatDeficit",
      "reconciliationRequired",
      "openOfferCount",
    ],
  );
  return {
    channelId: requireBytes32(channel.channelId, `${name}.channelId`),
    merchant: requireAddress(channel.merchant, `${name}.merchant`),
    fiatCurrency: requireBoundedString(
      channel.fiatCurrency,
      `${name}.fiatCurrency`,
      32,
    ),
    paymentRailGroup: requireBoundedString(
      channel.paymentRailGroup,
      `${name}.paymentRailGroup`,
      64,
    ),
    status: requireEnum(
      channel.status,
      `${name}.status`,
      ["PENDING", "APPROVED", "REJECTED", "TERMINATED"] as const,
    ),
    availability: requireEnum(
      channel.availability,
      `${name}.availability`,
      ["ACTIVE", "INACTIVE"] as const,
    ),
    grossFiat: requireUint256(channel.grossFiat, `${name}.grossFiat`),
    reservedFiat: requireUint256(
      channel.reservedFiat,
      `${name}.reservedFiat`,
    ),
    fiatPrincipalUsdc: requireUint256(
      channel.fiatPrincipalUsdc,
      `${name}.fiatPrincipalUsdc`,
    ),
    reservedPrincipalUsdc: requireUint256(
      channel.reservedPrincipalUsdc,
      `${name}.reservedPrincipalUsdc`,
    ),
    dailyVolumeUsedUsdc: requireUint256(
      channel.dailyVolumeUsedUsdc,
      `${name}.dailyVolumeUsedUsdc`,
    ),
    dailyLimitUsdc: requireNullableUint256(
      channel.dailyLimitUsdc,
      `${name}.dailyLimitUsdc`,
    ),
    monthlyVolumeUsedUsdc: requireUint256(
      channel.monthlyVolumeUsedUsdc,
      `${name}.monthlyVolumeUsedUsdc`,
    ),
    monthlyLimitUsdc: requireNullableUint256(
      channel.monthlyLimitUsdc,
      `${name}.monthlyLimitUsdc`,
    ),
    protocolFiatDeficit: requireUint256(
      channel.protocolFiatDeficit,
      `${name}.protocolFiatDeficit`,
    ),
    reconciliationRequired: requireBoolean(
      channel.reconciliationRequired,
      `${name}.reconciliationRequired`,
    ),
    openOfferCount: requireSafeInteger(
      channel.openOfferCount,
      `${name}.openOfferCount`,
      0,
    ),
  };
}

function decodeOperator(
  value: unknown,
  name: string,
): OperatorRoutingSnapshot {
  const operator = requireExactRecord(
    value,
    name,
    [
      "operatorId",
      "failureDomainId",
      "wallets",
      "acceptedUsdc",
      "virtualFinishQ",
      "openOffers",
      "activeAcceptedOrders",
      "maxActiveAcceptedOrders",
      "recentFailureTier",
      "lastAcceptedOrAssignedAt",
    ],
  );
  return {
    operatorId: requireBytes32(
      operator.operatorId,
      `${name}.operatorId`,
    ),
    failureDomainId: requireBytes32(
      operator.failureDomainId,
      `${name}.failureDomainId`,
    ),
    wallets: requireArray(operator.wallets, `${name}.wallets`).map(
      (wallet, index) =>
        requireAddress(wallet, `${name}.wallets[${index}]`),
    ),
    acceptedUsdc: requireUint256(
      operator.acceptedUsdc,
      `${name}.acceptedUsdc`,
    ),
    virtualFinishQ: requireNullableUint256(
      operator.virtualFinishQ,
      `${name}.virtualFinishQ`,
    ),
    openOffers: requireArray(
      operator.openOffers,
      `${name}.openOffers`,
    ).map((offer, index) =>
      decodeOpenOffer(offer, `${name}.openOffers[${index}]`)
    ),
    activeAcceptedOrders: requireSafeInteger(
      operator.activeAcceptedOrders,
      `${name}.activeAcceptedOrders`,
      0,
    ),
    maxActiveAcceptedOrders: requireSafeInteger(
      operator.maxActiveAcceptedOrders,
      `${name}.maxActiveAcceptedOrders`,
      1,
    ),
    recentFailureTier: requireSafeInteger(
      operator.recentFailureTier,
      `${name}.recentFailureTier`,
      0,
    ),
    lastAcceptedOrAssignedAt: requireNullableUint256(
      operator.lastAcceptedOrAssignedAt,
      `${name}.lastAcceptedOrAssignedAt`,
    ),
  };
}

function decodeOpenOffer(
  value: unknown,
  name: string,
): OpenOfferSlot {
  const offer = requireExactRecord(
    value,
    name,
    [
      "slotId",
      "orderId",
      "round",
      "operatorId",
      "merchant",
      "channelId",
      "usdcAmount",
      "openedAtSequence",
    ],
  );
  return {
    slotId: requireBytes32(offer.slotId, `${name}.slotId`),
    orderId: requireBytes32(offer.orderId, `${name}.orderId`),
    round: requireUint256(offer.round, `${name}.round`),
    operatorId: requireBytes32(
      offer.operatorId,
      `${name}.operatorId`,
    ),
    merchant: requireAddress(offer.merchant, `${name}.merchant`),
    channelId: requireBytes32(
      offer.channelId,
      `${name}.channelId`,
    ),
    usdcAmount: requirePositiveUint256(
      offer.usdcAmount,
      `${name}.usdcAmount`,
    ),
    openedAtSequence: requireUint256(
      offer.openedAtSequence,
      `${name}.openedAtSequence`,
    ),
  };
}

function decodeHistoryEvent(
  value: unknown,
  name: string,
): SelectionHistoryEvent {
  const event = requireExactRecord(
    value,
    name,
    [
      "eventId",
      "operatorId",
      "decisionId",
      "orderId",
      "round",
      "sequence",
      "kind",
    ],
  );
  return {
    eventId: requireBytes32(event.eventId, `${name}.eventId`),
    operatorId: requireBytes32(
      event.operatorId,
      `${name}.operatorId`,
    ),
    decisionId: requireBytes32(
      event.decisionId,
      `${name}.decisionId`,
    ),
    orderId: requireBytes32(event.orderId, `${name}.orderId`),
    round: requireUint256(event.round, `${name}.round`),
    sequence: requireUint256(event.sequence, `${name}.sequence`),
    kind: requireEnum(
      event.kind,
      `${name}.kind`,
      [
        "RANK_ZERO_ASSIGNED",
        "RANK_ZERO_MISSED",
        "ACCEPTED",
        "RESPONDED",
      ] as const,
    ),
  };
}

function decodeUniverse(value: unknown): CandidateUniverseEvidence {
  const universe = requireExactRecord(
    value,
    "input.universe",
    [
      "complete",
      "pageCount",
      "expectedEntryCount",
      "finalizedBlock",
      "finalizedBlockHash",
    ],
  );
  return {
    complete: requireBoolean(
      universe.complete,
      "input.universe.complete",
    ),
    pageCount: requireSafeInteger(
      universe.pageCount,
      "input.universe.pageCount",
      1,
    ),
    expectedEntryCount: requireSafeInteger(
      universe.expectedEntryCount,
      "input.universe.expectedEntryCount",
      0,
    ),
    finalizedBlock: requireUint256(
      universe.finalizedBlock,
      "input.universe.finalizedBlock",
    ),
    finalizedBlockHash: requireBytes32(
      universe.finalizedBlockHash,
      "input.universe.finalizedBlockHash",
    ),
  };
}

function decodeSelectionPolicy(value: unknown): SelectionPolicy {
  const policy = requireExactRecord(
    value,
    "input.policy",
    [
      "version",
      "policyHash",
      "candidateCount",
      "assignmentTtlSeconds",
      "leaseStepSeconds",
      "maxStateAgeBlocks",
      "maxPendingOffersPerMerchant",
      "openOfferWeightNumerator",
      "openOfferWeightDenominator",
      "targetFiatShareBps",
      "buySafetyBufferBps",
      "minBuySafetyBufferUsdc",
      "maxPriceDeviationBps",
      "minMerchantStakeUsdc",
      "minOrderUsdc",
      "maxOrderUsdc",
      "acceptedOrderTimeoutSeconds",
      "disputeWindowSeconds",
    ],
  );
  const candidateCount = requireSafeInteger(
    policy.candidateCount,
    "input.policy.candidateCount",
    4,
    4,
  );
  if (candidateCount !== 4) {
    throw new ReplayFixtureError(
      "input.policy.candidateCount must be exactly four",
    );
  }
  const minOrderUsdc = requirePositiveUint256(
    policy.minOrderUsdc,
    "input.policy.minOrderUsdc",
  );
  const maxOrderUsdc = requirePositiveUint256(
    policy.maxOrderUsdc,
    "input.policy.maxOrderUsdc",
  );
  if (maxOrderUsdc < minOrderUsdc) {
    throw new ReplayFixtureError(
      "input.policy.maxOrderUsdc must not be below minOrderUsdc",
    );
  }
  const openOfferWeightNumerator = requireUint256(
    policy.openOfferWeightNumerator,
    "input.policy.openOfferWeightNumerator",
  );
  const openOfferWeightDenominator = requirePositiveUint256(
    policy.openOfferWeightDenominator,
    "input.policy.openOfferWeightDenominator",
  );
  if (openOfferWeightNumerator >= openOfferWeightDenominator) {
    throw new ReplayFixtureError(
      "input.policy open-offer weight must be strictly below one",
    );
  }
  return {
    version: requireBoundedString(
      policy.version,
      "input.policy.version",
      128,
    ),
    policyHash: requireBytes32(
      policy.policyHash,
      "input.policy.policyHash",
    ),
    candidateCount: 4,
    assignmentTtlSeconds: requireSafeInteger(
      policy.assignmentTtlSeconds,
      "input.policy.assignmentTtlSeconds",
      1,
    ),
    leaseStepSeconds: requireSafeInteger(
      policy.leaseStepSeconds,
      "input.policy.leaseStepSeconds",
      1,
    ),
    maxStateAgeBlocks: requireSafeInteger(
      policy.maxStateAgeBlocks,
      "input.policy.maxStateAgeBlocks",
      1,
    ),
    maxPendingOffersPerMerchant: requireSafeInteger(
      policy.maxPendingOffersPerMerchant,
      "input.policy.maxPendingOffersPerMerchant",
      1,
    ),
    openOfferWeightNumerator,
    openOfferWeightDenominator,
    targetFiatShareBps: requireSafeInteger(
      policy.targetFiatShareBps,
      "input.policy.targetFiatShareBps",
      0,
      10_000,
    ),
    buySafetyBufferBps: requireSafeInteger(
      policy.buySafetyBufferBps,
      "input.policy.buySafetyBufferBps",
      0,
      10_000,
    ),
    minBuySafetyBufferUsdc: requireUint256(
      policy.minBuySafetyBufferUsdc,
      "input.policy.minBuySafetyBufferUsdc",
    ),
    maxPriceDeviationBps: requireSafeInteger(
      policy.maxPriceDeviationBps,
      "input.policy.maxPriceDeviationBps",
      1,
      10_000,
    ),
    minMerchantStakeUsdc: requirePositiveUint256(
      policy.minMerchantStakeUsdc,
      "input.policy.minMerchantStakeUsdc",
    ),
    minOrderUsdc,
    maxOrderUsdc,
    acceptedOrderTimeoutSeconds: requireSafeInteger(
      policy.acceptedOrderTimeoutSeconds,
      "input.policy.acceptedOrderTimeoutSeconds",
      1,
    ),
    disputeWindowSeconds: requireSafeInteger(
      policy.disputeWindowSeconds,
      "input.policy.disputeWindowSeconds",
      1,
    ),
  };
}

function decodeShadowPolicy(value: unknown): ShadowSelectionPolicy {
  const policy = requireExactRecord(
    value,
    "input.shadowPolicy",
    [
      "schema",
      "readinessReserveF",
      "minimumFinalAcceptanceWindowSeconds",
      "allowUnlimitedChannelLimits",
      "concentrationWindowSequences",
      "maxRankZeroPerOperatorInWindow",
      "nonresponseCooldownSequences",
      "cohortExpansionPerCoolingOperator",
      "maxCohortExpansion",
    ],
  );
  if (policy.schema !== "p2pflow.shadow-selection-policy.v1") {
    throw new ReplayFixtureError(
      "Unsupported input.shadowPolicy schema",
    );
  }
  const readinessReserveF = requireSafeInteger(
    policy.readinessReserveF,
    "input.shadowPolicy.readinessReserveF",
    0,
  );
  const concentrationWindowSequences = requireSafeInteger(
    policy.concentrationWindowSequences,
    "input.shadowPolicy.concentrationWindowSequences",
    1,
  );
  const maxRankZeroPerOperatorInWindow = requireSafeInteger(
    policy.maxRankZeroPerOperatorInWindow,
    "input.shadowPolicy.maxRankZeroPerOperatorInWindow",
    1,
  );
  if (maxRankZeroPerOperatorInWindow > concentrationWindowSequences) {
    throw new ReplayFixtureError(
      "input.shadowPolicy rank-zero bound exceeds its window",
    );
  }
  const maxCohortExpansion = requireSafeInteger(
    policy.maxCohortExpansion,
    "input.shadowPolicy.maxCohortExpansion",
    readinessReserveF,
  );
  return {
    schema: "p2pflow.shadow-selection-policy.v1",
    readinessReserveF,
    minimumFinalAcceptanceWindowSeconds: requireSafeInteger(
      policy.minimumFinalAcceptanceWindowSeconds,
      "input.shadowPolicy.minimumFinalAcceptanceWindowSeconds",
      1,
    ),
    allowUnlimitedChannelLimits: requireBoolean(
      policy.allowUnlimitedChannelLimits,
      "input.shadowPolicy.allowUnlimitedChannelLimits",
    ),
    concentrationWindowSequences,
    maxRankZeroPerOperatorInWindow,
    nonresponseCooldownSequences: requirePositiveUint256(
      policy.nonresponseCooldownSequences,
      "input.shadowPolicy.nonresponseCooldownSequences",
    ),
    cohortExpansionPerCoolingOperator: requireSafeInteger(
      policy.cohortExpansionPerCoolingOperator,
      "input.shadowPolicy.cohortExpansionPerCoolingOperator",
      1,
    ),
    maxCohortExpansion,
  };
}

function decodeEligibilityEntry(
  value: unknown,
  index: number,
): ReplayEligibilityEntry {
  const entryName = `authoritativeResults[${index}]`;
  const entry = requireExactRecord(
    value,
    entryName,
    ["merchant", "channelId", "result"],
  );
  const merchant = requireAddress(
    entry.merchant,
    `${entryName}.merchant`,
  );
  const channelId = requireBytes32(
    entry.channelId,
    `${entryName}.channelId`,
  );
  const resultRecord = requireExactRecord(
    entry.result,
    `${entryName}.result`,
    ["code", "required", "available", "source", "checkedAtBlock"],
    ["detail"],
  );
  if (
    typeof resultRecord.code !== "string" ||
    !ELIGIBILITY_CODES.has(resultRecord.code)
  ) {
    throw new ReplayFixtureError("Unknown eligibility code");
  }
  const required = requireUint256(
    resultRecord.required,
    `${entryName}.result.required`,
  );
  const available = requireUint256(
    resultRecord.available,
    `${entryName}.result.available`,
  );
  if (
    resultRecord.code === "ELIGIBLE" &&
    (required === 0n || available < required)
  ) {
    throw new ReplayFixtureError(
      "ELIGIBLE results require a positive requirement and sufficient availability",
    );
  }
  if (
    resultRecord.source !== "contract" &&
    resultRecord.source !== "snapshot"
  ) {
    throw new ReplayFixtureError(
      "Replay eligibility source must be snapshot or contract",
    );
  }
  const checkedAtBlock = requireUint256(
    resultRecord.checkedAtBlock,
    `${entryName}.result.checkedAtBlock`,
  );
  const detail =
    resultRecord.detail === undefined
      ? undefined
      : requireBoundedString(
          resultRecord.detail,
          `${entryName}.result.detail`,
          256,
          true,
        );
  const result: EligibilityResult = {
    code: resultRecord.code as EligibilityCode,
    required,
    available,
    source: resultRecord.source,
    checkedAtBlock,
    ...(detail !== undefined
      ? { detail }
      : {}),
  };
  return { merchant, channelId, result };
}

function eligibilityKey(merchant: Address, channelId: Bytes32): string {
  return `${merchant.toLowerCase()}:${channelId.toLowerCase()}`;
}

function requireRecord(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ReplayFixtureError(`${name} must be an object`);
  }
  return value;
}

function requireExactRecord(
  value: unknown,
  name: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  const record = requireRecord(value, name);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new ReplayFixtureError(`${name} is missing ${key}`);
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new ReplayFixtureError(
        `${name} contains unsupported field ${key}`,
      );
    }
  }
  return record;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

const MAX_UINT256 = (1n << 256n) - 1n;

function requireArray(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new ReplayFixtureError(`${name} must be an array`);
  }
  return value;
}

function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new ReplayFixtureError(`${name} must be a boolean`);
  }
  return value;
}

function requireSafeInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new ReplayFixtureError(
      `${name} must be a safe integer in [${minimum}, ${maximum}]`,
    );
  }
  return value;
}

function requireUint256(value: unknown, name: string): bigint {
  if (
    typeof value !== "bigint" ||
    value < 0n ||
    value > MAX_UINT256
  ) {
    throw new ReplayFixtureError(
      `${name} must be a tagged uint256 integer`,
    );
  }
  return value;
}

function requirePositiveUint256(
  value: unknown,
  name: string,
): bigint {
  const result = requireUint256(value, name);
  if (result === 0n) {
    throw new ReplayFixtureError(`${name} must be positive`);
  }
  return result;
}

function requireNullableUint256(
  value: unknown,
  name: string,
): bigint | null {
  return value === null ? null : requireUint256(value, name);
}

function requireBoundedString(
  value: unknown,
  name: string,
  maximumLength: number,
  allowEmpty = false,
): string {
  if (typeof value !== "string") {
    throw new ReplayFixtureError(`${name} must be a string`);
  }
  const normalized = value.normalize("NFC");
  if (
    (!allowEmpty && normalized.trim().length === 0) ||
    normalized.length > maximumLength
  ) {
    throw new ReplayFixtureError(
      `${name} must be a bounded${allowEmpty ? "" : " non-empty"} string`,
    );
  }
  return normalized;
}

function requireEnum<const Values extends readonly string[]>(
  value: unknown,
  name: string,
  allowed: Values,
): Values[number] {
  if (
    typeof value !== "string" ||
    !allowed.some((entry) => entry === value)
  ) {
    throw new ReplayFixtureError(
      `${name} must be one of ${allowed.join(", ")}`,
    );
  }
  return value as Values[number];
}

function requireAddress(value: unknown, name: string): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new ReplayFixtureError(`${name} must be a 20-byte hex value`);
  }
  return value.toLowerCase() as Address;
}

function requireBytes32(value: unknown, name: string): Bytes32 {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new ReplayFixtureError(`${name} must be a 32-byte hex value`);
  }
  return value.toLowerCase() as Bytes32;
}
