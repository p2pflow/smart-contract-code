import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_DIAMOND_ADDRESS,
  COUNCIL_BILL_SHA256,
  COUNCIL_VERDICT,
} from "../authority";
import { canonicalJson } from "../canonical/canonical-json";
import {
  Address,
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
  canonicalMerkleRoot,
  hashCanonicalPayloadText,
  OpenOfferSlot,
  OperatorRoutingSnapshot,
  SelectionHistoryEvent,
  SelectionInput,
  SelectionPolicyMaterial,
  selectOrder,
  selectionPolicyHash,
  ShadowNoServiceReason,
  ShadowSelectionPolicy,
  ShadowSelectionResult,
  SHADOW_CAPABILITY,
} from "../selection";
import {
  decodeReplayFixture,
  ReplayEligibilityEntry,
  ReplayFixtureError,
  stringifyTaggedJson,
} from "./fixture-codec";

export const SHADOW_WITNESS_SCHEMA =
  "p2pflow.shadow-selection-witness.v1" as const;

const MAX_UINT256 = (1n << 256n) - 1n;
const NO_SERVICE_REASONS = [
  "READINESS_GATE",
  "FAILURE_DOMAIN_GATE",
  "NO_FOUR_ELIGIBLE_OPERATORS",
] as const;

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

export interface DecodedWitnessReplay {
  readonly input: SelectionInput;
  readonly canonicalWitness: string;
  readonly witnessContentId: Bytes32;
  readonly expectedCanonicalPayload: string;
  readonly expectedTraceId: Bytes32;
  readonly universeRoot: Bytes32;
  readonly eligibilityPrestateRoot: Bytes32;
  readonly outputRoot: Bytes32;
}

export class WitnessReplayError extends ReplayFixtureError {
  public constructor(message: string) {
    super(message);
    this.name = "WitnessReplayError";
  }
}

export function decodeWitnessReplay(source: string): DecodedWitnessReplay {
  const parsed = parseCanonicalWitness(source);
  const witness = requireExactRecord(
    parsed,
    "witness",
    [
      "schema",
      "capability",
      "actionAuthorization",
      "input",
      "universeEntries",
      "eligibilityPrestates",
      "exclusions",
      "output",
    ],
  );
  if (
    witness.schema !== SHADOW_WITNESS_SCHEMA ||
    witness.capability !== SHADOW_CAPABILITY ||
    witness.actionAuthorization !== false
  ) {
    throw new WitnessReplayError(
      "Witness schema or transaction-disabled authority marker is invalid",
    );
  }

  const inputRecord = requireExactRecord(
    witness.input,
    "witness.input",
    [
      "order",
      "candidates",
      "operators",
      "history",
      "universe",
      "canonicalPolicyWitness",
      "domainEpoch",
      "sequence",
      "domainFloorQ",
      "assignedAt",
      "quoteDeadline",
      "helperBuildVersion",
      "helperBuildHash",
    ],
  );
  const order = decodeCanonicalOrder(inputRecord.order);
  const candidates = requireArray(
    inputRecord.candidates,
    "witness.input.candidates",
  ).map((candidate, index) =>
    decodeCanonicalCandidate(candidate, `witness.input.candidates[${index}]`)
  );
  const operators = requireArray(
    inputRecord.operators,
    "witness.input.operators",
  ).map((operator, index) =>
    decodeCanonicalOperator(operator, `witness.input.operators[${index}]`)
  );
  const history = requireArray(
    inputRecord.history,
    "witness.input.history",
  ).map((event, index) =>
    decodeCanonicalHistory(event, `witness.input.history[${index}]`)
  );
  const universe = decodeCanonicalUniverse(inputRecord.universe);
  const {
    policy,
    shadowPolicy,
  } = decodeCanonicalPolicyWitness(inputRecord.canonicalPolicyWitness);

  const serializableInput = {
    capability: SHADOW_CAPABILITY,
    order,
    candidates,
    operators,
    history,
    universe,
    policy,
    shadowPolicy,
    domainEpoch: requireBytes32(
      inputRecord.domainEpoch,
      "witness.input.domainEpoch",
    ),
    sequence: requireCanonicalUint(
      inputRecord.sequence,
      "witness.input.sequence",
    ),
    domainFloorQ: requireCanonicalUint(
      inputRecord.domainFloorQ,
      "witness.input.domainFloorQ",
    ),
    assignedAt: requireCanonicalUint(
      inputRecord.assignedAt,
      "witness.input.assignedAt",
    ),
    quoteDeadline: requireCanonicalUint(
      inputRecord.quoteDeadline,
      "witness.input.quoteDeadline",
    ),
    helperBuildVersion: requireString(
      inputRecord.helperBuildVersion,
      "witness.input.helperBuildVersion",
      128,
    ),
    helperBuildHash: requireBytes32(
      inputRecord.helperBuildHash,
      "witness.input.helperBuildHash",
    ),
  };

  const rawCandidates = requireArray(
    inputRecord.candidates,
    "witness.input.candidates",
  );
  const rawUniverseEntries = requireArray(
    witness.universeEntries,
    "witness.universeEntries",
  );
  validateUniverseEvidence(
    rawCandidates,
    rawUniverseEntries,
    candidates,
    universe,
    order,
  );
  const universeRoot = canonicalMerkleRoot(
    "p2pflow.candidate-universe.v1",
    rawUniverseEntries,
  );

  const rawPrestates = requireArray(
    witness.eligibilityPrestates,
    "witness.eligibilityPrestates",
  );
  const authoritativeResults = decodeEligibilityEvidence(
    rawPrestates,
    candidates,
    operators,
    order,
  );
  const eligibilityPrestateRoot = canonicalMerkleRoot(
    "p2pflow.eligibility-prestate.v2",
    rawPrestates,
  );
  validateExclusions(witness.exclusions);
  const output = decodeWitnessOutput(witness.output);

  const decodedFixture = decodeReplayFixture(
    stringifyTaggedJson({
      schema: "p2pflow.shadow-selection-replay.v1",
      input: serializableInput,
      authoritativeResults,
    }),
  );
  const witnessContentId = hashCanonicalPayloadText(source);
  const expectedCanonicalPayload = buildExpectedCanonicalPayload(
    decodedFixture.input,
    witnessContentId,
    rawUniverseEntries.length,
    universeRoot,
    eligibilityPrestateRoot,
    output,
  );

  return {
    input: decodedFixture.input,
    canonicalWitness: source,
    witnessContentId,
    expectedCanonicalPayload,
    expectedTraceId: hashCanonicalPayloadText(expectedCanonicalPayload),
    universeRoot,
    eligibilityPrestateRoot,
    outputRoot: output.outputRoot,
  };
}

