import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Clock, SystemClock, assertTimestamp } from "./clock";

export type JobKey = `${number}:0x${string}:${bigint}`;
export type OpaqueId = `0x${string}`;
export type DurableWorkKind =
  | "order-evaluation"
  | "order-expiry"
  | "transaction-reconciliation";
export type QueueErrorCode =
  | "LEASE_EXHAUSTED"
  | "POLICY_REJECTED"
  | "PROCESSING_FAILED"
  | "RPC_UNAVAILABLE";

/**
 * The queue stores references, never arbitrary application objects. This
 * exact schema keeps civil identity, bank, UPI, Telegram, and free-form text
 * out of every durable queue adapter.
 */
export interface DurableWorkPayload {
  readonly schema: "order-helper.durable-work.v1";
  readonly kind: DurableWorkKind;
  readonly subjectId: OpaqueId;
  readonly contextId: OpaqueId | null;
}
export type QueueJobStatus =
  | "scheduled"
  | "leased"
  | "succeeded"
  | "dead-letter";

export interface JobIdentity {
  readonly chainId: number;
  readonly orderId: `0x${string}`;
  readonly round: bigint;
}

export interface EnqueueOptions {
  readonly availableAtMs?: number;
  readonly maxAttempts?: number;
}

export interface QueueJob<T> {
  readonly key: JobKey;
  readonly identity: JobIdentity;
  readonly payload: T;
  readonly status: QueueJobStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly availableAtMs: number;
  readonly leaseOwner: string | null;
  readonly leaseToken: string | null;
  readonly leaseUntilMs: number | null;
  readonly leaseGeneration: bigint;
  readonly lastErrorCode: QueueErrorCode | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly sequence: number;
}

export interface QueueLease<T> {
  readonly job: QueueJob<T>;
  readonly owner: string;
  readonly token: string;
  readonly generation: bigint;
  readonly expiresAtMs: number;
}

export interface RetryInstruction {
  readonly availableAtMs: number;
  readonly errorCode: QueueErrorCode;
  readonly terminal?: boolean;
}

export type EnqueueResult<T> =
  | { readonly inserted: true; readonly job: QueueJob<T> }
  | { readonly inserted: false; readonly job: QueueJob<T> };

export interface IdempotentQueue<T> {
  enqueue(
    identity: JobIdentity,
    payload: T,
    options?: EnqueueOptions,
  ): Promise<EnqueueResult<T>>;
  get(key: JobKey): Promise<QueueJob<T> | null>;
  leaseNext(owner: string, leaseMs: number): Promise<QueueLease<T> | null>;
  complete(lease: QueueLease<T>): Promise<QueueJob<T>>;
  retry(
    lease: QueueLease<T>,
    instruction: RetryInstruction,
  ): Promise<QueueJob<T>>;
  depth(): Promise<Readonly<Record<QueueJobStatus, number>>>;
}

export class QueueConflictError extends Error {
  public constructor(key: JobKey) {
    super(`Queue key ${key} already exists with a different payload or policy`);
    this.name = "QueueConflictError";
  }
}

export class StaleLeaseError extends Error {
  public constructor(key: JobKey) {
    super(`Lease for ${key} is absent, expired, or no longer owned`);
    this.name = "StaleLeaseError";
  }
}

export function orderJobKey(identity: JobIdentity): JobKey {
  if (!Number.isSafeInteger(identity.chainId) || identity.chainId <= 0) {
    throw new RangeError("chainId must be a positive safe integer");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(identity.orderId)) {
    throw new TypeError("orderId must be a 32-byte hexadecimal value");
  }
  if (identity.round < 0n) {
    throw new RangeError("round must be non-negative");
  }
  return `${identity.chainId}:${identity.orderId.toLowerCase()}:${identity.round}` as JobKey;
}

export class InMemoryIdempotentQueue<T> implements IdempotentQueue<T> {
  private readonly jobs = new Map<JobKey, QueueJob<T>>();
  private nextSequence = 0;

  public constructor(
    private readonly clock: Clock = new SystemClock(),
    private readonly tokenFactory: () => string = randomOpaqueId,
  ) {}

  public async enqueue(
    identity: JobIdentity,
    payload: T,
    options: EnqueueOptions = {},
  ): Promise<EnqueueResult<T>> {
    const key = orderJobKey(identity);
    const availableAtMs = options.availableAtMs ?? this.clock.nowMs();
    const maxAttempts = options.maxAttempts ?? 8;
    assertTimestamp(availableAtMs, "availableAtMs");
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
      throw new RangeError("maxAttempts must be a positive safe integer");
    }

    validateDurablePayload(payload);
    const isolatedPayload = clonePayload(payload);
    const existing = this.jobs.get(key);
    if (existing !== undefined) {
      if (
        !isDeepStrictEqual(existing.payload, isolatedPayload) ||
        existing.maxAttempts !== maxAttempts
      ) {
        throw new QueueConflictError(key);
      }
      return { inserted: false, job: cloneJob(existing) };
    }

    const nowMs = this.clock.nowMs();
    const job: QueueJob<T> = {
      key,
      identity: {
        chainId: identity.chainId,
        orderId: identity.orderId.toLowerCase() as `0x${string}`,
        round: identity.round,
      },
      payload: isolatedPayload,
      status: "scheduled",
      attempts: 0,
      maxAttempts,
      availableAtMs,
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
    this.jobs.set(key, job);
    return { inserted: true, job: cloneJob(job) };
  }

  public async get(key: JobKey): Promise<QueueJob<T> | null> {
    const job = this.jobs.get(key);
    return job === undefined ? null : cloneJob(job);
  }

