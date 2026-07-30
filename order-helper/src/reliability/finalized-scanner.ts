import {
  BlockHeader,
  ChainLog,
  ChainLogFilter,
  FinalizedChainSource,
  chainLogId,
  validateBlockHeader,
  validateLogAgainstFilter,
  validateLogFilter,
} from "./chain-events";

export interface BlockCheckpoint {
  readonly blockNumber: bigint;
  readonly blockHash: `0x${string}`;
}

export interface ScannerCursor {
  readonly chainId: number;
  readonly nextBlock: bigint;
  readonly version: number;
  readonly checkpoints: readonly BlockCheckpoint[];
}

export interface CanonicalBatch {
  readonly chainId: number;
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  readonly headers: readonly BlockHeader[];
  readonly logs: readonly ChainLog[];
}

export interface FinalizedScanStore {
  loadCursor(chainId: number): Promise<ScannerCursor | null>;
  commitBatch(
    expectedVersion: number | null,
    batch: CanonicalBatch,
    nextCursor: Omit<ScannerCursor, "version">,
  ): Promise<ScannerCursor>;
  rewind(
    chainId: number,
    expectedVersion: number,
    fromBlockInclusive: bigint,
    nextCursor: Omit<ScannerCursor, "version">,
  ): Promise<ScannerCursor>;
}

export interface ScanResult {
  readonly kind: "idle" | "committed";
  readonly finalizedHead: bigint;
  readonly fromBlock: bigint | null;
  readonly toBlock: bigint | null;
  readonly logCount: number;
  readonly reorgRewindFrom: bigint | null;
  readonly cursor: ScannerCursor | null;
}

export interface FinalizedScannerOptions {
  readonly confirmationDepth: bigint;
  readonly startBlock: bigint;
  readonly batchSize: bigint;
  readonly checkpointRetention: number;
}

export class CursorConflictError extends Error {
  public constructor(chainId: number) {
    super(`Scanner cursor for chain ${chainId} changed concurrently`);
    this.name = "CursorConflictError";
  }
}

export class FinalizedEventScanner {
  public constructor(
    private readonly source: FinalizedChainSource,
    private readonly store: FinalizedScanStore,
    private readonly filter: ChainLogFilter,
    private readonly options: FinalizedScannerOptions,
  ) {
    validateLogFilter(filter);
    validateOptions(options);
  }

  public async scanOnce(): Promise<ScanResult> {
    const chainId = this.filter.chainId;
    const head = await this.source.latestBlockNumber(chainId);
    if (head < 0n) {
      throw new RangeError("Latest block number must be non-negative");
    }
    const finalizedHead = head - this.options.confirmationDepth;
    let cursor = await this.store.loadCursor(chainId);
    let rewindFrom: bigint | null = null;

    if (cursor !== null) {
      const reconciled = await this.reconcile(cursor);
      cursor = reconciled.cursor;
      rewindFrom = reconciled.rewindFrom;
    }

    const nextBlock = cursor?.nextBlock ?? this.options.startBlock;
    if (finalizedHead < nextBlock || finalizedHead < this.options.startBlock) {
      return {
        kind: "idle",
        finalizedHead,
        fromBlock: null,
        toBlock: null,
        logCount: 0,
        reorgRewindFrom: rewindFrom,
        cursor,
      };
    }

    const toBlock = minBigInt(
      finalizedHead,
      nextBlock + this.options.batchSize - 1n,
    );
    const headers = await this.loadHeaders(chainId, nextBlock, toBlock);
    validateHeaderChain(headers, cursor?.checkpoints.at(-1) ?? null);

    const logs = [...await this.source.logs(
      this.filter,
      nextBlock,
      toBlock,
    )].sort(compareLogs);
    validateBatchLogs(logs, headers, this.filter, nextBlock, toBlock);

    const retained = [
      ...(cursor?.checkpoints ?? []),
      ...headers.map((header) => ({
        blockNumber: header.number,
        blockHash: header.hash,
      })),
    ].slice(-this.options.checkpointRetention);

    const committed = await this.store.commitBatch(
      cursor?.version ?? null,
      {
        chainId,
        fromBlock: nextBlock,
        toBlock,
        headers,
        logs,
      },
      {
        chainId,
        nextBlock: toBlock + 1n,
        checkpoints: retained,
      },
    );

    return {
      kind: "committed",
      finalizedHead,
      fromBlock: nextBlock,
      toBlock,
      logCount: logs.length,
      reorgRewindFrom: rewindFrom,
      cursor: committed,
    };
  }