export async function executeWitnessReplay(
  replay: DecodedWitnessReplay,
): Promise<ShadowSelectionResult> {
  const selection = await selectOrder(replay.input);
  assertDigestEquals(
    selection.trace.witnessContentId,
    replay.witnessContentId,
    "witnessContentId",
  );
  assertDigestEquals(
    selection.trace.universeRoot,
    replay.universeRoot,
    "universeRoot",
  );
  assertDigestEquals(
    selection.trace.eligibilityPrestateRoot,
    replay.eligibilityPrestateRoot,
    "eligibilityPrestateRoot",
  );
  assertDigestEquals(
    selection.trace.outputRoot,
    replay.outputRoot,
    "outputRoot",
  );
  assertDigestEquals(
    selection.trace.traceId,
    replay.expectedTraceId,
    "traceId",
  );
  if (selection.trace.canonicalWitness !== replay.canonicalWitness) {
    throw new WitnessReplayError(
      "Replayed canonical witness differs from the persisted witness",
    );
  }
  if (selection.trace.canonicalPayload !== replay.expectedCanonicalPayload) {
    throw new WitnessReplayError(
      "Replayed canonical payload differs from the witness-derived payload",
    );
  }
  return selection;
}

interface DecodedWitnessOutput {
  readonly serviceStatus: "SHADOW_DECISION" | "NO_SERVICE";
  readonly noServiceReason: ShadowNoServiceReason | null;
  readonly candidates: readonly unknown[];
  readonly leaseSchedule: readonly unknown[];
  readonly outputRoot: Bytes32;
}