  public async leaseNext(
    owner: string,
    leaseMs: number,
  ): Promise<QueueLease<T> | null> {
    assertOpaqueId(owner, "owner");
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
      throw new RangeError("leaseMs must be a positive safe integer");
    }
    const nowMs = this.clock.nowMs();
    this.deadLetterExhaustedLeases(nowMs);
    const claimable = [...this.jobs.values()]
      .filter((job) => isClaimable(job, nowMs))
      .sort(compareJobs)[0];
    if (claimable === undefined) return null;

    const token = this.tokenFactory();
    assertOpaqueId(token, "lease token");
    const expiresAtMs = nowMs + leaseMs;
    const leased: QueueJob<T> = {
      ...claimable,
      status: "leased",
      attempts: claimable.attempts + 1,
      leaseOwner: owner,
      leaseToken: token,
      leaseUntilMs: expiresAtMs,
      leaseGeneration: claimable.leaseGeneration + 1n,
      updatedAtMs: nowMs,
    };
    this.jobs.set(claimable.key, leased);
    return {
      job: cloneJob(leased),
      owner,
      token,
      generation: leased.leaseGeneration,
      expiresAtMs,
    };
  }

  public async complete(lease: QueueLease<T>): Promise<QueueJob<T>> {
    const current = this.requireCurrentLease(lease);
    const completed: QueueJob<T> = {
      ...current,
      status: "succeeded",
      leaseOwner: null,
      leaseToken: null,
      leaseUntilMs: null,
      updatedAtMs: this.clock.nowMs(),
    };
    this.jobs.set(current.key, completed);
    return cloneJob(completed);
  }

  public async retry(
    lease: QueueLease<T>,
    instruction: RetryInstruction,
  ): Promise<QueueJob<T>> {
    assertTimestamp(instruction.availableAtMs, "availableAtMs");
    validateQueueErrorCode(instruction.errorCode);
    const current = this.requireCurrentLease(lease);
    const terminal =
      instruction.terminal === true ||
      current.attempts >= current.maxAttempts;
    const retried: QueueJob<T> = {
      ...current,
      status: terminal ? "dead-letter" : "scheduled",
      availableAtMs: instruction.availableAtMs,
      leaseOwner: null,
      leaseToken: null,
      leaseUntilMs: null,
      lastErrorCode: instruction.errorCode,
      updatedAtMs: this.clock.nowMs(),
    };
    this.jobs.set(current.key, retried);
    return cloneJob(retried);
  }

  public async depth(): Promise<Readonly<Record<QueueJobStatus, number>>> {
    const result: Record<QueueJobStatus, number> = {
      scheduled: 0,
      leased: 0,
      succeeded: 0,
      "dead-letter": 0,
    };
    for (const job of this.jobs.values()) {
      result[job.status] += 1;
    }
    return result;
  }

  private requireCurrentLease(lease: QueueLease<T>): QueueJob<T> {
    const current = this.jobs.get(lease.job.key);
    const nowMs = this.clock.nowMs();
    if (
      current === undefined ||
      current.status !== "leased" ||
      current.leaseOwner !== lease.owner ||
      current.leaseToken !== lease.token ||
      current.leaseGeneration !== lease.generation ||
      current.leaseUntilMs === null ||
      current.leaseUntilMs !== lease.expiresAtMs ||
      lease.job.leaseGeneration !== lease.generation ||
      lease.job.leaseUntilMs !== lease.expiresAtMs ||
      current.leaseUntilMs <= nowMs
    ) {
      throw new StaleLeaseError(lease.job.key);
    }
    return current;
  }

  private deadLetterExhaustedLeases(nowMs: number): void {
    for (const [key, job] of this.jobs) {
      if (
        job.status === "leased" &&
        job.leaseUntilMs !== null &&
        job.leaseUntilMs <= nowMs &&
        job.attempts >= job.maxAttempts
      ) {
        this.jobs.set(key, {
          ...job,
          status: "dead-letter",
          leaseOwner: null,
          leaseToken: null,
          leaseUntilMs: null,
          lastErrorCode: "LEASE_EXHAUSTED",
          updatedAtMs: nowMs,
        });
      }
    }
  }
}

function isClaimable<T>(job: QueueJob<T>, nowMs: number): boolean {
  if (job.status === "scheduled") {
    return job.availableAtMs <= nowMs && job.attempts < job.maxAttempts;
  }
  return (
    job.status === "leased" &&
    job.leaseUntilMs !== null &&
    job.leaseUntilMs <= nowMs &&
    job.attempts < job.maxAttempts
  );
}

function compareJobs<T>(left: QueueJob<T>, right: QueueJob<T>): number {
  if (left.availableAtMs !== right.availableAtMs) {
    return left.availableAtMs - right.availableAtMs;
  }
  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }
  return left.key.localeCompare(right.key);
}

function cloneJob<T>(job: QueueJob<T>): QueueJob<T> {
  return {
    ...job,
    identity: { ...job.identity },
    payload: clonePayload(job.payload),
  };
}

function clonePayload<T>(payload: T): T {
  return structuredClone(payload);
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

const QUEUE_ERROR_CODES: ReadonlySet<string> = new Set([
  "LEASE_EXHAUSTED",
  "POLICY_REJECTED",
  "PROCESSING_FAILED",
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

function validateQueueErrorCode(errorCode: string): void {
  if (!QUEUE_ERROR_CODES.has(errorCode)) {
    throw new TypeError("errorCode must be a supported queue error category");
  }
}

function assertOpaqueId(value: string, name: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError(`${name} must be an opaque 32-byte identifier`);
  }
}

function randomOpaqueId(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}
