import { isDeepStrictEqual } from "node:util";

export type DecisionState =
  | "computed"
  | "shadowed"
  | "simulation-failed"
  | "simulated"
  | "send-blocked"
  | "submitted"
  | "confirmed"
  | "reverted"
  | "superseded";

export interface AssignmentDecisionRecord {
  readonly decisionId: `0x${string}`;
  readonly chainId: number;
  readonly diamondAddress: `0x${string}`;
  readonly orderId: `0x${string}`;
  readonly round: bigint;
  readonly snapshotBlock: bigint;
  readonly snapshotBlockHash: `0x${string}`;
  readonly policyHash: `0x${string}`;
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
  readonly eligibilityCode: string;
  readonly required: bigint;
  readonly available: bigint;
  readonly source: "snapshot" | "contract";
  readonly detail: string | null;
}

export interface DecisionBundle {
  readonly decision: AssignmentDecisionRecord;
  readonly evaluations: readonly CandidateEvaluationRecord[];
}

export interface DecisionStateEvent {
  readonly eventId: string;
  readonly decisionId: `0x${string}`;
  readonly fromState: DecisionState;
  readonly toState: DecisionState;
  readonly occurredAtMs: number;
  readonly reasonCode: string;
  readonly transactionAttemptId: string | null;
  readonly metadataJson: string;
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

export class InMemoryDecisionLedger implements DecisionLedger {
  private readonly decisions = new Map<string, AssignmentDecisionRecord>();
  private readonly orderRounds = new Map<string, string>();
  private readonly evaluations = new Map<
    string,
    readonly CandidateEvaluationRecord[]
  >();
  private readonly events = new Map<string, DecisionStateEvent[]>();
  private readonly eventIds = new Map<string, DecisionStateEvent>();

  public async appendDecision(
    bundle: DecisionBundle,
  ): Promise<AppendResult<DecisionView>> {
    validateDecisionBundle(bundle);
    const id = bundle.decision.decisionId.toLowerCase();
    const orderRound = orderRoundKey(
      bundle.decision.chainId,
      bundle.decision.orderId,
      bundle.decision.round,
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
        !isDeepStrictEqual(existing, bundle.decision) ||
        !isDeepStrictEqual(existingEvaluations, bundle.evaluations)
      ) {
        throw new DecisionLedgerConflictError(
          `Decision ${bundle.decision.decisionId} was reused with different data`,
        );
      }
      const view = this.buildView(id);
      return { inserted: false, value: view };
    }

    this.decisions.set(id, cloneDecision(bundle.decision));
    this.orderRounds.set(orderRound, id);
    this.evaluations.set(
      id,
      bundle.evaluations.map(cloneEvaluation),
    );
    this.events.set(id, []);
    return { inserted: true, value: this.buildView(id) };
  }

  public async appendStateEvent(
    event: DecisionStateEvent,
  ): Promise<AppendResult<DecisionStateEvent>> {
    validateStateEvent(event);
    const id = event.decisionId.toLowerCase();
    if (!this.decisions.has(id)) {
      throw new DecisionLedgerConflictError(
        `Decision ${event.decisionId} does not exist`,
      );
    }

    const existingEvent = this.eventIds.get(event.eventId);
    if (existingEvent !== undefined) {
      if (!isDeepStrictEqual(existingEvent, event)) {
        throw new DecisionLedgerConflictError(
          `Event ${event.eventId} was reused with different data`,
        );
      }
      return { inserted: false, value: cloneEvent(existingEvent) };
    }

    const view = this.buildView(id);
    if (view.currentState !== event.fromState) {
      throw new DecisionLedgerConflictError(
        `Decision ${event.decisionId} is ${view.currentState}, not ${event.fromState}`,
      );
    }
    const stored = cloneEvent(event);
    this.events.get(id)?.push(stored);
    this.eventIds.set(event.eventId, stored);
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
    if (decision === undefined) {
      throw new Error(`Decision ${id} is missing`);
    }
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
  assertBytes32(decision.decisionId, "decisionId");
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
  if (
    decision.helperBuildVersion.length === 0 ||
    decision.canonicalPayload.length === 0
  ) {
    throw new TypeError(
      "helperBuildVersion and canonicalPayload must not be empty",
    );
  }

  const ordinals = new Set<number>();
  for (const evaluation of bundle.evaluations) {
    if (
      evaluation.decisionId.toLowerCase() !==
      decision.decisionId.toLowerCase()
    ) {
      throw new DecisionLedgerConflictError(
        "Candidate evaluation references another decision",
      );
    }
    if (
      !Number.isSafeInteger(evaluation.ordinal) ||
      evaluation.ordinal < 0 ||
      ordinals.has(evaluation.ordinal)
    ) {
      throw new RangeError(
        "Candidate evaluation ordinals must be unique non-negative integers",
      );
    }
    ordinals.add(evaluation.ordinal);
    assertAddress(evaluation.merchant, "merchant");
    if (evaluation.channelId !== null) {
      assertBytes32(evaluation.channelId, "channelId");
    }
    if (evaluation.eligibilityCode.length === 0) {
      throw new TypeError("eligibilityCode must not be empty");
    }
    if (evaluation.required < 0n || evaluation.available < 0n) {
      throw new RangeError(
        "Candidate evaluation values must be non-negative",
      );
    }
  }
}

function validateStateEvent(event: DecisionStateEvent): void {
  assertBytes32(event.decisionId, "decisionId");
  if (
    event.eventId.trim().length === 0 ||
    event.reasonCode.trim().length === 0
  ) {
    throw new TypeError("eventId and reasonCode must not be empty");
  }
  if (!Number.isSafeInteger(event.occurredAtMs) || event.occurredAtMs < 0) {
    throw new RangeError("occurredAtMs must be a non-negative safe integer");
  }
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