function decodeCanonicalOrder(value: unknown): OrderSnapshot {
  const record = requireExactRecord(
    value,
    "witness.input.order",
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
  const chainId = requireCanonicalNumber(
    record.chainId,
    "witness.input.order.chainId",
    1,
  );
  const diamond = requireAddress(
    record.diamond,
    "witness.input.order.diamond",
  );
  if (
    chainId !== BASE_SEPOLIA_CHAIN_ID ||
    diamond.toLowerCase() !== BASE_SEPOLIA_DIAMOND_ADDRESS.toLowerCase()
  ) {
    throw new WitnessReplayError(
      "Witness order is detached from the pinned Base Sepolia Diamond",
    );
  }
  const side = requireEnum(
    record.side,
    "witness.input.order.side",
    ["BUY", "SELL"] as const,
  );
  const domain = decodeCanonicalDomain(record.domain);
  if (domain.chainId !== chainId || domain.orderSide !== side) {
    throw new WitnessReplayError(
      "Witness order routing domain does not match its chain and side",
    );
  }
  return {
    chainId,
    diamond,
    orderId: requireBytes32(
      record.orderId,
      "witness.input.order.orderId",
    ),
    round: requireCanonicalUint(
      record.round,
      "witness.input.order.round",
    ),
    side,
    user: requireAddress(record.user, "witness.input.order.user"),
    usdcAmount: requirePositiveCanonicalUint(
      record.usdcAmount,
      "witness.input.order.usdcAmount",
    ),
    fiatAmount: requirePositiveCanonicalUint(
      record.fiatAmount,
      "witness.input.order.fiatAmount",
    ),
    quoteHash: requireBytes32(
      record.quoteHash,
      "witness.input.order.quoteHash",
    ),
    snapshotBlock: requireCanonicalUint(
      record.snapshotBlock,
      "witness.input.order.snapshotBlock",
    ),
    snapshotBlockHash: requireBytes32(
      record.snapshotBlockHash,
      "witness.input.order.snapshotBlockHash",
    ),
    validUntil: requireCanonicalUint(
      record.validUntil,
      "witness.input.order.validUntil",
    ),
    domain,
  };
}

function decodeCanonicalDomain(value: unknown): RoutingDomain {
  const record = requireExactRecord(
    value,
    "witness.input.order.domain",
    ["chainId", "fiatCurrency", "paymentRailGroup", "orderSide"],
  );
  return {
    chainId: requireCanonicalNumber(
      record.chainId,
      "witness.input.order.domain.chainId",
      1,
    ),
    fiatCurrency: requireString(
      record.fiatCurrency,
      "witness.input.order.domain.fiatCurrency",
      32,
    ),
    paymentRailGroup: requireString(
      record.paymentRailGroup,
      "witness.input.order.domain.paymentRailGroup",
      64,
    ),
    orderSide: requireEnum(
      record.orderSide,
      "witness.input.order.domain.orderSide",
      ["BUY", "SELL"] as const,
    ),
  };
}

function decodeCanonicalCandidate(
  value: unknown,
  name: string,
): CandidateSnapshot {
  const record = requireExactRecord(
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
  const merchant = requireAddress(record.merchant, `${name}.merchant`);
  const channels = requireArray(record.channels, `${name}.channels`).map(
    (channel, index) =>
      decodeCanonicalChannel(channel, `${name}.channels[${index}]`),
  );
  for (const channel of channels) {
    if (channel.merchant.toLowerCase() !== merchant.toLowerCase()) {
      throw new WitnessReplayError(
        `${name} contains a channel owned by another merchant`,
      );
    }
  }
  return {
    merchant,
    accountStatus: requireEnum(
      record.accountStatus,
      `${name}.accountStatus`,
      ["ACTIVE", "INACTIVE", "BLACKLISTED", "DISPUTED"] as const,
    ),
    availability: requireEnum(
      record.availability,
      `${name}.availability`,
      ["ONLINE", "OFFLINE"] as const,
    ),
    registered: requireBoolean(record.registered, `${name}.registered`),
    allowlisted: requireBoolean(record.allowlisted, `${name}.allowlisted`),
    allowlistEnabled: requireBoolean(
      record.allowlistEnabled,
      `${name}.allowlistEnabled`,
    ),
    unstakePending: requireBoolean(
      record.unstakePending,
      `${name}.unstakePending`,
    ),
    pendingRemoval: requireBoolean(
      record.pendingRemoval,
      `${name}.pendingRemoval`,
    ),
    principalTargetUsdc: requireCanonicalUint(
      record.principalTargetUsdc,
      `${name}.principalTargetUsdc`,
    ),
    usdcLiquidity: requireCanonicalUint(
      record.usdcLiquidity,
      `${name}.usdcLiquidity`,
    ),
    reservedUsdc: requireCanonicalUint(
      record.reservedUsdc,
      `${name}.reservedUsdc`,
    ),
    riskUsdc: requireCanonicalUint(record.riskUsdc, `${name}.riskUsdc`),
    activeAcceptedOrders: requireCanonicalNumber(
      record.activeAcceptedOrders,
      `${name}.activeAcceptedOrders`,
      0,
    ),
    maxActiveAcceptedOrders: requireCanonicalNumber(
      record.maxActiveAcceptedOrders,
      `${name}.maxActiveAcceptedOrders`,
      1,
    ),
    openOfferCount: requireCanonicalNumber(
      record.openOfferCount,
      `${name}.openOfferCount`,
      0,
    ),
    openOfferUsdc: requireCanonicalUint(
      record.openOfferUsdc,
      `${name}.openOfferUsdc`,
    ),
    virtualFinish: requireNullableCanonicalUint(
      record.virtualFinish,
      `${name}.virtualFinish`,
    ),
    lastAssignedAt: requireNullableCanonicalUint(
      record.lastAssignedAt,
      `${name}.lastAssignedAt`,
    ),
    lastAcceptedAt: requireNullableCanonicalUint(
      record.lastAcceptedAt,
      `${name}.lastAcceptedAt`,
    ),
    recentFailureTier: requireCanonicalNumber(
      record.recentFailureTier,
      `${name}.recentFailureTier`,
      0,
    ),
    channels,
    observedAtBlock: requireCanonicalUint(
      record.observedAtBlock,
      `${name}.observedAtBlock`,
    ),
    observedAtBlockHash: requireBytes32(
      record.observedAtBlockHash,
      `${name}.observedAtBlockHash`,
    ),
  };
}

function decodeCanonicalChannel(
  value: unknown,
  name: string,
): ChannelSnapshot {
  const record = requireExactRecord(
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
    channelId: requireBytes32(record.channelId, `${name}.channelId`),
    merchant: requireAddress(record.merchant, `${name}.merchant`),
    fiatCurrency: requireString(
      record.fiatCurrency,
      `${name}.fiatCurrency`,
      32,
    ),
    paymentRailGroup: requireString(
      record.paymentRailGroup,
      `${name}.paymentRailGroup`,
      64,
    ),
    status: requireEnum(
      record.status,
      `${name}.status`,
      ["PENDING", "APPROVED", "REJECTED", "TERMINATED"] as const,
    ),
    availability: requireEnum(
      record.availability,
      `${name}.availability`,
      ["ACTIVE", "INACTIVE"] as const,
    ),
    grossFiat: requireCanonicalUint(record.grossFiat, `${name}.grossFiat`),
    reservedFiat: requireCanonicalUint(
      record.reservedFiat,
      `${name}.reservedFiat`,
    ),
    fiatPrincipalUsdc: requireCanonicalUint(
      record.fiatPrincipalUsdc,
      `${name}.fiatPrincipalUsdc`,
    ),
    reservedPrincipalUsdc: requireCanonicalUint(
      record.reservedPrincipalUsdc,
      `${name}.reservedPrincipalUsdc`,
    ),
    dailyVolumeUsedUsdc: requireCanonicalUint(
      record.dailyVolumeUsedUsdc,
      `${name}.dailyVolumeUsedUsdc`,
    ),
    dailyLimitUsdc: requireNullableCanonicalUint(
      record.dailyLimitUsdc,
      `${name}.dailyLimitUsdc`,
    ),
    monthlyVolumeUsedUsdc: requireCanonicalUint(
      record.monthlyVolumeUsedUsdc,
      `${name}.monthlyVolumeUsedUsdc`,
    ),
    monthlyLimitUsdc: requireNullableCanonicalUint(
      record.monthlyLimitUsdc,
      `${name}.monthlyLimitUsdc`,
    ),
    protocolFiatDeficit: requireCanonicalUint(
      record.protocolFiatDeficit,
      `${name}.protocolFiatDeficit`,
    ),
    reconciliationRequired: requireBoolean(
      record.reconciliationRequired,
      `${name}.reconciliationRequired`,
    ),
    openOfferCount: requireCanonicalNumber(
      record.openOfferCount,
      `${name}.openOfferCount`,
      0,
    ),
  };
}

function decodeCanonicalOperator(
  value: unknown,
  name: string,
): OperatorRoutingSnapshot {
  const record = requireExactRecord(
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
    operatorId: requireBytes32(record.operatorId, `${name}.operatorId`),
    failureDomainId: requireBytes32(
      record.failureDomainId,
      `${name}.failureDomainId`,
    ),
    wallets: requireArray(record.wallets, `${name}.wallets`).map(
      (wallet, index) =>
        requireAddress(wallet, `${name}.wallets[${index}]`),
    ),
    acceptedUsdc: requireCanonicalUint(
      record.acceptedUsdc,
      `${name}.acceptedUsdc`,
    ),
    virtualFinishQ: requireNullableCanonicalUint(
      record.virtualFinishQ,
      `${name}.virtualFinishQ`,
    ),
    openOffers: requireArray(
      record.openOffers,
      `${name}.openOffers`,
    ).map((offer, index) =>
      decodeCanonicalOpenOffer(offer, `${name}.openOffers[${index}]`)
    ),
    activeAcceptedOrders: requireCanonicalNumber(
      record.activeAcceptedOrders,
      `${name}.activeAcceptedOrders`,
      0,
    ),
    maxActiveAcceptedOrders: requireCanonicalNumber(
      record.maxActiveAcceptedOrders,
      `${name}.maxActiveAcceptedOrders`,
      1,
    ),
    recentFailureTier: requireCanonicalNumber(
      record.recentFailureTier,
      `${name}.recentFailureTier`,
      0,
    ),
    lastAcceptedOrAssignedAt: requireNullableCanonicalUint(
      record.lastAcceptedOrAssignedAt,
      `${name}.lastAcceptedOrAssignedAt`,
    ),
  };
}

function decodeCanonicalOpenOffer(
  value: unknown,
  name: string,
): OpenOfferSlot {
  const record = requireExactRecord(
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
    slotId: requireBytes32(record.slotId, `${name}.slotId`),
    orderId: requireBytes32(record.orderId, `${name}.orderId`),
    round: requireCanonicalUint(record.round, `${name}.round`),
    operatorId: requireBytes32(record.operatorId, `${name}.operatorId`),
    merchant: requireAddress(record.merchant, `${name}.merchant`),
    channelId: requireBytes32(record.channelId, `${name}.channelId`),
    usdcAmount: requirePositiveCanonicalUint(
      record.usdcAmount,
      `${name}.usdcAmount`,
    ),
    openedAtSequence: requireCanonicalUint(
      record.openedAtSequence,
      `${name}.openedAtSequence`,
    ),
  };
}

function decodeCanonicalHistory(
  value: unknown,
  name: string,
): SelectionHistoryEvent {
  const record = requireExactRecord(
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
    eventId: requireBytes32(record.eventId, `${name}.eventId`),
    operatorId: requireBytes32(record.operatorId, `${name}.operatorId`),
    decisionId: requireBytes32(record.decisionId, `${name}.decisionId`),
    orderId: requireBytes32(record.orderId, `${name}.orderId`),
    round: requireCanonicalUint(record.round, `${name}.round`),
    sequence: requireCanonicalUint(record.sequence, `${name}.sequence`),
    kind: requireEnum(
      record.kind,
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

function decodeCanonicalUniverse(
  value: unknown,
): CandidateUniverseEvidence {
  const record = requireExactRecord(
    value,
    "witness.input.universe",
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
      record.complete,
      "witness.input.universe.complete",
    ),
    pageCount: requireCanonicalNumber(
      record.pageCount,
      "witness.input.universe.pageCount",
      1,
    ),
    expectedEntryCount: requireCanonicalNumber(
      record.expectedEntryCount,
      "witness.input.universe.expectedEntryCount",
      0,
    ),
    finalizedBlock: requireCanonicalUint(
      record.finalizedBlock,
      "witness.input.universe.finalizedBlock",
    ),
    finalizedBlockHash: requireBytes32(
      record.finalizedBlockHash,
      "witness.input.universe.finalizedBlockHash",
    ),
  };
}

function decodeCanonicalPolicyWitness(value: unknown): {
  readonly policy: SelectionPolicy;
  readonly shadowPolicy: ShadowSelectionPolicy;
} {
  const witness = requireExactRecord(
    value,
    "witness.input.canonicalPolicyWitness",
    [
      "schema",
      "councilBillSha256",
      "councilVerdict",
      "actionAuthorization",
      "selectionPolicy",
      "shadowPolicy",
    ],
  );
  if (
    witness.schema !== "p2pflow.shadow-policy-witness.v1" ||
    witness.councilBillSha256 !== COUNCIL_BILL_SHA256 ||
    witness.councilVerdict !== COUNCIL_VERDICT ||
    witness.actionAuthorization !== false
  ) {
    throw new WitnessReplayError(
      "Witness policy does not bind the current Council REJECT",
    );
  }
  const material = decodeCanonicalPolicyMaterial(witness.selectionPolicy);
  const shadowPolicy = decodeCanonicalShadowPolicy(witness.shadowPolicy);
  return {
    policy: {
      ...material,
      policyHash: selectionPolicyHash(material, shadowPolicy),
    },
    shadowPolicy,
  };
}

function decodeCanonicalPolicyMaterial(
  value: unknown,
): SelectionPolicyMaterial {
  const record = requireExactRecord(
    value,
    "witness.input.canonicalPolicyWitness.selectionPolicy",
    [
      "version",
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
  const candidateCount = requireCanonicalNumber(
    record.candidateCount,
    "witness.policy.candidateCount",
    4,
    4,
  );
  if (candidateCount !== 4) {
    throw new WitnessReplayError(
      "Witness selection policy must require exactly four candidates",
    );
  }
  const numerator = requireCanonicalUint(
    record.openOfferWeightNumerator,
    "witness.policy.openOfferWeightNumerator",
  );
  const denominator = requirePositiveCanonicalUint(
    record.openOfferWeightDenominator,
    "witness.policy.openOfferWeightDenominator",
  );
  if (numerator >= denominator) {
    throw new WitnessReplayError(
      "Witness open-offer weight must be strictly below one",
    );
  }
  const minOrderUsdc = requirePositiveCanonicalUint(
    record.minOrderUsdc,
    "witness.policy.minOrderUsdc",
  );
  const maxOrderUsdc = requirePositiveCanonicalUint(
    record.maxOrderUsdc,
    "witness.policy.maxOrderUsdc",
  );
  if (maxOrderUsdc < minOrderUsdc) {
    throw new WitnessReplayError(
      "Witness maximum order amount is below its minimum",
    );
  }
  return {
    version: requireString(record.version, "witness.policy.version", 128),
    candidateCount: 4,
    assignmentTtlSeconds: requireCanonicalNumber(
      record.assignmentTtlSeconds,
      "witness.policy.assignmentTtlSeconds",
      1,
    ),
    leaseStepSeconds: requireCanonicalNumber(
      record.leaseStepSeconds,
      "witness.policy.leaseStepSeconds",
      1,
    ),
    maxStateAgeBlocks: requireCanonicalNumber(
      record.maxStateAgeBlocks,
      "witness.policy.maxStateAgeBlocks",
      1,
    ),
    maxPendingOffersPerMerchant: requireCanonicalNumber(
      record.maxPendingOffersPerMerchant,
      "witness.policy.maxPendingOffersPerMerchant",
      1,
    ),
    openOfferWeightNumerator: numerator,
    openOfferWeightDenominator: denominator,
    targetFiatShareBps: requireCanonicalNumber(
      record.targetFiatShareBps,
      "witness.policy.targetFiatShareBps",
      0,
      10_000,
    ),
    buySafetyBufferBps: requireCanonicalNumber(
      record.buySafetyBufferBps,
      "witness.policy.buySafetyBufferBps",
      0,
      10_000,
    ),
    minBuySafetyBufferUsdc: requireCanonicalUint(
      record.minBuySafetyBufferUsdc,
      "witness.policy.minBuySafetyBufferUsdc",
    ),
    maxPriceDeviationBps: requireCanonicalNumber(
      record.maxPriceDeviationBps,
      "witness.policy.maxPriceDeviationBps",
      1,
      10_000,
    ),
    minMerchantStakeUsdc: requirePositiveCanonicalUint(
      record.minMerchantStakeUsdc,
      "witness.policy.minMerchantStakeUsdc",
    ),
    minOrderUsdc,
    maxOrderUsdc,
    acceptedOrderTimeoutSeconds: requireCanonicalNumber(
      record.acceptedOrderTimeoutSeconds,
      "witness.policy.acceptedOrderTimeoutSeconds",
      1,
    ),
    disputeWindowSeconds: requireCanonicalNumber(
      record.disputeWindowSeconds,
      "witness.policy.disputeWindowSeconds",
      1,
    ),
  };
}

function decodeCanonicalShadowPolicy(
  value: unknown,
): ShadowSelectionPolicy {
  const record = requireExactRecord(
    value,
    "witness.input.canonicalPolicyWitness.shadowPolicy",
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
  if (record.schema !== "p2pflow.shadow-selection-policy.v1") {
    throw new WitnessReplayError("Witness shadow policy schema is invalid");
  }
  const readinessReserveF = requireCanonicalNumber(
    record.readinessReserveF,
    "witness.shadowPolicy.readinessReserveF",
    0,
  );
  const concentrationWindowSequences = requireCanonicalNumber(
    record.concentrationWindowSequences,
    "witness.shadowPolicy.concentrationWindowSequences",
    1,
  );
  const maxRankZeroPerOperatorInWindow = requireCanonicalNumber(
    record.maxRankZeroPerOperatorInWindow,
    "witness.shadowPolicy.maxRankZeroPerOperatorInWindow",
    1,
    concentrationWindowSequences,
  );
  return {
    schema: "p2pflow.shadow-selection-policy.v1",
    readinessReserveF,
    minimumFinalAcceptanceWindowSeconds: requireCanonicalNumber(
      record.minimumFinalAcceptanceWindowSeconds,
      "witness.shadowPolicy.minimumFinalAcceptanceWindowSeconds",
      1,
    ),
    allowUnlimitedChannelLimits: requireBoolean(
      record.allowUnlimitedChannelLimits,
      "witness.shadowPolicy.allowUnlimitedChannelLimits",
    ),
    concentrationWindowSequences,
    maxRankZeroPerOperatorInWindow,
    nonresponseCooldownSequences: requirePositiveCanonicalUint(
      record.nonresponseCooldownSequences,
      "witness.shadowPolicy.nonresponseCooldownSequences",
    ),
    cohortExpansionPerCoolingOperator: requireCanonicalNumber(
      record.cohortExpansionPerCoolingOperator,
      "witness.shadowPolicy.cohortExpansionPerCoolingOperator",
      1,
    ),
    maxCohortExpansion: requireCanonicalNumber(
      record.maxCohortExpansion,
      "witness.shadowPolicy.maxCohortExpansion",
      readinessReserveF,
    ),
  };
}

function validateUniverseEvidence(
  rawCandidates: readonly unknown[],
  rawEntries: readonly unknown[],
  candidates: readonly CandidateSnapshot[],
  universe: CandidateUniverseEvidence,
  order: OrderSnapshot,
): void {
  if (
    !universe.complete ||
    universe.expectedEntryCount !== rawEntries.length ||
    universe.finalizedBlock !== order.snapshotBlock ||
    universe.finalizedBlockHash.toLowerCase() !==
      order.snapshotBlockHash.toLowerCase()
  ) {
    throw new WitnessReplayError(
      "Witness candidate-universe evidence is incomplete or detached",
    );
  }
  const rawByMerchant = new Map<string, unknown>();
  const expectedKeys = new Set<string>();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const rawCandidate = rawCandidates[index];
    if (candidate === undefined || rawCandidate === undefined) {
      throw new WitnessReplayError(
        "Witness candidate reconstruction lost positional evidence",
      );
    }
    const merchant = candidate.merchant.toLowerCase();
    if (rawByMerchant.has(merchant)) {
      throw new WitnessReplayError(
        "Witness input contains duplicate candidate merchants",
      );
    }
    rawByMerchant.set(merchant, rawCandidate);
    if (candidate.channels.length === 0) {
      expectedKeys.add(evidenceKey(candidate.merchant, null));
    } else {
      for (const channel of candidate.channels) {
        expectedKeys.add(evidenceKey(candidate.merchant, channel.channelId));
      }
    }
  }

  const actualKeys = new Set<string>();
  for (let index = 0; index < rawEntries.length; index += 1) {
    const name = `witness.universeEntries[${index}]`;
    const entry = requireExactRecord(
      rawEntries[index],
      name,
      ["merchant", "channelId", "candidate"],
    );
    const merchant = requireAddress(entry.merchant, `${name}.merchant`);
    const channelId = entry.channelId === null
      ? null
      : requireBytes32(entry.channelId, `${name}.channelId`);
    const key = evidenceKey(merchant, channelId);
    if (actualKeys.has(key)) {
      throw new WitnessReplayError(
        "Witness universe contains ambiguous candidate-channel evidence",
      );
    }
    actualKeys.add(key);
    const rawCandidate = rawByMerchant.get(merchant.toLowerCase());
    if (
      rawCandidate === undefined ||
      canonicalJson(rawCandidate) !== canonicalJson(entry.candidate)
    ) {
      throw new WitnessReplayError(
        "Witness universe entry is detached from its input candidate",
      );
    }
  }
  assertExactEvidenceSet(expectedKeys, actualKeys, "candidate universe");
}

function decodeEligibilityEvidence(
  rawPrestates: readonly unknown[],
  candidates: readonly CandidateSnapshot[],
  operators: readonly OperatorRoutingSnapshot[],
  order: OrderSnapshot,
): readonly ReplayEligibilityEntry[] {
  const expectedKeys = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.channels.length === 0) {
      expectedKeys.add(evidenceKey(candidate.merchant, null));
    } else {
      for (const channel of candidate.channels) {
        expectedKeys.add(evidenceKey(candidate.merchant, channel.channelId));
      }
    }
  }
  const operatorByWallet = new Map<string, OperatorRoutingSnapshot>();
  for (const operator of operators) {
    for (const wallet of operator.wallets) {
      const walletKey = wallet.toLowerCase();
      if (operatorByWallet.has(walletKey)) {
        throw new WitnessReplayError(
          "Witness maps one wallet to multiple economic operators",
        );
      }
      operatorByWallet.set(walletKey, operator);
    }
  }

  const actualKeys = new Set<string>();
  const results: ReplayEligibilityEntry[] = [];
  for (let index = 0; index < rawPrestates.length; index += 1) {
    const name = `witness.eligibilityPrestates[${index}]`;
    const prestate = requireExactRecord(
      rawPrestates[index],
      name,
      [
        "operatorId",
        "failureDomainId",
        "merchant",
        "channelId",
        "eligibilityCode",
        "required",
        "available",
        "source",
        "checkedAtBlock",
        "operatorAcceptedUsdc",
        "operatorVirtualFinishQ",
        "baseVirtualFinishQ",
        "openOfferCount",
        "openOfferRoot",
        "liveOfferUsdc",
        "offerLoadQ",
        "activeAcceptedOrders",
        "maxActiveAcceptedOrders",
        "rankingFinishQ",
        "forecastFinishQ",
        "inventoryImbalanceBps",
        "cooling",
        "concentrationCount",
      ],
    );
    const merchant = requireAddress(prestate.merchant, `${name}.merchant`);
    const channelId = prestate.channelId === null
      ? null
      : requireBytes32(prestate.channelId, `${name}.channelId`);
    const key = evidenceKey(merchant, channelId);
    if (!expectedKeys.has(key) || actualKeys.has(key)) {
      throw new WitnessReplayError(
        "Witness eligibility evidence is ambiguous or detached",
      );
    }
    actualKeys.add(key);

    const operator = operatorByWallet.get(merchant.toLowerCase());
    if (
      operator === undefined ||
      requireBytes32(prestate.operatorId, `${name}.operatorId`).toLowerCase() !==
        operator.operatorId.toLowerCase() ||
      requireBytes32(
        prestate.failureDomainId,
        `${name}.failureDomainId`,
      ).toLowerCase() !== operator.failureDomainId.toLowerCase()
    ) {
      throw new WitnessReplayError(
        "Witness eligibility evidence is detached from its economic operator",
      );
    }
    const code = requireEligibilityCode(
      prestate.eligibilityCode,
      `${name}.eligibilityCode`,
    );
    const required = requireCanonicalUint(
      prestate.required,
      `${name}.required`,
    );
    const available = requireCanonicalUint(
      prestate.available,
      `${name}.available`,
    );
    if (code === "ELIGIBLE" && (required === 0n || available < required)) {
      throw new WitnessReplayError(
        "Witness ELIGIBLE evidence has insufficient available value",
      );
    }
    const source = requireEnum(
      prestate.source,
      `${name}.source`,
      ["snapshot", "contract"] as const,
    );
    const checkedAtBlock = requireCanonicalUint(
      prestate.checkedAtBlock,
      `${name}.checkedAtBlock`,
    );
    if (checkedAtBlock !== order.snapshotBlock) {
      throw new WitnessReplayError(
        "Witness eligibility evidence is checked at another block",
      );
    }
    validatePrestateAccounting(prestate, name, operator);
    if (channelId !== null) {
      results.push({
        merchant,
        channelId,
        result: {
          code,
          required,
          available,
          source,
          checkedAtBlock,
        },
      });
    }
  }
  assertExactEvidenceSet(
    expectedKeys,
    actualKeys,
    "eligibility prestate",
  );
  return results;
}

function validatePrestateAccounting(
  prestate: Record<string, unknown>,
  name: string,
  operator: OperatorRoutingSnapshot,
): void {
  const operatorAcceptedUsdc = requireCanonicalUint(
    prestate.operatorAcceptedUsdc,
    `${name}.operatorAcceptedUsdc`,
  );
  const operatorVirtualFinishQ = requireNullableCanonicalUint(
    prestate.operatorVirtualFinishQ,
    `${name}.operatorVirtualFinishQ`,
  );
  const openOfferCount = requireCanonicalNumber(
    prestate.openOfferCount,
    `${name}.openOfferCount`,
    0,
  );
  const activeAcceptedOrders = requireCanonicalNumber(
    prestate.activeAcceptedOrders,
    `${name}.activeAcceptedOrders`,
    0,
  );
  const maxActiveAcceptedOrders = requireCanonicalNumber(
    prestate.maxActiveAcceptedOrders,
    `${name}.maxActiveAcceptedOrders`,
    1,
  );
  if (
    operatorAcceptedUsdc !== operator.acceptedUsdc ||
    operatorVirtualFinishQ !== operator.virtualFinishQ ||
    openOfferCount !== operator.openOffers.length ||
    activeAcceptedOrders !== operator.activeAcceptedOrders ||
    maxActiveAcceptedOrders !== operator.maxActiveAcceptedOrders
  ) {
    throw new WitnessReplayError(
      "Witness eligibility prestate is detached from operator accounting",
    );
  }
  const openOfferRoot = canonicalMerkleRoot(
    "p2pflow.operator-open-offers.v1",
    operator.openOffers,
  );
  if (
    requireBytes32(prestate.openOfferRoot, `${name}.openOfferRoot`)
      .toLowerCase() !== openOfferRoot.toLowerCase()
  ) {
    throw new WitnessReplayError(
      "Witness eligibility prestate has a detached open-offer root",
    );
  }
  const liveOfferUsdc = operator.openOffers.reduce(
    (total, offer) => total + offer.usdcAmount,
    0n,
  );
  if (
    requireCanonicalUint(
      prestate.liveOfferUsdc,
      `${name}.liveOfferUsdc`,
    ) !== liveOfferUsdc
  ) {
    throw new WitnessReplayError(
      "Witness eligibility prestate has detached open-offer volume",
    );
  }
  for (const key of [
    "baseVirtualFinishQ",
    "offerLoadQ",
    "rankingFinishQ",
    "forecastFinishQ",
    "inventoryImbalanceBps",
  ] as const) {
    requireCanonicalUint(prestate[key], `${name}.${key}`);
  }
  requireBoolean(prestate.cooling, `${name}.cooling`);
  requireCanonicalNumber(
    prestate.concentrationCount,
    `${name}.concentrationCount`,
    0,
  );
}

function validateExclusions(value: unknown): void {
  const exclusions = requireArray(value, "witness.exclusions");
  for (let index = 0; index < exclusions.length; index += 1) {
    const name = `witness.exclusions[${index}]`;
    const exclusion = requireExactRecord(
      exclusions[index],
      name,
      ["merchant", "channelId", "result"],
    );
    requireAddress(exclusion.merchant, `${name}.merchant`);
    if (exclusion.channelId !== null) {
      requireBytes32(exclusion.channelId, `${name}.channelId`);
    }
    decodeCanonicalEligibilityResult(
      exclusion.result,
      `${name}.result`,
    );
  }
}

function decodeCanonicalEligibilityResult(
  value: unknown,
  name: string,
): EligibilityResult {
  const record = requireExactRecord(
    value,
    name,
    ["code", "required", "available", "source", "checkedAtBlock"],
  );
  const code = requireEligibilityCode(record.code, `${name}.code`);
  const required = requireCanonicalUint(
    record.required,
    `${name}.required`,
  );
  const available = requireCanonicalUint(
    record.available,
    `${name}.available`,
  );
  if (code === "ELIGIBLE" && (required === 0n || available < required)) {
    throw new WitnessReplayError(
      `${name} contains inconsistent ELIGIBLE evidence`,
    );
  }
  return {
    code,
    required,
    available,
    source: requireEnum(
      record.source,
      `${name}.source`,
      ["snapshot", "contract"] as const,
    ),
    checkedAtBlock: requireCanonicalUint(
      record.checkedAtBlock,
      `${name}.checkedAtBlock`,
    ),
  };
}

function decodeWitnessOutput(value: unknown): DecodedWitnessOutput {
  const output = requireExactRecord(
    value,
    "witness.output",
    [
      "serviceStatus",
      "noServiceReason",
      "candidates",
      "leaseSchedule",
      "outputRoot",
    ],
  );
  const serviceStatus = requireEnum(
    output.serviceStatus,
    "witness.output.serviceStatus",
    ["SHADOW_DECISION", "NO_SERVICE"] as const,
  );
  const candidates = requireArray(
    output.candidates,
    "witness.output.candidates",
  );
  const leases = requireArray(
    output.leaseSchedule,
    "witness.output.leaseSchedule",
  );
  const outputRoot = requireBytes32(
    output.outputRoot,
    "witness.output.outputRoot",
  );
  if (serviceStatus === "SHADOW_DECISION") {
    if (
      output.noServiceReason !== null ||
      candidates.length !== 4 ||
      leases.length !== 4
    ) {
      throw new WitnessReplayError(
        "Witness decision output must contain exactly four candidates and leases",
      );
    }
    const operatorIds = new Set<string>();
    const unlocks: bigint[] = [];
    for (let index = 0; index < 4; index += 1) {
      const candidateName = `witness.output.candidates[${index}]`;
      const candidate = requireExactRecord(
        candidates[index],
        candidateName,
        [
          "operatorId",
          "failureDomainId",
          "merchant",
          "channelId",
          "rank",
          "rankingFinishQ",
          "forecastFinishQ",
          "unlockAt",
        ],
      );
      const operatorId = requireBytes32(
        candidate.operatorId,
        `${candidateName}.operatorId`,
      ).toLowerCase();
      if (operatorIds.has(operatorId)) {
        throw new WitnessReplayError(
          "Witness decision output repeats an economic operator",
        );
      }
      operatorIds.add(operatorId);
      requireBytes32(
        candidate.failureDomainId,
        `${candidateName}.failureDomainId`,
      );
      requireAddress(candidate.merchant, `${candidateName}.merchant`);
      requireBytes32(candidate.channelId, `${candidateName}.channelId`);
      if (
        requireCanonicalNumber(
          candidate.rank,
          `${candidateName}.rank`,
          index,
          index,
        ) !== index
      ) {
        throw new WitnessReplayError("Witness candidate ranks are not ordered");
      }
      requireCanonicalUint(
        candidate.rankingFinishQ,
        `${candidateName}.rankingFinishQ`,
      );
      requireCanonicalUint(
        candidate.forecastFinishQ,
        `${candidateName}.forecastFinishQ`,
      );
      unlocks.push(
        requireCanonicalUint(
          candidate.unlockAt,
          `${candidateName}.unlockAt`,
        ),
      );
    }
    for (let index = 0; index < 4; index += 1) {
      const leaseName = `witness.output.leaseSchedule[${index}]`;
      const lease = requireExactRecord(
        leases[index],
        leaseName,
        ["rank", "unlockAt", "intervalEnd"],
      );
      requireCanonicalNumber(lease.rank, `${leaseName}.rank`, index, index);
      const unlockAt = requireCanonicalUint(
        lease.unlockAt,
        `${leaseName}.unlockAt`,
      );
      const intervalEnd = requireCanonicalUint(
        lease.intervalEnd,
        `${leaseName}.intervalEnd`,
      );
      if (unlocks[index] !== unlockAt || intervalEnd <= unlockAt) {
        throw new WitnessReplayError(
          "Witness decision lease schedule is inconsistent",
        );
      }
    }
    const computedRoot = canonicalMerkleRoot(
      "p2pflow.shadow-output.v2",
      [{ candidates, leaseSchedule: leases }],
    );
    assertDigestEquals(computedRoot, outputRoot, "witness output root");
    return {
      serviceStatus,
      noServiceReason: null,
      candidates,
      leaseSchedule: leases,
      outputRoot,
    };
  }

  const noServiceReason = requireNoServiceReason(
    output.noServiceReason,
    "witness.output.noServiceReason",
  );
  if (candidates.length !== 0 || leases.length !== 0) {
    throw new WitnessReplayError(
      "No-service witness output cannot contain candidates or leases",
    );
  }
  const computedRoot = canonicalMerkleRoot(
    "p2pflow.shadow-no-service-output.v2",
    [{ reason: noServiceReason }],
  );
  assertDigestEquals(computedRoot, outputRoot, "witness output root");
  return {
    serviceStatus,
    noServiceReason,
    candidates,
    leaseSchedule: leases,
    outputRoot,
  };
}

function buildExpectedCanonicalPayload(
  input: SelectionInput,
  witnessContentId: Bytes32,
  universeCount: number,
  universeRoot: Bytes32,
  eligibilityPrestateRoot: Bytes32,
  output: DecodedWitnessOutput,
): string {
  if (output.serviceStatus === "SHADOW_DECISION") {
    return canonicalJson({
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
      witnessContentId,
      universeCount,
      universeRoot,
      eligibilityPrestateRoot,
      candidates: output.candidates,
      leaseSchedule: output.leaseSchedule,
      outputRoot: output.outputRoot,
    });
  }
  return canonicalJson({
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
    witnessContentId,
    universeCount,
    universeRoot,
    eligibilityPrestateRoot,
    outputRoot: output.outputRoot,
    reason: output.noServiceReason,
  });
}

function parseCanonicalWitness(source: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    throw new WitnessReplayError("Witness is not valid JSON");
  }
  if (canonicalJson(parsed) !== source) {
    throw new WitnessReplayError("Witness text is not canonical JSON");
  }
  return parsed;
}

function requireExactRecord(
  value: unknown,
  name: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new WitnessReplayError(`${name} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(record, key))
  ) {
    throw new WitnessReplayError(
      `${name} does not have the exact required field set`,
    );
  }
  return record;
}

function requireArray(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new WitnessReplayError(`${name} must be an array`);
  }
  return value;
}

function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new WitnessReplayError(`${name} must be a boolean`);
  }
  return value;
}

function requireString(
  value: unknown,
  name: string,
  maximumLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.normalize("NFC") !== value
  ) {
    throw new WitnessReplayError(
      `${name} must be a bounded canonical string`,
    );
  }
  return value;
}

function requireCanonicalUint(value: unknown, name: string): bigint {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(value)
  ) {
    throw new WitnessReplayError(
      `${name} must be a canonical unsigned integer string`,
    );
  }
  const result = BigInt(value);
  if (result > MAX_UINT256) {
    throw new WitnessReplayError(`${name} exceeds uint256`);
  }
  return result;
}

function requirePositiveCanonicalUint(
  value: unknown,
  name: string,
): bigint {
  const result = requireCanonicalUint(value, name);
  if (result === 0n) {
    throw new WitnessReplayError(`${name} must be positive`);
  }
  return result;
}

function requireNullableCanonicalUint(
  value: unknown,
  name: string,
): bigint | null {
  return value === null ? null : requireCanonicalUint(value, name);
}

function requireCanonicalNumber(
  value: unknown,
  name: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const parsed = requireCanonicalUint(value, name);
  if (
    parsed > BigInt(Number.MAX_SAFE_INTEGER) ||
    parsed < BigInt(minimum) ||
    parsed > BigInt(maximum)
  ) {
    throw new WitnessReplayError(
      `${name} is outside its safe integer range`,
    );
  }
  return Number(parsed);
}

function requireAddress(value: unknown, name: string): Address {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/.test(value)) {
    throw new WitnessReplayError(
      `${name} must be a canonical lowercase address`,
    );
  }
  return value as Address;
}

function requireBytes32(value: unknown, name: string): Bytes32 {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)) {
    throw new WitnessReplayError(
      `${name} must be a canonical lowercase bytes32 value`,
    );
  }
  return value as Bytes32;
}

function requireEnum<const Values extends readonly string[]>(
  value: unknown,
  name: string,
  values: Values,
): Values[number] {
  if (
    typeof value !== "string" ||
    !values.some((allowed) => allowed === value)
  ) {
    throw new WitnessReplayError(
      `${name} must be one of ${values.join(", ")}`,
    );
  }
  return value as Values[number];
}

function requireEligibilityCode(
  value: unknown,
  name: string,
): EligibilityCode {
  if (typeof value !== "string" || !ELIGIBILITY_CODES.has(value)) {
    throw new WitnessReplayError(`${name} is not a known eligibility code`);
  }
  return value as EligibilityCode;
}

function requireNoServiceReason(
  value: unknown,
  name: string,
): ShadowNoServiceReason {
  if (
    typeof value !== "string" ||
    !NO_SERVICE_REASONS.some((reason) => reason === value)
  ) {
    throw new WitnessReplayError(`${name} is invalid`);
  }
  return value as ShadowNoServiceReason;
}

function evidenceKey(
  merchant: Address,
  channelId: Bytes32 | null,
): string {
  return `${merchant.toLowerCase()}:${channelId?.toLowerCase() ?? "null"}`;
}

function assertExactEvidenceSet(
  expected: ReadonlySet<string>,
  actual: ReadonlySet<string>,
  name: string,
): void {
  if (
    expected.size !== actual.size ||
    [...expected].some((key) => !actual.has(key))
  ) {
    throw new WitnessReplayError(
      `Witness ${name} evidence is incomplete or detached`,
    );
  }
}

function assertDigestEquals(
  actual: Bytes32,
  expected: Bytes32,
  name: string,
): void {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new WitnessReplayError(
      `Replayed ${name} differs from witness-derived evidence`,
    );
  }
}