  private async reconcile(
    cursor: ScannerCursor,
  ): Promise<{ cursor: ScannerCursor; rewindFrom: bigint | null }> {
    let firstMismatch: bigint | null = null;
    let sawMatchingAncestor = false;

    for (const checkpoint of cursor.checkpoints) {
      const current = await this.source.blockHeader(
        cursor.chainId,
        checkpoint.blockNumber,
      );
      if (current === null) {
        throw new Error(
          `Canonical header ${checkpoint.blockNumber} is unavailable`,
        );
      }
      validateBlockHeader(current, checkpoint.blockNumber);
      if (current.hash.toLowerCase() !== checkpoint.blockHash.toLowerCase()) {
        firstMismatch ??= checkpoint.blockNumber;
      } else if (firstMismatch === null) {
        sawMatchingAncestor = true;
      } else {
        throw new Error("RPC returned a non-contiguous canonical history");
      }
    }

    if (firstMismatch === null) {
      return { cursor, rewindFrom: null };
    }

    const rewindFrom = sawMatchingAncestor
      ? firstMismatch
      : this.options.startBlock;
    const retained = cursor.checkpoints.filter(
      (checkpoint) => checkpoint.blockNumber < rewindFrom,
    );
    const rewound = await this.store.rewind(
      cursor.chainId,
      cursor.version,
      rewindFrom,
      {
        chainId: cursor.chainId,
        nextBlock: rewindFrom,
        checkpoints: retained,
      },
    );
    return { cursor: rewound, rewindFrom };
  }

  private async loadHeaders(
    chainId: number,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<readonly BlockHeader[]> {
    const headers: BlockHeader[] = [];
    for (
      let blockNumber = fromBlock;
      blockNumber <= toBlock;
      blockNumber += 1n
    ) {
      const header = await this.source.blockHeader(chainId, blockNumber);
      if (header === null) {
        throw new Error(`Finalized block ${blockNumber} is unavailable`);
      }
      validateBlockHeader(header, blockNumber);
      headers.push(header);
    }
    return headers;
  }
}

export class InMemoryFinalizedScanStore implements FinalizedScanStore {
  private readonly cursors = new Map<number, ScannerCursor>();
  private readonly eventsByChain = new Map<number, Map<string, ChainLog>>();

  public async loadCursor(chainId: number): Promise<ScannerCursor | null> {
    const cursor = this.cursors.get(chainId);
    return cursor === undefined ? null : cloneCursor(cursor);
  }

  public async commitBatch(
    expectedVersion: number | null,
    batch: CanonicalBatch,
    nextCursor: Omit<ScannerCursor, "version">,
  ): Promise<ScannerCursor> {
    const current = this.cursors.get(batch.chainId);
    assertExpectedVersion(current, expectedVersion, batch.chainId);
    if (
      nextCursor.chainId !== batch.chainId ||
      nextCursor.nextBlock !== batch.toBlock + 1n
    ) {
      throw new Error("Batch cursor does not follow the committed block range");
    }

    const events =
      this.eventsByChain.get(batch.chainId) ?? new Map<string, ChainLog>();
    for (const log of batch.logs) {
      events.set(chainLogId(log), cloneLog(log));
    }
    this.eventsByChain.set(batch.chainId, events);

    const stored: ScannerCursor = {
      ...nextCursor,
      version: (current?.version ?? 0) + 1,
      checkpoints: nextCursor.checkpoints.map((entry) => ({ ...entry })),
    };
    this.cursors.set(batch.chainId, stored);
    return cloneCursor(stored);
  }

