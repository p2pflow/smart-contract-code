import { isDeepStrictEqual } from "node:util";
import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_DIAMOND_ADDRESS,
  COUNCIL_BILL_SHA256,
  COUNCIL_VERDICT,
} from "../authority";
import { canonicalJson } from "../canonical/canonical-json";
import {
  canonicalMerkleRoot,
  hashCanonicalPayloadText,
  SelectionInput,
  ShadowSelectionResult,
  ShadowNoServiceReason,
  verifyCanonicalPayloadText,
} from "../selection";
import {
  decodeWitnessReplay,
  executeWitnessReplay,
} from "../replay/witness-codec";

export interface ShadowTraceRecord {
  readonly traceId: `0x${string}`;
  readonly decisionId: `0x${string}` | null;
  readonly chainId: number;
  readonly orderId: `0x${string}`;
  readonly round: bigint;
  readonly sequence: bigint;
  readonly stateBlock: bigint;
  readonly stateBlockHash: `0x${string}`;
  readonly policyHash: `0x${string}`;
  readonly helperBuildHash: `0x${string}`;
  readonly universeCount: number;
  readonly universeRoot: `0x${string}`;
  readonly eligibilityPrestateRoot: `0x${string}`;
  readonly outputRoot: `0x${string}`;
  readonly witnessContentId: `0x${string}`;
  readonly canonicalWitness: string;
  readonly canonicalPayload: string;
  readonly serviceStatus: "SHADOW_DECISION" | "NO_SERVICE";
  readonly noServiceReason: ShadowNoServiceReason | null;
  readonly capability: "TRANSACTION_DISABLED_SHADOW_ONLY";
  readonly actionAuthorization: false;
  readonly forecastOnly: true;
  readonly selectedOperatorIds: readonly `0x${string}`[];
  readonly createdAtMs: number;
}

export type AppendShadowTraceResult =
  | { readonly inserted: true; readonly record: ShadowTraceRecord }
  | { readonly inserted: false; readonly record: ShadowTraceRecord };

export interface ShadowTraceLedger {
  append(record: ShadowTraceRecord): Promise<AppendShadowTraceResult>;
  get(traceId: `0x${string}`): Promise<ShadowTraceRecord | null>;
  getByOrderSequence(
    chainId: number,
    orderId: `0x${string}`,
    round: bigint,
    sequence: bigint,
  ): Promise<ShadowTraceRecord | null>;
}

export class ShadowTraceConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ShadowTraceConflictError";
  }
}

export class InMemoryShadowTraceLedger implements ShadowTraceLedger {
  private readonly byId = new Map<string, ShadowTraceRecord>();
  private readonly byOrderSequence = new Map<string, string>();

  public async append(
    record: ShadowTraceRecord,
  ): Promise<AppendShadowTraceResult> {
    const canonicalRecord = canonicalizeShadowTraceRecord(record);
    await validateAndReplayShadowTraceRecord(canonicalRecord);
    const id = canonicalRecord.traceId;
    const identity = orderSequenceKey(
      canonicalRecord.chainId,
      canonicalRecord.orderId,
      canonicalRecord.round,
      canonicalRecord.sequence,
    );
    const existingIdentity = this.byOrderSequence.get(identity);
    if (existingIdentity !== undefined && existingIdentity !== id) {
      throw new ShadowTraceConflictError(
        `Order sequence ${identity} already has another trace`,
      );
    }
    const existing = this.byId.get(id);
    if (existing !== undefined) {
      if (!isDeepStrictEqual(existing, canonicalRecord)) {
        throw new ShadowTraceConflictError(
          `Trace ${canonicalRecord.traceId} was reused with different data`,
        );
      }
      return { inserted: false, record: cloneRecord(existing) };
    }
    const stored = cloneRecord(canonicalRecord);
    this.byId.set(id, stored);
    this.byOrderSequence.set(identity, id);
    return { inserted: true, record: cloneRecord(stored) };
  }

  public async get(
    traceId: `0x${string}`,
  ): Promise<ShadowTraceRecord | null> {
    const record = this.byId.get(traceId.toLowerCase());
    return record === undefined ? null : cloneRecord(record);
  }

  public async getByOrderSequence(
    chainId: number,
    orderId: `0x${string}`,
    round: bigint,
    sequence: bigint,
  ): Promise<ShadowTraceRecord | null> {
    const id = this.byOrderSequence.get(
      orderSequenceKey(chainId, orderId, round, sequence),
    );
    if (id === undefined) return null;
    const record = this.byId.get(id);
    return record === undefined ? null : cloneRecord(record);
  }
}

