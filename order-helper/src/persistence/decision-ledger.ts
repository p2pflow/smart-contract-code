import { isDeepStrictEqual } from "node:util";
import type { EligibilityCode } from "../domain/types";
import {
  isCanonicalVersionIdentifier,
  isEligibilityCode,
} from "../domain/validation";
import {
  ShadowTraceRecord,
  validateAndReplayShadowTraceRecord,
  validateShadowTraceRecord,
} from "./shadow-trace-ledger";

export const SHADOW_DECISION_SCHEMA =
  "p2pflow.shadow-assignment-decision.v2" as const;
export const SHADOW_DECISION_CAPABILITY =
  "TRANSACTION_DISABLED_SHADOW_ONLY" as const;

export type DecisionState =
  | "computed"
  | "shadowed"
  | "simulation-failed"
  | "simulated"
  | "send-blocked"
  | "superseded";

export type DecisionReasonCode =
  | "READ_ONLY_SIMULATION"
  | "SHADOW_MODE"
  | "SIMULATION_FAILED"
  | "SEND_BLOCKED"
  | "SUPERSEDED";

export interface AssignmentDecisionRecord {
  readonly schema: typeof SHADOW_DECISION_SCHEMA;
  readonly capability: typeof SHADOW_DECISION_CAPABILITY;
  readonly decisionId: `0x${string}`;
  readonly chainId: number;
  readonly diamondAddress: `0x${string}`;
  readonly orderId: `0x${string}`;
  readonly round: bigint;
  readonly snapshotBlock: bigint;
  readonly snapshotBlockHash: `0x${string}`;
  readonly policyHash: `0x${string}`;
  readonly witnessContentId: `0x${string}`;
  readonly canonicalWitness: string;
  readonly helperBuildVersion: string;
  readonly canonicalPayload: string;
  readonly initialState: DecisionState;
  readonly createdAtMs: number;
}

export interface CandidateEvaluationRecord {
  readonly decisionId: `0x${string}`;
  readonly ordinal: number;
  readonly merchant: `0x${string}`;
  readonly channelId: `0x${string}` | null;
  readonly eligibilityCode: EligibilityCode;
  readonly required: bigint;
  readonly available: bigint;
  readonly source: "snapshot" | "contract";
  readonly checkedAtBlock: bigint;
}

export interface DecisionBundle {
  readonly decision: AssignmentDecisionRecord;
  readonly evaluations: readonly CandidateEvaluationRecord[];
}

export interface DecisionStateEvent {
  readonly eventId: `0x${string}`;
  readonly decisionId: `0x${string}`;
  readonly fromState: DecisionState;
  readonly toState: DecisionState;
  readonly occurredAtMs: number;
  readonly reasonCode: DecisionReasonCode;
  readonly transactionAttemptId: `0x${string}` | null;
}

export interface DecisionView {
  readonly decision: AssignmentDecisionRecord;
  readonly evaluations: readonly CandidateEvaluationRecord[];
  readonly events: readonly DecisionStateEvent[];
  readonly currentState: DecisionState;
}

export type AppendResult<T> =
  | { readonly inserted: true; readonly value: T }
  | { readonly inserted: false; readonly value: T };

export type DecisionPayloadVerifier = (
  canonicalPayload: string,
  decisionId: `0x${string}`,
) => boolean;

export interface DecisionLedger {
  appendDecision(bundle: DecisionBundle): Promise<AppendResult<DecisionView>>;
  appendStateEvent(
    event: DecisionStateEvent,
  ): Promise<AppendResult<DecisionStateEvent>>;
  getById(decisionId: `0x${string}`): Promise<DecisionView | null>;
  getByOrderRound(
    chainId: number,
    orderId: `0x${string}`,
    round: bigint,
  ): Promise<DecisionView | null>;
}

export class DecisionLedgerConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DecisionLedgerConflictError";
  }
}

export class DecisionPayloadIntegrityError extends Error {
  public constructor(decisionId: string) {
    super(`Canonical decision evidence failed integrity validation for ${decisionId}`);
    this.name = "DecisionPayloadIntegrityError";
  }
}

export class InMemoryDecisionLedger implements DecisionLedger {
  private readonly decisions = new Map<string, AssignmentDecisionRecord>();
  private readonly orderRounds = new Map<string, string>();
  private readonly evaluations = new Map<
    string,
    readonly CandidateEvaluationRecord[]
  >();
  private readonly events = new Map<string, DecisionStateEvent[]>();
  private readonly eventIds = new Map<string, DecisionStateEvent>();

  public constructor(
    private readonly verifyPayload: DecisionPayloadVerifier,
  ) {}

