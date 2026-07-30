import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Clock, SystemClock, assertTimestamp } from "./clock";

export type ScheduledWorkStatus = "active" | "leased" | "completed" | "dead";
export type SweepReason = "expiry" | "retry";
export type OpaqueId = `0x${string}`;
export type DurableWorkKind =
  | "order-evaluation"
  | "order-expiry"
  | "transaction-reconciliation";
export type SweepErrorCode =
  | "LEASE_EXHAUSTED"
  | "POLICY_REJECTED"
  | "PROCESSOR_FAILED"
  | "ROUND_EXPIRED"
  | "RPC_UNAVAILABLE";

/**
 * Sweeper rows contain only typed references to state held by an authoritative
 * adapter. Free-form application payloads are deliberately not durable.
 */
export interface DurableWorkPayload {
  readonly schema: "order-helper.durable-work.v1";
  readonly kind: DurableWorkKind;
  readonly subjectId: OpaqueId;
  readonly contextId: OpaqueId | null;
}

export interface ScheduledWork<T> {
  readonly id: string;
  readonly payload: T;
  readonly status: ScheduledWorkStatus;
  readonly expiresAtMs: number | null;
  readonly retryAtMs: number | null;
  readonly expiryHandled: boolean;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly leaseOwner: string | null;
  readonly leaseToken: string | null;
  readonly leaseUntilMs: number | null;
  readonly leaseGeneration: bigint;
  readonly lastErrorCode: SweepErrorCode | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly sequence: number;
}

export interface ScheduledWorkInput<T> {
  readonly id: string;
  readonly payload: T;
  readonly expiresAtMs: number | null;
  readonly retryAtMs: number | null;
  readonly maxAttempts: number;
}

export interface SweepLease<T> {
  readonly work: ScheduledWork<T>;
  readonly reason: SweepReason;
  readonly owner: string;
  readonly token: string;
  readonly generation: bigint;
  readonly expiresAtMs: number;
}

export type SweepAction =
  | { readonly kind: "complete" }
  | {
      readonly kind: "retry";
      readonly retryAtMs: number;
      readonly errorCode: SweepErrorCode;
    }
  | { readonly kind: "dead"; readonly errorCode: SweepErrorCode };

export interface ScheduledWorkStore<T> {
  schedule(
    input: ScheduledWorkInput<T>,
  ): Promise<{ readonly inserted: boolean; readonly work: ScheduledWork<T> }>;
  claimDue(
    owner: string,
    leaseMs: number,
  ): Promise<SweepLease<T> | null>;
  complete(lease: SweepLease<T>): Promise<ScheduledWork<T>>;
  retry(
    lease: SweepLease<T>,
    retryAtMs: number,
    errorCode: SweepErrorCode,
  ): Promise<ScheduledWork<T>>;
  dead(
    lease: SweepLease<T>,
    errorCode: SweepErrorCode,
  ): Promise<ScheduledWork<T>>;
  get(id: string): Promise<ScheduledWork<T> | null>;
}

export interface SweepProcessor<T> {
  process(work: ScheduledWork<T>, reason: SweepReason): Promise<SweepAction>;
}

export interface ExpiryRetrySweeperOptions {
  readonly owner: string;
  readonly leaseMs: number;
  readonly failureRetryMs: number;
}

export interface SweepRunResult {
  readonly claimed: number;
  readonly completed: number;
  readonly retried: number;
  readonly dead: number;
}

export class SweepLeaseError extends Error {
  public constructor(id: string) {
    super(`Scheduled work ${id} has a stale or expired lease`);
    this.name = "SweepLeaseError";
  }
}