export function validateShadowTraceRecord(
  record: ShadowTraceRecord,
): void {
  assertRecordBytes32(record.traceId, "traceId");
  if (record.decisionId !== null) {
    assertRecordBytes32(record.decisionId, "decisionId");
  }
  assertRecordBytes32(record.orderId, "orderId");
  assertRecordBytes32(record.stateBlockHash, "stateBlockHash");
  assertRecordBytes32(record.policyHash, "policyHash");
  assertRecordBytes32(record.helperBuildHash, "helperBuildHash");
  assertRecordBytes32(record.universeRoot, "universeRoot");
  assertRecordBytes32(record.witnessContentId, "witnessContentId");
  assertRecordBytes32(
    record.eligibilityPrestateRoot,
    "eligibilityPrestateRoot",
  );
  assertRecordBytes32(record.outputRoot, "outputRoot");
  for (const operatorId of record.selectedOperatorIds) {
    assertRecordBytes32(operatorId, "selectedOperatorId");
  }
  if (
    !Number.isSafeInteger(record.chainId) ||
    record.chainId <= 0 ||
    record.round < 0n ||
    record.sequence < 0n ||
    record.stateBlock < 0n ||
    !Number.isSafeInteger(record.universeCount) ||
    record.universeCount < 0 ||
    !Number.isSafeInteger(record.createdAtMs) ||
    record.createdAtMs < 0
  ) {
    throw new RangeError("Shadow trace contains invalid numeric values");
  }
  if (record.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new ShadowTraceConflictError(
      "Shadow trace is not bound to the authoritative Base Sepolia chain",
    );
  }
  if (
    record.actionAuthorization !== false ||
    record.forecastOnly !== true ||
    record.capability !== "TRANSACTION_DISABLED_SHADOW_ONLY"
  ) {
    throw new ShadowTraceConflictError(
      "Shadow trace attempted to claim action authority",
    );
  }
  if (!verifyCanonicalPayloadText(record.canonicalPayload, record.traceId)) {
    throw new ShadowTraceConflictError(
      "canonicalPayload is noncanonical or does not hash to traceId",
    );
  }
  if (
    !verifyCanonicalPayloadText(
      record.canonicalWitness,
      record.witnessContentId,
    )
  ) {
    throw new ShadowTraceConflictError(
      "canonicalWitness is noncanonical or does not hash to witnessContentId",
    );
  }
  if (
    record.serviceStatus !== "SHADOW_DECISION" &&
    record.serviceStatus !== "NO_SERVICE"
  ) {
    throw new ShadowTraceConflictError(
      "Shadow trace contains an unsupported service status",
    );
  }
  if (
    (record.serviceStatus === "SHADOW_DECISION" &&
      (record.decisionId === null || record.noServiceReason !== null)) ||
    (record.serviceStatus === "NO_SERVICE" &&
      (record.decisionId !== null || record.noServiceReason === null))
  ) {
    throw new ShadowTraceConflictError(
      "Shadow trace service status fields are inconsistent",
    );
  }
  if (
    record.decisionId !== null &&
    record.decisionId.toLowerCase() !== record.traceId.toLowerCase()
  ) {
    throw new ShadowTraceConflictError(
      "Decision trace identity does not match its decisionId",
    );
  }
  validateCanonicalBinding(record);
}

/**
 * Executes the canonical witness through the production selector before a
 * trace can be retained. Content addressing alone is insufficient because a
 * malicious producer can rehash malformed or semantically detached data.
 */
export async function validateAndReplayShadowTraceRecord(
  record: ShadowTraceRecord,
): Promise<ShadowSelectionResult> {
  const canonicalRecord = canonicalizeShadowTraceRecord(record);
  validateShadowTraceRecord(canonicalRecord);
  try {
    const replay = decodeWitnessReplay(canonicalRecord.canonicalWitness);
    const selection = await executeWitnessReplay(replay);
    const replayedRecord = recordFromReplayedSelection(
      replay.input,
      selection,
      canonicalRecord.createdAtMs,
    );
    if (!isDeepStrictEqual(replayedRecord, canonicalRecord)) {
      throw new ShadowTraceConflictError(
        "Shadow trace metadata is detached from canonical witness replay",
      );
    }
    return selection;
  } catch (error) {
    if (error instanceof ShadowTraceConflictError) throw error;
    throw new ShadowTraceConflictError(
      "Canonical witness could not be replayed through the shadow selector",
    );
  }
}

function recordFromReplayedSelection(
  input: SelectionInput,
  selection: ShadowSelectionResult,
  createdAtMs: number,
): ShadowTraceRecord {
  const decisionId =
    "decisionId" in selection.outcome
      ? selection.outcome.decisionId
      : null;
  return canonicalizeShadowTraceRecord({
    traceId: selection.trace.traceId,
    decisionId,
    chainId: input.order.chainId,
    orderId: input.order.orderId,
    round: input.order.round,
    sequence: input.sequence,
    stateBlock: input.order.snapshotBlock,
    stateBlockHash: input.order.snapshotBlockHash,
    policyHash: input.policy.policyHash,
    helperBuildHash: input.helperBuildHash,
    universeCount: selection.trace.universeCount,
    universeRoot: selection.trace.universeRoot,
    eligibilityPrestateRoot: selection.trace.eligibilityPrestateRoot,
    outputRoot: selection.trace.outputRoot,
    witnessContentId: selection.trace.witnessContentId,
    canonicalWitness: selection.trace.canonicalWitness,
    canonicalPayload: selection.trace.canonicalPayload,
    serviceStatus: selection.trace.serviceStatus,
    noServiceReason: selection.trace.noServiceReason,
    capability: selection.trace.capability,
    actionAuthorization: false,
    forecastOnly: true,
    selectedOperatorIds: selection.trace.selectedOperatorIds,
    createdAtMs,
  });
}

const MAX_UINT256 = (1n << 256n) - 1n;
const NO_SERVICE_REASONS = [
  "READINESS_GATE",
  "FAILURE_DOMAIN_GATE",
  "NO_FOUR_ELIGIBLE_OPERATORS",
] as const;

const DECISION_PAYLOAD_KEYS = [
  "schema",
  "capability",
  "chainId",
  "diamond",
  "orderId",
  "round",
  "routingDomain",
  "domainEpoch",
  "sequence",
  "stateBlock",
  "stateBlockHash",
  "assignedAt",
  "validUntil",
  "quoteDeadline",
  "quoteHash",
  "policyHash",
  "helperBuildHash",
  "universeCount",
  "universeRoot",
  "witnessContentId",
  "eligibilityPrestateRoot",
  "candidates",
  "leaseSchedule",
  "outputRoot",
] as const;

const NO_SERVICE_PAYLOAD_KEYS = [
  "schema",
  "capability",
  "actionAuthorization",
  "chainId",
  "diamond",
  "orderId",
  "round",
  "routingDomain",
  "domainEpoch",
  "sequence",
  "stateBlock",
  "stateBlockHash",
  "quoteHash",
  "policyHash",
  "witnessContentId",
  "helperBuildHash",
  "universeCount",
  "universeRoot",
  "eligibilityPrestateRoot",
  "outputRoot",
  "reason",
] as const;