  public async appendDecision(
    bundle: DecisionBundle,
  ): Promise<AppendResult<DecisionView>> {
    validateDecisionBundle(bundle);
    const canonicalBundle = canonicalizeDecisionBundle(bundle);
    await validateCanonicalDecisionEvidence(canonicalBundle.decision);
    validateEvaluationProjection(canonicalBundle);
    if (
      !this.verifyPayload(
        canonicalBundle.decision.canonicalPayload,
        canonicalBundle.decision.decisionId,
      )
    ) {
      throw new DecisionPayloadIntegrityError(
        canonicalBundle.decision.decisionId,
      );
    }
    const id = canonicalBundle.decision.decisionId;
    const orderRound = orderRoundKey(
      canonicalBundle.decision.chainId,
      canonicalBundle.decision.orderId,
      canonicalBundle.decision.round,
    );
    const existingId = this.orderRounds.get(orderRound);
    if (existingId !== undefined && existingId !== id) {
      throw new DecisionLedgerConflictError(
        `Order round ${orderRound} already belongs to ${existingId}`,
      );
    }

    const existing = this.decisions.get(id);
    if (existing !== undefined) {
      const existingEvaluations = this.evaluations.get(id) ?? [];
      if (
        !isDeepStrictEqual(existing, canonicalBundle.decision) ||
        !isDeepStrictEqual(existingEvaluations, canonicalBundle.evaluations)
      ) {
        throw new DecisionLedgerConflictError(
          `Decision ${canonicalBundle.decision.decisionId} was reused with different data`,
        );
      }
      return { inserted: false, value: this.buildView(id) };
    }

    this.decisions.set(id, cloneDecision(canonicalBundle.decision));
    this.orderRounds.set(orderRound, id);
    this.evaluations.set(
      id,
      canonicalBundle.evaluations.map(cloneEvaluation),
    );
    this.events.set(id, []);
    return { inserted: true, value: this.buildView(id) };
  }

  public async appendStateEvent(
    event: DecisionStateEvent,
  ): Promise<AppendResult<DecisionStateEvent>> {
    validateStateEvent(event);
    const canonicalEvent = canonicalizeStateEvent(event);
    const id = canonicalEvent.decisionId;
    const decision = this.decisions.get(id);
    if (decision === undefined) {
      throw new DecisionLedgerConflictError(
        `Decision ${event.decisionId} does not exist`,
      );
    }

    const existingEvent = this.eventIds.get(canonicalEvent.eventId);
    if (existingEvent !== undefined) {
      if (!isDeepStrictEqual(existingEvent, canonicalEvent)) {
        throw new DecisionLedgerConflictError(
          `Event ${canonicalEvent.eventId} was reused with different data`,
        );
      }
      return { inserted: false, value: cloneEvent(existingEvent) };
    }

    const priorEvents = this.events.get(id) ?? [];
    const currentState =
      priorEvents.at(-1)?.toState ?? decision.initialState;
    if (currentState !== canonicalEvent.fromState) {
      throw new DecisionLedgerConflictError(
        `Decision ${canonicalEvent.decisionId} is ${currentState}, not ${canonicalEvent.fromState}`,
      );
    }
    if (!isAllowedTransition(canonicalEvent.fromState, canonicalEvent.toState)) {
      throw new DecisionLedgerConflictError(
        `Transition ${canonicalEvent.fromState} -> ${canonicalEvent.toState} is not allowed`,
      );
    }
    const lastOccurredAtMs =
      priorEvents.at(-1)?.occurredAtMs ?? decision.createdAtMs;
    if (canonicalEvent.occurredAtMs < lastOccurredAtMs) {
      throw new DecisionLedgerConflictError(
        `Event ${canonicalEvent.eventId} predates the decision history`,
      );
    }

    const stored = cloneEvent(canonicalEvent);
    priorEvents.push(stored);
    this.events.set(id, priorEvents);
    this.eventIds.set(canonicalEvent.eventId, stored);
    return { inserted: true, value: cloneEvent(stored) };
  }

  public async getById(
    decisionId: `0x${string}`,
  ): Promise<DecisionView | null> {
    const id = decisionId.toLowerCase();
    return this.decisions.has(id) ? this.buildView(id) : null;
  }

  public async getByOrderRound(
    chainId: number,
    orderId: `0x${string}`,
    round: bigint,
  ): Promise<DecisionView | null> {
    const id = this.orderRounds.get(orderRoundKey(chainId, orderId, round));
    return id === undefined ? null : this.buildView(id);
  }