export class InMemoryScheduledWorkStore<T>
implements ScheduledWorkStore<T> {
  private readonly work = new Map<string, ScheduledWork<T>>();
  private nextSequence = 0;

  public constructor(
    private readonly clock: Clock = new SystemClock(),
    private readonly tokenFactory: () => string = randomOpaqueId,
  ) {}

  public async schedule(
    input: ScheduledWorkInput<T>,
  ): Promise<{ readonly inserted: boolean; readonly work: ScheduledWork<T> }> {
    validateInput(input);
    validateDurablePayload(input.payload);
    const canonicalId = canonicalOpaqueId(input.id);
    const isolatedPayload = canonicalizeDurablePayload(input.payload);
    const existing = this.work.get(canonicalId);
    if (existing !== undefined) {
      const same =
        isDeepStrictEqual(existing.payload, isolatedPayload) &&
        existing.expiresAtMs === input.expiresAtMs &&
        existing.retryAtMs === input.retryAtMs &&
        existing.maxAttempts === input.maxAttempts;
      if (!same) {
        throw new Error(
          `Scheduled work ${canonicalId} already exists with different data`,
        );
      }
      return { inserted: false, work: cloneWork(existing) };
    }
    const nowMs = this.clock.nowMs();
    const scheduled: ScheduledWork<T> = {
      ...input,
      id: canonicalId,
      payload: isolatedPayload,
      status: "active",
      expiryHandled: false,
      attempts: 0,
      leaseOwner: null,
      leaseToken: null,
      leaseUntilMs: null,
      leaseGeneration: 0n,
      lastErrorCode: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      sequence: this.nextSequence,
    };
    this.nextSequence += 1;
    this.work.set(canonicalId, scheduled);
    return { inserted: true, work: cloneWork(scheduled) };
  }

  public async claimDue(
    owner: string,
    leaseMs: number,
  ): Promise<SweepLease<T> | null> {
    assertOpaqueId(owner, "owner");
    const canonicalOwner = canonicalOpaqueId(owner);
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
      throw new RangeError("leaseMs must be a positive safe integer");
    }
    const nowMs = this.clock.nowMs();
    this.deadLetterExhaustedLeases(nowMs);
    const due = [...this.work.values()]
      .map((work) => ({ work, reason: dueReason(work, nowMs) }))
      .filter(
        (
          entry,
        ): entry is {
          readonly work: ScheduledWork<T>;
          readonly reason: SweepReason;
        } => entry.reason !== null,
      )
      .sort(compareDue)[0];
    if (due === undefined) return null;

    const token = this.tokenFactory();
    assertOpaqueId(token, "sweep token");
    const canonicalToken = canonicalOpaqueId(token);
    const leaseUntilMs = nowMs + leaseMs;
    const leased: ScheduledWork<T> = {
      ...due.work,
      status: "leased",
      attempts: due.work.attempts + 1,
      leaseOwner: canonicalOwner,
      leaseToken: canonicalToken,
      leaseUntilMs,
      leaseGeneration: due.work.leaseGeneration + 1n,
      updatedAtMs: nowMs,
    };
    this.work.set(leased.id, leased);
    return {
      work: cloneWork(leased),
      reason: due.reason,
      owner: canonicalOwner,
      token: canonicalToken,
      generation: leased.leaseGeneration,
      expiresAtMs: leaseUntilMs,
    };
  }

  public async complete(
    lease: SweepLease<T>,
  ): Promise<ScheduledWork<T>> {
    const current = this.requireLease(lease);
    return this.storeAfterLease(current, lease, {
      status: "completed",
      retryAtMs: null,
      lastErrorCode: null,
    });
  }

  public async retry(
    lease: SweepLease<T>,
    retryAtMs: number,
    errorCode: SweepErrorCode,
  ): Promise<ScheduledWork<T>> {
    assertTimestamp(retryAtMs, "retryAtMs");
    validateErrorCode(errorCode);
    const current = this.requireLease(lease);
    if (current.attempts >= current.maxAttempts) {
      return this.storeAfterLease(current, lease, {
        status: "dead",
        retryAtMs: null,
        lastErrorCode: errorCode,
      });
    }
    return this.storeAfterLease(current, lease, {
      status: "active",
      retryAtMs,
      lastErrorCode: errorCode,
    });
  }

  public async dead(
    lease: SweepLease<T>,
    errorCode: SweepErrorCode,
  ): Promise<ScheduledWork<T>> {
    validateErrorCode(errorCode);
    const current = this.requireLease(lease);
    return this.storeAfterLease(current, lease, {
      status: "dead",
      retryAtMs: null,
      lastErrorCode: errorCode,
    });
  }

  public async get(id: string): Promise<ScheduledWork<T> | null> {
    assertOpaqueId(id, "Scheduled work id");
    const current = this.work.get(canonicalOpaqueId(id));
    return current === undefined ? null : cloneWork(current);
  }

  private requireLease(lease: SweepLease<T>): ScheduledWork<T> {
    const current = this.work.get(lease.work.id);
    const nowMs = this.clock.nowMs();
    if (
      current === undefined ||
      current.status !== "leased" ||
      current.leaseOwner !== lease.owner ||
      current.leaseToken !== lease.token ||
      current.leaseGeneration !== lease.generation ||
      current.leaseUntilMs === null ||
      current.leaseUntilMs !== lease.expiresAtMs ||
      lease.work.leaseGeneration !== lease.generation ||
      lease.work.leaseUntilMs !== lease.expiresAtMs ||
      current.leaseUntilMs <= nowMs
    ) {
      throw new SweepLeaseError(lease.work.id);
    }
    return current;
  }

  private storeAfterLease(
    current: ScheduledWork<T>,
    lease: SweepLease<T>,
    update: Pick<
      ScheduledWork<T>,
      "status" | "retryAtMs" | "lastErrorCode"
    >,
  ): ScheduledWork<T> {
    const stored: ScheduledWork<T> = {
      ...current,
      ...update,
      expiryHandled:
        current.expiryHandled || lease.reason === "expiry",
      leaseOwner: null,
      leaseToken: null,
      leaseUntilMs: null,
      updatedAtMs: this.clock.nowMs(),
    };
    this.work.set(stored.id, stored);
    return cloneWork(stored);
  }

  private deadLetterExhaustedLeases(nowMs: number): void {
    for (const [id, work] of this.work) {
      if (
        work.status === "leased" &&
        work.leaseUntilMs !== null &&
        work.leaseUntilMs <= nowMs &&
        work.attempts >= work.maxAttempts
      ) {
        this.work.set(id, {
          ...work,
          status: "dead",
          leaseOwner: null,
          leaseToken: null,
          leaseUntilMs: null,
          retryAtMs: null,
          lastErrorCode: "LEASE_EXHAUSTED",
          updatedAtMs: nowMs,
        });
      }
    }
  }
}