const WITNESS_KEYS = [
  "schema",
  "capability",
  "actionAuthorization",
  "input",
  "universeEntries",
  "eligibilityPrestates",
  "exclusions",
  "output",
] as const;

const WITNESS_INPUT_KEYS = [
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
] as const;

const WITNESS_ORDER_KEYS = [
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
] as const;

const WITNESS_UNIVERSE_KEYS = [
  "complete",
  "pageCount",
  "expectedEntryCount",
  "finalizedBlock",
  "finalizedBlockHash",
] as const;

const POLICY_WITNESS_KEYS = [
  "schema",
  "councilBillSha256",
  "councilVerdict",
  "actionAuthorization",
  "selectionPolicy",
  "shadowPolicy",
] as const;

const SELECTION_POLICY_KEYS = [
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
] as const;

const SHADOW_POLICY_KEYS = [
  "schema",
  "readinessReserveF",
  "minimumFinalAcceptanceWindowSeconds",
  "allowUnlimitedChannelLimits",
  "concentrationWindowSequences",
  "maxRankZeroPerOperatorInWindow",
  "nonresponseCooldownSequences",
  "cohortExpansionPerCoolingOperator",
  "maxCohortExpansion",
] as const;

const WITNESS_OUTPUT_KEYS = [
  "serviceStatus",
  "noServiceReason",
  "candidates",
  "leaseSchedule",
  "outputRoot",
] as const;

const UNIVERSE_ENTRY_KEYS = ["merchant", "channelId", "candidate"] as const;

const CANDIDATE_SNAPSHOT_KEYS = [
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
] as const;

const CHANNEL_SNAPSHOT_KEYS = [
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
] as const;


const OPERATOR_SNAPSHOT_KEYS = [
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
] as const;

const OPEN_OFFER_KEYS = [
  "slotId",
  "orderId",
  "round",
  "operatorId",
  "merchant",
  "channelId",
  "usdcAmount",
  "openedAtSequence",
] as const;

const HISTORY_EVENT_KEYS = [
  "eventId",
  "operatorId",
  "decisionId",
  "orderId",
  "round",
  "sequence",
  "kind",
] as const;

const EXCLUSION_KEYS = ["merchant", "channelId", "result"] as const;
const ELIGIBILITY_RESULT_KEYS = [
  "code",
  "required",
  "available",
  "source",
  "checkedAtBlock",
] as const;
const ELIGIBILITY_PRESTATE_KEYS = [
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
] as const;

function validateCanonicalBinding(record: ShadowTraceRecord): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.canonicalPayload) as unknown;
  } catch {
    throw new ShadowTraceConflictError(
      "canonicalPayload is not valid JSON",
    );
  }
  if (record.serviceStatus === "SHADOW_DECISION") {
    const payload = requireExactPayloadRecord(
      parsed,
      "decision payload",
      DECISION_PAYLOAD_KEYS,
    );
    if (payload.schema !== "p2pflow.shadow-assignment-decision.v2") {
      throw new ShadowTraceConflictError(
        "Decision payload has an unsupported schema",
      );
    }
    bindCommonPayload(record, payload);
    validateDecisionPayload(record, payload);
    validateCanonicalWitness(record, payload);
    return;
  }

  const payload = requireExactPayloadRecord(
    parsed,
    "no-service payload",
    NO_SERVICE_PAYLOAD_KEYS,
  );
  if (payload.schema !== "p2pflow.shadow-no-service.v2") {
    throw new ShadowTraceConflictError(
      "No-service payload has an unsupported schema",
    );
  }
  if (payload.actionAuthorization !== false) {
    throw new ShadowTraceConflictError(
      "No-service payload attempted to claim action authority",
    );
  }
  bindCommonPayload(record, payload);
  validateNoServicePayload(record, payload);
  validateCanonicalWitness(record, payload);
}

function bindCommonPayload(
  record: ShadowTraceRecord,
  payload: Record<string, unknown>,
): void {
  if (payload.capability !== "TRANSACTION_DISABLED_SHADOW_ONLY") {
    throw new ShadowTraceConflictError(
      "Canonical payload has an invalid capability",
    );
  }
  assertCanonicalUintEquals(payload.chainId, BigInt(record.chainId), "chainId");
  const diamond = assertAddress(payload.diamond, "diamond");
  if (
    diamond.toLowerCase() !== BASE_SEPOLIA_DIAMOND_ADDRESS.toLowerCase()
  ) {
    throw new ShadowTraceConflictError(
      "Canonical payload is not bound to the authoritative Base Sepolia Diamond",
    );
  }
  assertBytes32Equals(payload.orderId, record.orderId, "orderId");
  assertCanonicalUintEquals(payload.round, record.round, "round");
  validateRoutingDomain(payload.routingDomain, record.chainId);
  assertBytes32(payload.domainEpoch, "domainEpoch");
  assertCanonicalUintEquals(payload.sequence, record.sequence, "sequence");
  assertCanonicalUintEquals(
    payload.stateBlock,
    record.stateBlock,
    "stateBlock",
  );
  assertBytes32Equals(
    payload.stateBlockHash,
    record.stateBlockHash,
    "stateBlockHash",
  );
  assertBytes32(payload.quoteHash, "quoteHash");
  assertBytes32Equals(payload.policyHash, record.policyHash, "policyHash");
  assertBytes32Equals(
    payload.helperBuildHash,
    record.helperBuildHash,
    "helperBuildHash",
  );
  assertBytes32Equals(
    payload.witnessContentId,
    record.witnessContentId,
    "witnessContentId",
  );
  assertCanonicalUintEquals(
    payload.universeCount,
    BigInt(record.universeCount),
    "universeCount",
  );
  assertBytes32Equals(
    payload.universeRoot,
    record.universeRoot,
    "universeRoot",
  );
  assertBytes32Equals(
    payload.eligibilityPrestateRoot,
    record.eligibilityPrestateRoot,
    "eligibilityPrestateRoot",
  );
  assertBytes32Equals(payload.outputRoot, record.outputRoot, "outputRoot");
}