  private buildView(id: string): DecisionView {
    const decision = this.decisions.get(id);
    if (decision === undefined) throw new Error(`Decision ${id} is missing`);
    const events = this.events.get(id) ?? [];
    return {
      decision: cloneDecision(decision),
      evaluations: (this.evaluations.get(id) ?? []).map(cloneEvaluation),
      events: events.map(cloneEvent),
      currentState: events.at(-1)?.toState ?? decision.initialState,
    };
  }
}

function validateDecisionBundle(bundle: DecisionBundle): void {
  const decision = bundle.decision;
  if (
    decision.schema !== SHADOW_DECISION_SCHEMA ||
    decision.capability !== SHADOW_DECISION_CAPABILITY
  ) {
    throw new TypeError("Decision must use the transaction-disabled v2 schema");
  }
  assertBytes32(decision.decisionId, "decisionId");
  assertBytes32(decision.witnessContentId, "witnessContentId");
  assertAddress(decision.diamondAddress, "diamondAddress");
  assertBytes32(decision.orderId, "orderId");
  assertBytes32(decision.snapshotBlockHash, "snapshotBlockHash");
  assertBytes32(decision.policyHash, "policyHash");
  if (!Number.isSafeInteger(decision.chainId) || decision.chainId <= 0) {
    throw new RangeError("chainId must be a positive safe integer");
  }
  if (decision.round < 0n || decision.snapshotBlock < 0n) {
    throw new RangeError("round and snapshotBlock must be non-negative");
  }
  if (
    !Number.isSafeInteger(decision.createdAtMs) ||
    decision.createdAtMs < 0
  ) {
    throw new RangeError("createdAtMs must be a non-negative safe integer");
  }
  if (decision.initialState !== "computed") {
    throw new TypeError("A decision ledger entry must start as computed");
  }
  if (
    !isCanonicalVersionIdentifier(decision.helperBuildVersion) ||
    decision.canonicalPayload.length === 0 ||
    decision.canonicalWitness.length === 0
  ) {
    throw new TypeError(
      "helperBuildVersion must be canonical and decision evidence must not be empty",
    );
  }

  for (let index = 0; index < bundle.evaluations.length; index += 1) {
    const evaluation = bundle.evaluations[index];
    if (evaluation === undefined) {
      throw new Error("Candidate evaluation is missing");
    }
    if (
      evaluation.decisionId.toLowerCase() !==
      decision.decisionId.toLowerCase()
    ) {
      throw new DecisionLedgerConflictError(
        "Candidate evaluation references another decision",
      );
    }
    if (evaluation.ordinal !== index) {
      throw new RangeError(
        "Candidate evaluation ordinals must be contiguous and ordered",
      );
    }
    assertAddress(evaluation.merchant, "merchant");
    if (evaluation.channelId !== null) {
      assertBytes32(evaluation.channelId, "channelId");
    }
    if (!isEligibilityCode(evaluation.eligibilityCode)) {
      throw new TypeError("eligibilityCode must be a fixed code");
    }
    if (evaluation.required < 0n || evaluation.available < 0n) {
      throw new RangeError(
        "Candidate evaluation values must be non-negative",
      );
    }
    if (evaluation.checkedAtBlock !== decision.snapshotBlock) {
      throw new DecisionLedgerConflictError(
        "Candidate evaluation was not checked at the decision snapshot block",
      );
    }
  }

}

function validateEvaluationProjection(bundle: DecisionBundle): void {
  const expectedEvaluations = projectWitnessEvaluations(bundle.decision);
  if (!isDeepStrictEqual(bundle.evaluations, expectedEvaluations)) {
    throw new DecisionLedgerConflictError(
      "Candidate evaluations must exactly project canonical witness prestates",
    );
  }
}

/**
 * The generic ledger is a transaction-disabled canonical evidence store. Its
 * caller-supplied digest predicate is an additional check, never the trust
 * boundary: the complete v2 envelope and every duplicated identity/snapshot
 * field are validated here before a record is retained.
 */