  public async rewind(
    chainId: number,
    expectedVersion: number,
    fromBlockInclusive: bigint,
    nextCursor: Omit<ScannerCursor, "version">,
  ): Promise<ScannerCursor> {
    const current = this.cursors.get(chainId);
    assertExpectedVersion(current, expectedVersion, chainId);
    if (
      nextCursor.chainId !== chainId ||
      nextCursor.nextBlock !== fromBlockInclusive
    ) {
      throw new Error("Rewind cursor must restart at fromBlockInclusive");
    }

    const events = this.eventsByChain.get(chainId);
    if (events !== undefined) {
      for (const [key, log] of events) {
        if (log.blockNumber >= fromBlockInclusive) events.delete(key);
      }
    }

    const stored: ScannerCursor = {
      ...nextCursor,
      version: expectedVersion + 1,
      checkpoints: nextCursor.checkpoints.map((entry) => ({ ...entry })),
    };
    this.cursors.set(chainId, stored);
    return cloneCursor(stored);
  }

  public events(chainId: number): readonly ChainLog[] {
    return [...(this.eventsByChain.get(chainId)?.values() ?? [])]
      .map(cloneLog)
      .sort(compareLogs);
  }
}

function validateOptions(options: FinalizedScannerOptions): void {
  if (
    options.confirmationDepth < 0n ||
    options.startBlock < 0n ||
    options.batchSize <= 0n
  ) {
    throw new RangeError(
      "confirmationDepth/startBlock must be non-negative and batchSize positive",
    );
  }
  if (
    !Number.isSafeInteger(options.checkpointRetention) ||
    options.checkpointRetention <= 0
  ) {
    throw new RangeError("checkpointRetention must be a positive safe integer");
  }
}

function validateHeaderChain(
  headers: readonly BlockHeader[],
  previous: BlockCheckpoint | null,
): void {
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index];
    if (header === undefined) throw new Error("Missing block header");
    const prior = index === 0 ? undefined : headers[index - 1];
    const expectedParentHash = prior?.hash ?? previous?.blockHash;
    if (
      expectedParentHash !== undefined &&
      header.parentHash.toLowerCase() !== expectedParentHash.toLowerCase()
    ) {
      throw new Error(`Non-contiguous block ancestry at ${header.number}`);
    }
  }
}

function validateBatchLogs(
  logs: readonly ChainLog[],
  headers: readonly BlockHeader[],
  filter: ChainLogFilter,
  fromBlock: bigint,
  toBlock: bigint,
): void {
  const hashes = new Map(
    headers.map((header) => [header.number, header.hash.toLowerCase()]),
  );
  const ids = new Set<string>();
  for (const log of logs) {
    validateLogAgainstFilter(log, filter);
    if (log.removed) {
      throw new Error("Finalized log source returned a removed log");
    }
    if (log.blockNumber < fromBlock || log.blockNumber > toBlock) {
      throw new Error("Finalized log is outside the requested block range");
    }
    if (hashes.get(log.blockNumber) !== log.blockHash.toLowerCase()) {
      throw new Error(
        `Log block hash does not match header at ${log.blockNumber}`,
      );
    }
    const id = chainLogId(log);
    if (ids.has(id)) throw new Error(`Duplicate log ${id} in RPC response`);
    ids.add(id);
  }
}

function assertExpectedVersion(
  current: ScannerCursor | undefined,
  expectedVersion: number | null,
  chainId: number,
): void {
  if (
    (current === undefined && expectedVersion !== null) ||
    (current !== undefined && current.version !== expectedVersion)
  ) {
    throw new CursorConflictError(chainId);
  }
}

function compareLogs(left: ChainLog, right: ChainLog): number {
  if (left.blockNumber !== right.blockNumber) {
    return left.blockNumber < right.blockNumber ? -1 : 1;
  }
  if (left.transactionIndex !== right.transactionIndex) {
    return left.transactionIndex - right.transactionIndex;
  }
  return left.logIndex - right.logIndex;
}

function cloneCursor(cursor: ScannerCursor): ScannerCursor {
  return {
    ...cursor,
    checkpoints: cursor.checkpoints.map((entry) => ({ ...entry })),
  };
}

function cloneLog(log: ChainLog): ChainLog {
  return {
    ...log,
    topics: [...log.topics],
  };
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