function validateDecisionPayload(
  record: ShadowTraceRecord,
  payload: Record<string, unknown>,
): void {
  const assignedAt = assertCanonicalUint(payload.assignedAt, "assignedAt");
  const validUntil = assertCanonicalUint(payload.validUntil, "validUntil");
  const quoteDeadline = assertCanonicalUint(
    payload.quoteDeadline,
    "quoteDeadline",
  );
  if (assignedAt >= validUntil || validUntil > quoteDeadline) {
    throw new ShadowTraceConflictError(
      "Decision assignment timing is invalid",
    );
  }
  const candidates = requirePayloadArray(payload.candidates, "candidates");
  const leases = requirePayloadArray(payload.leaseSchedule, "leaseSchedule");
  if (candidates.length !== 4 || leases.length !== 4) {
    throw new ShadowTraceConflictError(
      "Decision payload must contain exactly four candidates and leases",
    );
  }
  const operatorIds: string[] = [];
  const failureDomainIds: string[] = [];
  const candidateUnlocks: bigint[] = [];
  for (let index = 0; index < 4; index += 1) {
    const candidate = requireExactPayloadRecord(
      candidates[index],
      `candidates[${index}]`,
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
    const operatorId = assertBytes32(
      candidate.operatorId,
      `candidates[${index}].operatorId`,
    );
    failureDomainIds.push(
      assertBytes32(
        candidate.failureDomainId,
        `candidates[${index}].failureDomainId`,
      ).toLowerCase(),
    );
    assertAddress(candidate.merchant, `candidates[${index}].merchant`);
    assertBytes32(candidate.channelId, `candidates[${index}].channelId`);
    assertCanonicalUintEquals(
      candidate.rank,
      BigInt(index),
      `candidates[${index}].rank`,
    );
    assertCanonicalUint(
      candidate.rankingFinishQ,
      `candidates[${index}].rankingFinishQ`,
    );
    assertCanonicalUint(
      candidate.forecastFinishQ,
      `candidates[${index}].forecastFinishQ`,
    );
    candidateUnlocks.push(
      assertCanonicalUint(
        candidate.unlockAt,
        `candidates[${index}].unlockAt`,
      ),
    );
    operatorIds.push(operatorId.toLowerCase());
  }
  if (new Set(operatorIds).size !== 4) {
    throw new ShadowTraceConflictError(
      "Decision payload contains duplicate economic operators",
    );
  }
  if (new Set(failureDomainIds).size !== 4) {
    throw new ShadowTraceConflictError(
      "Decision payload contains duplicate failure domains",
    );
  }
  let previousIntervalEnd: bigint | null = null;
  for (let index = 0; index < 4; index += 1) {
    const lease = requireExactPayloadRecord(
      leases[index],
      `leaseSchedule[${index}]`,
      ["rank", "unlockAt", "intervalEnd"],
    );
    assertCanonicalUintEquals(
      lease.rank,
      BigInt(index),
      `leaseSchedule[${index}].rank`,
    );
    const unlockAt = assertCanonicalUint(
      lease.unlockAt,
      `leaseSchedule[${index}].unlockAt`,
    );
    const intervalEnd = assertCanonicalUint(
      lease.intervalEnd,
      `leaseSchedule[${index}].intervalEnd`,
    );
    if (
      unlockAt !== candidateUnlocks[index] ||
      intervalEnd <= unlockAt ||
      (index === 0 && unlockAt !== assignedAt) ||
      (previousIntervalEnd !== null && unlockAt !== previousIntervalEnd)
    ) {
      throw new ShadowTraceConflictError(
        "Decision lease schedule is inconsistent",
      );
    }
    previousIntervalEnd = intervalEnd;
  }
  if (previousIntervalEnd !== validUntil) {
    throw new ShadowTraceConflictError(
      "Decision lease schedule does not cover the validity interval",
    );
  }
  if (
    record.selectedOperatorIds.length !== 4 ||
    record.selectedOperatorIds.some(
      (operatorId, index) =>
        operatorId.toLowerCase() !== operatorIds[index],
    )
  ) {
    throw new ShadowTraceConflictError(
      "Selected operator metadata does not match the decision payload",
    );
  }
  const expectedOutputRoot = canonicalMerkleRoot(
    "p2pflow.shadow-output.v2",
    [{ candidates, leaseSchedule: leases }],
  );
  if (expectedOutputRoot.toLowerCase() !== record.outputRoot.toLowerCase()) {
    throw new ShadowTraceConflictError(
      "Decision output root does not match candidates and leases",
    );
  }
}

function validateNoServicePayload(
  record: ShadowTraceRecord,
  payload: Record<string, unknown>,
): void {
  if (
    typeof payload.reason !== "string" ||
    !NO_SERVICE_REASONS.some((reason) => reason === payload.reason) ||
    payload.reason !== record.noServiceReason
  ) {
    throw new ShadowTraceConflictError(
      "No-service reason is invalid or does not match its payload",
    );
  }
  if (record.selectedOperatorIds.length !== 0) {
    throw new ShadowTraceConflictError(
      "No-service traces cannot contain selected operators",
    );
  }
  const expectedOutputRoot = canonicalMerkleRoot(
    "p2pflow.shadow-no-service-output.v2",
    [{ reason: payload.reason }],
  );
  if (expectedOutputRoot.toLowerCase() !== record.outputRoot.toLowerCase()) {
    throw new ShadowTraceConflictError(
      "No-service output root does not match its reason",
    );
  }
}


function validateCanonicalWitness(
  record: ShadowTraceRecord,
  payload: Record<string, unknown>,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.canonicalWitness) as unknown;
  } catch {
    throw new ShadowTraceConflictError("canonicalWitness is not valid JSON");
  }
  const witness = requireExactPayloadRecord(
    parsed,
    "selection witness",
    WITNESS_KEYS,
  );
  if (
    witness.schema !== "p2pflow.shadow-selection-witness.v1" ||
    witness.capability !== "TRANSACTION_DISABLED_SHADOW_ONLY" ||
    witness.actionAuthorization !== false
  ) {
    throw new ShadowTraceConflictError(
      "Selection witness has an invalid schema or authority claim",
    );
  }

  const input = requireExactPayloadRecord(
    witness.input,
    "selection witness input",
    WITNESS_INPUT_KEYS,
  );
  const order = requireExactPayloadRecord(
    input.order,
    "selection witness order",
    WITNESS_ORDER_KEYS,
  );
  assertCanonicalUintEquals(order.chainId, BigInt(record.chainId), "witness.order.chainId");
  const orderDiamond = assertAddress(order.diamond, "witness.order.diamond");
  if (
    orderDiamond.toLowerCase() !==
      assertAddress(payload.diamond, "diamond").toLowerCase()
  ) {
    throw new ShadowTraceConflictError(
      "Selection witness Diamond does not match the payload",
    );
  }
  assertBytes32Equals(order.orderId, record.orderId, "witness.order.orderId");
  assertCanonicalUintEquals(order.round, record.round, "witness.order.round");
  if (order.side !== "BUY" && order.side !== "SELL") {
    throw new ShadowTraceConflictError("Selection witness order side is invalid");
  }
  assertAddress(order.user, "witness.order.user");
  assertCanonicalUint(order.usdcAmount, "witness.order.usdcAmount");
  assertCanonicalUint(order.fiatAmount, "witness.order.fiatAmount");
  assertBytes32Equals(order.quoteHash, assertBytes32(payload.quoteHash, "quoteHash"), "witness.order.quoteHash");
  assertCanonicalUintEquals(
    order.snapshotBlock,
    record.stateBlock,
    "witness.order.snapshotBlock",
  );
  assertBytes32Equals(
    order.snapshotBlockHash,
    record.stateBlockHash,
    "witness.order.snapshotBlockHash",
  );
  const witnessValidUntil = assertCanonicalUint(
    order.validUntil,
    "witness.order.validUntil",
  );
  validateRoutingDomain(order.domain, record.chainId);
  if (!isDeepStrictEqual(order.domain, payload.routingDomain)) {
    throw new ShadowTraceConflictError(
      "Selection witness routing domain does not match the payload",
    );
  }
  const orderDomain = order.domain as Record<string, unknown>;
  if (orderDomain.orderSide !== order.side) {
    throw new ShadowTraceConflictError(
      "Selection witness order side does not match its routing domain",
    );
  }

  const inputCandidates = requirePayloadArray(
    input.candidates,
    "witness.input.candidates",
  );
  for (let index = 0; index < inputCandidates.length; index += 1) {
    validateWitnessCandidateSnapshot(inputCandidates[index], `witness.input.candidates[${index}]`);
  }
  const operators = requirePayloadArray(
    input.operators,
    "witness.input.operators",
  );
  for (let index = 0; index < operators.length; index += 1) {
    validateWitnessOperatorSnapshot(
      operators[index],
      `witness.input.operators[${index}]`,
    );
  }
  const history = requirePayloadArray(input.history, "witness.input.history");
  for (let index = 0; index < history.length; index += 1) {
    validateWitnessHistoryEvent(
      history[index],
      `witness.input.history[${index}]`,
    );
  }
  assertBytes32Equals(input.domainEpoch, assertBytes32(payload.domainEpoch, "domainEpoch"), "witness.input.domainEpoch");
  assertCanonicalUintEquals(input.sequence, record.sequence, "witness.input.sequence");
  assertCanonicalUint(input.domainFloorQ, "witness.input.domainFloorQ");
  const witnessAssignedAt = assertCanonicalUint(
    input.assignedAt,
    "witness.input.assignedAt",
  );
  const witnessQuoteDeadline = assertCanonicalUint(
    input.quoteDeadline,
    "witness.input.quoteDeadline",
  );
  if (
    typeof input.helperBuildVersion !== "string" ||
    input.helperBuildVersion.length === 0
  ) {
    throw new ShadowTraceConflictError(
      "Selection witness helperBuildVersion must not be empty",
    );
  }
  assertBytes32Equals(
    input.helperBuildHash,
    record.helperBuildHash,
    "witness.input.helperBuildHash",
  );
  if (record.serviceStatus === "SHADOW_DECISION") {
    if (
      witnessAssignedAt !== assertCanonicalUint(payload.assignedAt, "assignedAt") ||
      witnessValidUntil !== assertCanonicalUint(payload.validUntil, "validUntil") ||
      witnessQuoteDeadline !== assertCanonicalUint(payload.quoteDeadline, "quoteDeadline")
    ) {
      throw new ShadowTraceConflictError(
        "Selection witness timing does not match the decision payload",
      );
    }
  }

  const policyWitness = requireExactPayloadRecord(
    input.canonicalPolicyWitness,
    "selection policy witness",
    POLICY_WITNESS_KEYS,
  );
  requireExactPayloadRecord(
    policyWitness.selectionPolicy,
    "selection policy material",
    SELECTION_POLICY_KEYS,
  );
  requireExactPayloadRecord(
    policyWitness.shadowPolicy,
    "shadow selection policy",
    SHADOW_POLICY_KEYS,
  );
  if (
    policyWitness.schema !== "p2pflow.shadow-policy-witness.v1" ||
    policyWitness.councilBillSha256 !== COUNCIL_BILL_SHA256 ||
    policyWitness.councilVerdict !== COUNCIL_VERDICT ||
    policyWitness.actionAuthorization !== false
  ) {
    throw new ShadowTraceConflictError(
      "Selection policy witness does not bind the Council REJECT",
    );
  }
  const policyHash = hashCanonicalPayloadText(canonicalJson(policyWitness));
  if (policyHash.toLowerCase() !== record.policyHash.toLowerCase()) {
    throw new ShadowTraceConflictError(
      "Selection policy witness does not hash to policyHash",
    );
  }

  const universe = requireExactPayloadRecord(
    input.universe,
    "selection witness universe evidence",
    WITNESS_UNIVERSE_KEYS,
  );
  if (universe.complete !== true) {
    throw new ShadowTraceConflictError(
      "Selection witness universe evidence is incomplete",
    );
  }
  const pageCount = assertCanonicalUint(
    universe.pageCount,
    "witness.input.universe.pageCount",
  );
  if (pageCount === 0n) {
    throw new ShadowTraceConflictError(
      "Selection witness universe page count must be positive",
    );
  }
  assertCanonicalUintEquals(
    universe.finalizedBlock,
    record.stateBlock,
    "witness.input.universe.finalizedBlock",
  );
  assertBytes32Equals(
    universe.finalizedBlockHash,
    record.stateBlockHash,
    "witness.input.universe.finalizedBlockHash",
  );

  const universeEntries = requirePayloadArray(
    witness.universeEntries,
    "witness.universeEntries",
  );
  for (let index = 0; index < universeEntries.length; index += 1) {
    const entry = requireExactPayloadRecord(
      universeEntries[index],
      `witness.universeEntries[${index}]`,
      UNIVERSE_ENTRY_KEYS,
    );
    assertAddress(entry.merchant, `witness.universeEntries[${index}].merchant`);
    if (entry.channelId !== null) {
      assertBytes32(entry.channelId, `witness.universeEntries[${index}].channelId`);
    }
    validateWitnessCandidateSnapshot(entry.candidate, `witness.universeEntries[${index}].candidate`);
  }
  assertCanonicalUintEquals(
    universe.expectedEntryCount,
    BigInt(universeEntries.length),
    "witness.input.universe.expectedEntryCount",
  );
  if (universeEntries.length !== record.universeCount) {
    throw new ShadowTraceConflictError(
      "Selection witness universe count does not match trace metadata",
    );
  }
  validateUniverseCandidateCorrespondence(inputCandidates, universeEntries);
  const universeRoot = canonicalMerkleRoot(
    "p2pflow.candidate-universe.v1",
    universeEntries,
  );
  if (universeRoot.toLowerCase() !== record.universeRoot.toLowerCase()) {
    throw new ShadowTraceConflictError(
      "Selection witness universe entries do not hash to universeRoot",
    );
  }

  const prestates = requirePayloadArray(
    witness.eligibilityPrestates,
    "witness.eligibilityPrestates",
  );
  for (let index = 0; index < prestates.length; index += 1) {
    requireExactPayloadRecord(
      prestates[index],
      `witness.eligibilityPrestates[${index}]`,
      ELIGIBILITY_PRESTATE_KEYS,
    );
  }
  const eligibilityRoot = canonicalMerkleRoot(
    "p2pflow.eligibility-prestate.v2",
    prestates,
  );
  if (
    eligibilityRoot.toLowerCase() !==
      record.eligibilityPrestateRoot.toLowerCase()
  ) {
    throw new ShadowTraceConflictError(
      "Selection witness prestates do not hash to eligibilityPrestateRoot",
    );
  }
  const exclusions = requirePayloadArray(
    witness.exclusions,
    "witness.exclusions",
  );
  for (let index = 0; index < exclusions.length; index += 1) {
    validateWitnessExclusion(
      exclusions[index],
      `witness.exclusions[${index}]`,
    );
  }

  const output = requireExactPayloadRecord(
    witness.output,
    "selection witness output",
    WITNESS_OUTPUT_KEYS,
  );
  if (
    output.serviceStatus !== record.serviceStatus ||
    output.noServiceReason !== record.noServiceReason
  ) {
    throw new ShadowTraceConflictError(
      "Selection witness output status does not match trace metadata",
    );
  }
  const witnessCandidates = requirePayloadArray(
    output.candidates,
    "witness.output.candidates",
  );
  const witnessLeases = requirePayloadArray(
    output.leaseSchedule,
    "witness.output.leaseSchedule",
  );
  if (record.serviceStatus === "SHADOW_DECISION") {
    if (
      !isDeepStrictEqual(witnessCandidates, payload.candidates) ||
      !isDeepStrictEqual(witnessLeases, payload.leaseSchedule)
    ) {
      throw new ShadowTraceConflictError(
        "Selection witness decision output does not match the payload",
      );
    }
  } else if (witnessCandidates.length !== 0 || witnessLeases.length !== 0) {
    throw new ShadowTraceConflictError(
      "No-service witness output must not contain candidates or leases",
    );
  }
  assertBytes32Equals(
    output.outputRoot,
    record.outputRoot,
    "witness.output.outputRoot",
  );
}