async function validateCanonicalDecisionEvidence(
  decision: AssignmentDecisionRecord,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decision.canonicalPayload) as unknown;
  } catch {
    throw new DecisionPayloadIntegrityError(decision.decisionId);
  }
  try {
    const payload = requireEvidenceRecord(parsed, "canonicalPayload");
    const candidates = requireEvidenceArray(payload.candidates, "candidates");
    const selectedOperatorIds = candidates.map((candidate, index) => {
      const candidateRecord = requireEvidenceRecord(
        candidate,
        `candidates[${index}]`,
      );
      return requireEvidenceBytes32(
        candidateRecord.operatorId,
        `candidates[${index}].operatorId`,
      );
    });
    const universeCount = requireEvidenceUint(
      payload.universeCount,
      "universeCount",
    );
    if (universeCount > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new TypeError("universeCount exceeds the safe integer range");
    }

    const evidence: ShadowTraceRecord = {
      traceId: decision.decisionId,
      decisionId: decision.decisionId,
      chainId: decision.chainId,
      orderId: decision.orderId,
      round: decision.round,
      sequence: requireEvidenceUint(payload.sequence, "sequence"),
      stateBlock: decision.snapshotBlock,
      stateBlockHash: decision.snapshotBlockHash,
      policyHash: decision.policyHash,
      helperBuildHash: requireEvidenceBytes32(
        payload.helperBuildHash,
        "helperBuildHash",
      ),
      universeCount: Number(universeCount),
      universeRoot: requireEvidenceBytes32(
        payload.universeRoot,
        "universeRoot",
      ),
      eligibilityPrestateRoot: requireEvidenceBytes32(
        payload.eligibilityPrestateRoot,
        "eligibilityPrestateRoot",
      ),
      outputRoot: requireEvidenceBytes32(payload.outputRoot, "outputRoot"),
      canonicalPayload: decision.canonicalPayload,
      witnessContentId: decision.witnessContentId,
      canonicalWitness: decision.canonicalWitness,
      serviceStatus: "SHADOW_DECISION",
      noServiceReason: null,
      capability: SHADOW_DECISION_CAPABILITY,
      actionAuthorization: false,
      forecastOnly: true,
      selectedOperatorIds,
      createdAtMs: decision.createdAtMs,
    };
    validateShadowTraceRecord(evidence);
    await validateAndReplayShadowTraceRecord(evidence);
    const payloadDiamond = requireEvidenceAddress(
      payload.diamond,
      "diamond",
    );
    if (
      payloadDiamond.toLowerCase() !== decision.diamondAddress.toLowerCase()
    ) {
      throw new TypeError("diamond does not match decision metadata");
    }
  } catch (error) {
    if (error instanceof DecisionPayloadIntegrityError) throw error;
    throw new DecisionPayloadIntegrityError(decision.decisionId);
  }
}

function projectWitnessEvaluations(
  decision: AssignmentDecisionRecord,
): readonly CandidateEvaluationRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decision.canonicalWitness) as unknown;
  } catch {
    throw new DecisionPayloadIntegrityError(decision.decisionId);
  }
  try {
    const witness = requireEvidenceRecord(parsed, "canonicalWitness");
    const prestates = requireEvidenceArray(
      witness.eligibilityPrestates,
      "canonicalWitness.eligibilityPrestates",
    );
    return prestates.map((value, ordinal) => {
      const prestate = requireEvidenceRecord(
        value,
        `canonicalWitness.eligibilityPrestates[${ordinal}]`,
      );
      const eligibilityCode = prestate.eligibilityCode;
      if (!isEligibilityCode(eligibilityCode)) {
        throw new TypeError("Witness eligibilityCode must be a fixed code");
      }
      const source = prestate.source;
      if (source !== "snapshot" && source !== "contract") {
        throw new TypeError("Witness evaluation source is invalid");
      }
      const channelId = prestate.channelId === null
        ? null
        : requireEvidenceBytes32(
            prestate.channelId,
            `canonicalWitness.eligibilityPrestates[${ordinal}].channelId`,
          ).toLowerCase() as `0x${string}`;
      return {
        decisionId: decision.decisionId.toLowerCase() as `0x${string}`,
        ordinal,
        merchant: requireEvidenceAddress(
          prestate.merchant,
          `canonicalWitness.eligibilityPrestates[${ordinal}].merchant`,
        ).toLowerCase() as `0x${string}`,
        channelId,
        eligibilityCode,
        required: requireEvidenceUint(
          prestate.required,
          `canonicalWitness.eligibilityPrestates[${ordinal}].required`,
        ),
        available: requireEvidenceUint(
          prestate.available,
          `canonicalWitness.eligibilityPrestates[${ordinal}].available`,
        ),
        source,
        checkedAtBlock: requireEvidenceUint(
          prestate.checkedAtBlock,
          `canonicalWitness.eligibilityPrestates[${ordinal}].checkedAtBlock`,
        ),
      };
    });
  } catch (error) {
    if (error instanceof DecisionPayloadIntegrityError) throw error;
    throw new DecisionPayloadIntegrityError(decision.decisionId);
  }
}

const MAX_UINT256 = (1n << 256n) - 1n;