export class ExpiryRetrySweeper<T> {
  public constructor(
    private readonly store: ScheduledWorkStore<T>,
    private readonly processor: SweepProcessor<T>,
    private readonly options: ExpiryRetrySweeperOptions,
    private readonly clock: Clock = new SystemClock(),
  ) {
    validateSweeperOptions(options);
  }

  public async runOnce(limit: number): Promise<SweepRunResult> {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new RangeError("limit must be a positive safe integer");
    }
    const result = {
      claimed: 0,
      completed: 0,
      retried: 0,
      dead: 0,
    };
    for (let count = 0; count < limit; count += 1) {
      const lease = await this.store.claimDue(
        this.options.owner,
        this.options.leaseMs,
      );
      if (lease === null) break;
      result.claimed += 1;
      let action: SweepAction;
      try {
        action = await this.processor.process(lease.work, lease.reason);
      } catch {
        action = {
          kind: "retry",
          retryAtMs: this.clock.nowMs() + this.options.failureRetryMs,
          errorCode: "PROCESSOR_FAILED",
        };
      }
      if (action.kind === "complete") {
        await this.store.complete(lease);
        result.completed += 1;
      } else if (action.kind === "dead") {
        await this.store.dead(lease, action.errorCode);
        result.dead += 1;
      } else {
        const work = await this.store.retry(
          lease,
          action.retryAtMs,
          action.errorCode,
        );
        if (work.status === "dead") {
          result.dead += 1;
        } else {
          result.retried += 1;
        }
      }
    }
    return result;
  }
}

function dueReason<T>(
  work: ScheduledWork<T>,
  nowMs: number,
): SweepReason | null {
  const claimable =
    work.status === "active" ||
    (
      work.status === "leased" &&
      work.leaseUntilMs !== null &&
      work.leaseUntilMs <= nowMs
    );
  if (!claimable || work.attempts >= work.maxAttempts) return null;
  if (
    !work.expiryHandled &&
    work.expiresAtMs !== null &&
    work.expiresAtMs <= nowMs
  ) {
    return "expiry";
  }
  if (work.retryAtMs !== null && work.retryAtMs <= nowMs) return "retry";
  return null;
}