function validateWitnessCandidateSnapshot(value: unknown, name: string): void {
  const candidate = requireExactPayloadRecord(
    value,
    name,
    CANDIDATE_SNAPSHOT_KEYS,
  );
  const merchant = assertAddress(candidate.merchant, `${name}.merchant`);
  assertBytes32(candidate.observedAtBlockHash, `${name}.observedAtBlockHash`);
  assertCanonicalUint(candidate.observedAtBlock, `${name}.observedAtBlock`);
  const channels = requirePayloadArray(candidate.channels, `${name}.channels`);
  for (let index = 0; index < channels.length; index += 1) {
    const channelName = `${name}.channels[${index}]`;
    const channel = requireExactPayloadRecord(
      channels[index],
      channelName,
      CHANNEL_SNAPSHOT_KEYS,
    );
    assertBytes32(channel.channelId, `${channelName}.channelId`);
    const channelMerchant = assertAddress(
      channel.merchant,
      `${channelName}.merchant`,
    );
    if (channelMerchant.toLowerCase() !== merchant.toLowerCase()) {
      throw new ShadowTraceConflictError(
        `${channelName} is not owned by its candidate`,
      );
    }
  }
}

function validateWitnessOperatorSnapshot(value: unknown, name: string): void {
  const operator = requireExactPayloadRecord(
    value,
    name,
    OPERATOR_SNAPSHOT_KEYS,
  );
  assertBytes32(operator.operatorId, `${name}.operatorId`);
  assertBytes32(operator.failureDomainId, `${name}.failureDomainId`);
  const wallets = requirePayloadArray(operator.wallets, `${name}.wallets`);
  for (let index = 0; index < wallets.length; index += 1) {
    assertAddress(wallets[index], `${name}.wallets[${index}]`);
  }
  assertCanonicalUint(operator.acceptedUsdc, `${name}.acceptedUsdc`);
  assertCanonicalUintOrNull(operator.virtualFinishQ, `${name}.virtualFinishQ`);
  assertCanonicalUint(operator.activeAcceptedOrders, `${name}.activeAcceptedOrders`);
  assertCanonicalUint(operator.maxActiveAcceptedOrders, `${name}.maxActiveAcceptedOrders`);
  assertCanonicalUint(operator.recentFailureTier, `${name}.recentFailureTier`);
  assertCanonicalUintOrNull(
    operator.lastAcceptedOrAssignedAt,
    `${name}.lastAcceptedOrAssignedAt`,
  );
  const offers = requirePayloadArray(operator.openOffers, `${name}.openOffers`);
  for (let index = 0; index < offers.length; index += 1) {
    const offerName = `${name}.openOffers[${index}]`;
    const offer = requireExactPayloadRecord(
      offers[index],
      offerName,
      OPEN_OFFER_KEYS,
    );
    assertBytes32(offer.slotId, `${offerName}.slotId`);
    assertBytes32(offer.orderId, `${offerName}.orderId`);
    assertCanonicalUint(offer.round, `${offerName}.round`);
    assertBytes32(offer.operatorId, `${offerName}.operatorId`);
    assertAddress(offer.merchant, `${offerName}.merchant`);
    assertBytes32(offer.channelId, `${offerName}.channelId`);
    assertCanonicalUint(offer.usdcAmount, `${offerName}.usdcAmount`);
    assertCanonicalUint(offer.openedAtSequence, `${offerName}.openedAtSequence`);
  }
}