function requireEvidenceRecord(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireEvidenceArray(
  value: unknown,
  name: string,
): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function requireEvidenceUint(value: unknown, name: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new TypeError(`${name} must be a canonical unsigned integer`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_UINT256) throw new RangeError(`${name} exceeds uint256`);
  return parsed;
}

function requireEvidenceAddress(
  value: unknown,
  name: string,
): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new TypeError(`${name} must be a 20-byte hexadecimal value`);
  }
  return value as `0x${string}`;
}

function requireEvidenceBytes32(
  value: unknown,
  name: string,
): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError(`${name} must be a 32-byte hexadecimal value`);
  }
  return value as `0x${string}`;
}

function validateStateEvent(event: DecisionStateEvent): void {
  assertBytes32(event.eventId, "eventId");
  assertBytes32(event.decisionId, "decisionId");
  if (event.transactionAttemptId !== null) {
    assertBytes32(event.transactionAttemptId, "transactionAttemptId");
  }
  const validReasons: readonly DecisionReasonCode[] = [
    "READ_ONLY_SIMULATION",
    "SHADOW_MODE",
    "SIMULATION_FAILED",
    "SEND_BLOCKED",
    "SUPERSEDED",
  ];
  if (!validReasons.includes(event.reasonCode)) {
    throw new TypeError("reasonCode must be a fixed privacy-safe code");
  }
  if (!Number.isSafeInteger(event.occurredAtMs) || event.occurredAtMs < 0) {
    throw new RangeError("occurredAtMs must be a non-negative safe integer");
  }
}

function isAllowedTransition(
  from: DecisionState,
  to: DecisionState,
): boolean {
  const allowed: Readonly<Record<DecisionState, readonly DecisionState[]>> = {
    computed: [
      "shadowed",
      "simulation-failed",
      "simulated",
      "send-blocked",
      "superseded",
    ],
    simulated: ["shadowed", "send-blocked", "superseded"],
    shadowed: ["superseded"],
    "simulation-failed": ["superseded"],
    "send-blocked": ["superseded"],
    superseded: [],
  };
  return allowed[from].includes(to);
}

function orderRoundKey(
  chainId: number,
  orderId: `0x${string}`,
  round: bigint,
): string {
  return `${chainId}:${orderId.toLowerCase()}:${round}`;
}

function assertAddress(value: string, name: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new TypeError(`${name} must be a 20-byte hexadecimal value`);
  }
}

function assertBytes32(value: string, name: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError(`${name} must be a 32-byte hexadecimal value`);
  }
}

function cloneDecision(
  decision: AssignmentDecisionRecord,
): AssignmentDecisionRecord {
  return { ...decision };
}

function cloneEvaluation(
  evaluation: CandidateEvaluationRecord,
): CandidateEvaluationRecord {
  return { ...evaluation };
}

function cloneEvent(event: DecisionStateEvent): DecisionStateEvent {
  return { ...event };
}

function canonicalizeDecisionBundle(bundle: DecisionBundle): DecisionBundle {
  return {
    decision: canonicalizeDecision(bundle.decision),
    evaluations: bundle.evaluations.map(canonicalizeEvaluation),
  };
}

function canonicalizeDecision(
  decision: AssignmentDecisionRecord,
): AssignmentDecisionRecord {
  return {
    ...decision,
    decisionId: canonicalBytes32(decision.decisionId),
    diamondAddress: canonicalAddress(decision.diamondAddress),
    orderId: canonicalBytes32(decision.orderId),
    snapshotBlockHash: canonicalBytes32(decision.snapshotBlockHash),
    policyHash: canonicalBytes32(decision.policyHash),
    witnessContentId: canonicalBytes32(decision.witnessContentId),
  };
}

function canonicalizeEvaluation(
  evaluation: CandidateEvaluationRecord,
): CandidateEvaluationRecord {
  return {
    ...evaluation,
    decisionId: canonicalBytes32(evaluation.decisionId),
    merchant: canonicalAddress(evaluation.merchant),
    channelId:
      evaluation.channelId === null
        ? null
        : canonicalBytes32(evaluation.channelId),
  };
}

function canonicalizeStateEvent(
  event: DecisionStateEvent,
): DecisionStateEvent {
  return {
    ...event,
    eventId: canonicalBytes32(event.eventId),
    decisionId: canonicalBytes32(event.decisionId),
    transactionAttemptId:
      event.transactionAttemptId === null
        ? null
        : canonicalBytes32(event.transactionAttemptId),
  };
}

function canonicalBytes32(value: `0x${string}`): `0x${string}` {
  return value.toLowerCase() as `0x${string}`;
}

function canonicalAddress(value: `0x${string}`): `0x${string}` {
  return value.toLowerCase() as `0x${string}`;
}
