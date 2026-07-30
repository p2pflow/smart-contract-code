import {
  CanonicalBatch,
  ScannerCursor,
} from "../reliability/finalized-scanner";
import {
  JobIdentity,
  JobKey,
  QueueJob,
  QueueLease,
  RetryInstruction,
} from "../reliability/idempotent-queue";

export type SqlParameter =
  | boolean
  | Buffer
  | Date
  | number
  | string
  | null;

export interface SqlQueryResult<Row extends Readonly<Record<string, unknown>>> {
  readonly rows: readonly Row[];
  readonly rowCount: number;
}

export interface PostgresTransaction {
  query<Row extends Readonly<Record<string, unknown>>>(
    sql: string,
    parameters?: readonly SqlParameter[],
  ): Promise<SqlQueryResult<Row>>;
}

export interface PostgresPool {
  withTransaction<Result>(
    operation: (transaction: PostgresTransaction) => Promise<Result>,
  ): Promise<Result>;
}

export interface PostgresScannerRepository {
  loadCursor(
    transaction: PostgresTransaction,
    chainId: number,
    lockForUpdate: boolean,
  ): Promise<ScannerCursor | null>;
  commitCanonicalBatch(
    transaction: PostgresTransaction,
    expectedVersion: number | null,
    batch: CanonicalBatch,
    nextCursor: Omit<ScannerCursor, "version">,
  ): Promise<ScannerCursor>;
  rewindCanonicalEvents(
    transaction: PostgresTransaction,
    chainId: number,
    expectedVersion: number,
    fromBlockInclusive: bigint,
    nextCursor: Omit<ScannerCursor, "version">,
  ): Promise<ScannerCursor>;
}

export interface RedisQueueBackend<T> {
  /**
   * Must atomically insert the job when absent or return the existing job.
   * An implementation must reject a same-key payload/policy mismatch.
   */
  enqueueIfAbsent(
    key: JobKey,
    identity: JobIdentity,
    payload: T,
    availableAtMs: number,
    maxAttempts: number,
  ): Promise<{ readonly inserted: boolean; readonly job: QueueJob<T> }>;

  /**
   * Must atomically reclaim expired leases, select one due job, increment its
   * attempt counter, and install a fencing token plus monotonic generation.
   */
  claimDue(
    owner: string,
    nowMs: number,
    leaseUntilMs: number,
    leaseToken: string,
  ): Promise<QueueLease<T> | null>;

  /**
   * Must compare owner + token + generation + exact expiry in one script.
   */
  acknowledge(
    lease: QueueLease<T>,
    completedAtMs: number,
  ): Promise<QueueJob<T>>;

  /**
   * Must compare the lease and schedule or dead-letter the job atomically.
   */
  reschedule(
    lease: QueueLease<T>,
    instruction: RetryInstruction,
    updatedAtMs: number,
  ): Promise<QueueJob<T>>;
}

export interface SecretReferenceResolver {
  /**
   * Returns an opaque, short-lived credential object to a caller that already
   * has workload identity authorization. Implementations must never log it.
   */
  resolve(reference: string): Promise<Readonly<Record<string, unknown>>>;
}

/**
 * Future-reconsideration interface only. The shipped REJECT runtime does not
 * construct or consume this boundary, and no raw transaction bytes cross it.
 */
export interface InactiveFutureKmsSigningBoundary {
  readonly keyReference: string;
  address(): Promise<`0x${string}`>;
  prepareOpaqueEnvelope(
    transaction: Readonly<Record<string, bigint | number | string>>,
  ): Promise<{
    readonly transactionHash: `0x${string}`;
    readonly opaqueEnvelopeReference: string;
  }>;
}