function validateWitnessHistoryEvent(value: unknown, name: string): void {
  const event = requireExactPayloadRecord(value, name, HISTORY_EVENT_KEYS);
  assertBytes32(event.eventId, `${name}.eventId`);
  assertBytes32(event.operatorId, `${name}.operatorId`);
  assertBytes32(event.decisionId, `${name}.decisionId`);
  assertBytes32(event.orderId, `${name}.orderId`);
  assertCanonicalUint(event.round, `${name}.round`);
  assertCanonicalUint(event.sequence, `${name}.sequence`);
  if (
    event.kind !== "RANK_ZERO_ASSIGNED" &&
    event.kind !== "RANK_ZERO_MISSED" &&
    event.kind !== "ACCEPTED" &&
    event.kind !== "RESPONDED"
  ) {
    throw new ShadowTraceConflictError(`${name}.kind is invalid`);
  }
}

function validateWitnessExclusion(value: unknown, name: string): void {
  const exclusion = requireExactPayloadRecord(value, name, EXCLUSION_KEYS);
  assertAddress(exclusion.merchant, `${name}.merchant`);
  if (exclusion.channelId !== null) {
    assertBytes32(exclusion.channelId, `${name}.channelId`);
  }
  const result = requireExactPayloadRecord(
    exclusion.result,
    `${name}.result`,
    ELIGIBILITY_RESULT_KEYS,
  );
  if (typeof result.code !== "string" || result.code.length === 0) {
    throw new ShadowTraceConflictError(`${name}.result.code is invalid`);
  }
  assertCanonicalUint(result.required, `${name}.result.required`);
  assertCanonicalUint(result.available, `${name}.result.available`);
  assertCanonicalUint(result.checkedAtBlock, `${name}.result.checkedAtBlock`);
  if (result.source !== "snapshot" && result.source !== "contract") {
    throw new ShadowTraceConflictError(`${name}.result.source is invalid`);
  }
}