function compareDue<T>(
  left: { readonly work: ScheduledWork<T>; readonly reason: SweepReason },
  right: { readonly work: ScheduledWork<T>; readonly reason: SweepReason },
): number {
  const leftDue =
    left.reason === "expiry"
      ? (left.work.expiresAtMs ?? 0)
      : (left.work.retryAtMs ?? 0);
  const rightDue =
    right.reason === "expiry"
      ? (right.work.expiresAtMs ?? 0)
      : (right.work.retryAtMs ?? 0);
  if (leftDue !== rightDue) return leftDue - rightDue;
  if (left.work.sequence !== right.work.sequence) {
    return left.work.sequence - right.work.sequence;
  }
  return left.work.id.localeCompare(right.work.id);
}

function validateInput<T>(input: ScheduledWorkInput<T>): void {
  assertOpaqueId(input.id, "Scheduled work id");
  if (input.expiresAtMs !== null) {
    assertTimestamp(input.expiresAtMs, "expiresAtMs");
  }
  if (input.retryAtMs !== null) {
    assertTimestamp(input.retryAtMs, "retryAtMs");
  }
  if (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts <= 0) {
    throw new RangeError("maxAttempts must be a positive safe integer");
  }
}

function validateSweeperOptions(options: ExpiryRetrySweeperOptions): void {
  assertOpaqueId(options.owner, "owner");
  if (
    !Number.isSafeInteger(options.leaseMs) ||
    options.leaseMs <= 0 ||
    !Number.isSafeInteger(options.failureRetryMs) ||
    options.failureRetryMs <= 0
  ) {
    throw new RangeError(
      "leaseMs and failureRetryMs must be positive safe integers",
    );
  }
}

function validateErrorCode(errorCode: string): void {
  if (!SWEEP_ERROR_CODES.has(errorCode)) {
    throw new TypeError("errorCode must be a supported sweep error category");
  }
}

function cloneWork<T>(work: ScheduledWork<T>): ScheduledWork<T> {
  return { ...work, payload: clonePayload(work.payload) };
}

function clonePayload<T>(payload: T): T {
  return structuredClone(payload);
}

function canonicalizeDurablePayload<T>(payload: T): T {
  const durable = payload as unknown as DurableWorkPayload;
  return {
    ...durable,
    subjectId: canonicalOpaqueId(durable.subjectId) as OpaqueId,
    contextId:
      durable.contextId === null
        ? null
        : canonicalOpaqueId(durable.contextId) as OpaqueId,
  } as unknown as T;
}

const DURABLE_PAYLOAD_KEYS = [
  "contextId",
  "kind",
  "schema",
  "subjectId",
] as const;

const DURABLE_WORK_KINDS: ReadonlySet<string> = new Set([
  "order-evaluation",
  "order-expiry",
  "transaction-reconciliation",
]);

const SWEEP_ERROR_CODES: ReadonlySet<string> = new Set([
  "LEASE_EXHAUSTED",
  "POLICY_REJECTED",
  "PROCESSOR_FAILED",
  "ROUND_EXPIRED",
  "RPC_UNAVAILABLE",
]);

function validateDurablePayload(
  payload: unknown,
): asserts payload is DurableWorkPayload {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    Object.getPrototypeOf(payload) !== Object.prototype ||
    Object.getOwnPropertySymbols(payload).length !== 0
  ) {
    throw new TypeError("payload must use the durable-work reference schema");
  }
  const record = payload as Readonly<Record<string, unknown>>;
  if (
    Object.keys(record).sort().join(",") !==
      [...DURABLE_PAYLOAD_KEYS].sort().join(",") ||
    record.schema !== "order-helper.durable-work.v1" ||
    typeof record.kind !== "string" ||
    !DURABLE_WORK_KINDS.has(record.kind) ||
    typeof record.subjectId !== "string" ||
    (
      record.contextId !== null &&
      typeof record.contextId !== "string"
    )
  ) {
    throw new TypeError("payload must use the durable-work reference schema");
  }
  assertOpaqueId(record.subjectId, "payload.subjectId");
  if (record.contextId !== null) {
    assertOpaqueId(record.contextId, "payload.contextId");
  }
}

function assertOpaqueId(value: string, name: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError(`${name} must be an opaque 32-byte identifier`);
  }
}

function canonicalOpaqueId(value: string): string {
  return `0x${value.slice(2).toLowerCase()}`;
}

function randomOpaqueId(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}