function validateUniverseCandidateCorrespondence(
  inputCandidates: readonly unknown[],
  universeEntries: readonly unknown[],
): void {
  const candidatesByMerchant = new Map<string, Record<string, unknown>>();
  for (let index = 0; index < inputCandidates.length; index += 1) {
    const candidate = requireExactPayloadRecord(
      inputCandidates[index],
      `witness.input.candidates[${index}]`,
      CANDIDATE_SNAPSHOT_KEYS,
    );
    const merchant = assertAddress(
      candidate.merchant,
      `witness.input.candidates[${index}].merchant`,
    ).toLowerCase();
    if (candidatesByMerchant.has(merchant)) {
      throw new ShadowTraceConflictError(
        "Selection witness input contains duplicate candidate merchants",
      );
    }
    candidatesByMerchant.set(merchant, candidate);
  }
  const actualChannels = new Map<string, string[]>();
  for (let index = 0; index < universeEntries.length; index += 1) {
    const entry = requireExactPayloadRecord(
      universeEntries[index],
      `witness.universeEntries[${index}]`,
      UNIVERSE_ENTRY_KEYS,
    );
    const merchant = assertAddress(
      entry.merchant,
      `witness.universeEntries[${index}].merchant`,
    ).toLowerCase();
    const candidate = candidatesByMerchant.get(merchant);
    if (
      candidate === undefined ||
      canonicalJson(candidate) !== canonicalJson(entry.candidate)
    ) {
      throw new ShadowTraceConflictError(
        "Selection witness universe entry is detached from input candidates",
      );
    }
    const channelId = entry.channelId === null
      ? ""
      : assertBytes32(
          entry.channelId,
          `witness.universeEntries[${index}].channelId`,
        ).toLowerCase();
    const channels = actualChannels.get(merchant) ?? [];
    channels.push(channelId);
    actualChannels.set(merchant, channels);
  }
  for (const [merchant, candidate] of candidatesByMerchant) {
    const channels = requirePayloadArray(
      candidate.channels,
      `candidate ${merchant} channels`,
    );
    const expected = channels.length === 0
      ? [""]
      : channels.map((channel, index) => {
          const channelRecord = requireExactPayloadRecord(
            channel,
            `candidate ${merchant} channels[${index}]`,
            CHANNEL_SNAPSHOT_KEYS,
          );
          return assertBytes32(
            channelRecord.channelId,
            `candidate ${merchant} channels[${index}].channelId`,
          ).toLowerCase();
        });
    const actual = actualChannels.get(merchant) ?? [];
    expected.sort();
    actual.sort();
    if (!isDeepStrictEqual(actual, expected)) {
      throw new ShadowTraceConflictError(
        "Selection witness universe channels do not match input candidates",
      );
    }
  }
}

function assertCanonicalUintOrNull(value: unknown, name: string): void {
  if (value !== null) assertCanonicalUint(value, name);
}
function validateRoutingDomain(value: unknown, chainId: number): void {
  const domain = requireExactPayloadRecord(
    value,
    "routingDomain",
    ["chainId", "fiatCurrency", "paymentRailGroup", "orderSide"],
  );
  assertCanonicalUintEquals(domain.chainId, BigInt(chainId), "routingDomain.chainId");
  for (const key of ["fiatCurrency", "paymentRailGroup"] as const) {
    if (typeof domain[key] !== "string" || domain[key].length === 0) {
      throw new ShadowTraceConflictError(
        `routingDomain.${key} must be a non-empty string`,
      );
    }
  }
  if (domain.orderSide !== "BUY" && domain.orderSide !== "SELL") {
    throw new ShadowTraceConflictError(
      "routingDomain.orderSide is invalid",
    );
  }
}

function requireExactPayloadRecord(
  value: unknown,
  name: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new ShadowTraceConflictError(`${name} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(record, key))
  ) {
    throw new ShadowTraceConflictError(
      `${name} does not have the exact canonical field set`,
    );
  }
  return record;
}

function requirePayloadArray(
  value: unknown,
  name: string,
): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new ShadowTraceConflictError(`${name} must be an array`);
  }
  return value;
}

function assertCanonicalUint(value: unknown, name: string): bigint {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(value)
  ) {
    throw new ShadowTraceConflictError(
      `${name} must be a canonical unsigned integer string`,
    );
  }
  const result = BigInt(value);
  if (result > MAX_UINT256) {
    throw new ShadowTraceConflictError(`${name} exceeds uint256`);
  }
  return result;
}

function assertCanonicalUintEquals(
  value: unknown,
  expected: bigint,
  name: string,
): void {
  if (assertCanonicalUint(value, name) !== expected) {
    throw new ShadowTraceConflictError(
      `${name} does not match shadow trace metadata`,
    );
  }
}

function assertAddress(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new ShadowTraceConflictError(
      `${name} must be a 20-byte hexadecimal value`,
    );
  }
  return value;
}

function assertBytes32(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new ShadowTraceConflictError(
      `${name} must be a 32-byte hexadecimal value`,
    );
  }
  return value;
}

function assertBytes32Equals(
  value: unknown,
  expected: string,
  name: string,
): void {
  if (assertBytes32(value, name).toLowerCase() !== expected.toLowerCase()) {
    throw new ShadowTraceConflictError(
      `${name} does not match shadow trace metadata`,
    );
  }
}

function orderSequenceKey(
  chainId: number,
  orderId: `0x${string}`,
  round: bigint,
  sequence: bigint,
): string {
  return `${chainId}:${orderId.toLowerCase()}:${round}:${sequence}`;
}

function assertRecordBytes32(value: string, name: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError(`${name} must be a 32-byte hexadecimal value`);
  }
}

function cloneRecord(record: ShadowTraceRecord): ShadowTraceRecord {
  return {
    ...record,
    selectedOperatorIds: [...record.selectedOperatorIds],
  };
}

function canonicalizeShadowTraceRecord(
  record: ShadowTraceRecord,
): ShadowTraceRecord {
  return {
    ...record,
    traceId: canonicalBytes32(record.traceId),
    decisionId:
      record.decisionId === null
        ? null
        : canonicalBytes32(record.decisionId),
    orderId: canonicalBytes32(record.orderId),
    stateBlockHash: canonicalBytes32(record.stateBlockHash),
    policyHash: canonicalBytes32(record.policyHash),
    helperBuildHash: canonicalBytes32(record.helperBuildHash),
    universeRoot: canonicalBytes32(record.universeRoot),
    eligibilityPrestateRoot: canonicalBytes32(
      record.eligibilityPrestateRoot,
    ),
    outputRoot: canonicalBytes32(record.outputRoot),
    witnessContentId: canonicalBytes32(record.witnessContentId),
    selectedOperatorIds: record.selectedOperatorIds.map(canonicalBytes32),
  };
}

function canonicalBytes32(value: `0x${string}`): `0x${string}` {
  return value.toLowerCase() as `0x${string}`;
}
