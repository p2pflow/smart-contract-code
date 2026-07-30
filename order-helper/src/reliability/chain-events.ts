export type Hex = `0x${string}`;

export interface BlockHeader {
  readonly number: bigint;
  readonly hash: Hex;
  readonly parentHash: Hex;
  readonly timestamp: bigint;
}

export interface ChainLog {
  readonly chainId: number;
  readonly address: Hex;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly transactionHash: Hex;
  readonly transactionIndex: number;
  readonly logIndex: number;
  readonly removed: boolean;
}

export interface ChainLogFilter {
  readonly chainId: number;
  readonly address: Hex;
  readonly topics?: readonly (Hex | readonly Hex[] | null)[];
}

export interface FinalizedChainSource {
  latestBlockNumber(chainId: number): Promise<bigint>;
  blockHeader(
    chainId: number,
    blockNumber: bigint,
  ): Promise<BlockHeader | null>;
  logs(
    filter: ChainLogFilter,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<readonly ChainLog[]>;
}

export interface ChainLogObserver {
  onLog(log: ChainLog): Promise<void>;
  onError(error: unknown): Promise<void>;
}

export interface ChainLogSubscription {
  close(): Promise<void>;
}

export interface ChainLogSubscriber {
  subscribe(
    filter: ChainLogFilter,
    observer: ChainLogObserver,
  ): Promise<ChainLogSubscription>;
}

export interface EventHintSink {
  recordHint(log: ChainLog): Promise<void>;
}

export class LiveChainListener {
  private subscription: ChainLogSubscription | null = null;
  private lifecycle: Promise<void> = Promise.resolve();
  private desiredRunning = false;

  public constructor(
    private readonly subscriber: ChainLogSubscriber,
    private readonly filter: ChainLogFilter,
    private readonly sink: EventHintSink,
    private readonly onError: (error: unknown) => Promise<void>,
  ) {
    validateLogFilter(filter);
  }

  public async start(): Promise<void> {
    this.desiredRunning = true;
    return this.serializeLifecycle(async () => {
      if (!this.desiredRunning || this.subscription !== null) return;
      const subscription = await this.subscriber.subscribe(this.filter, {
        onLog: async (log) => {
          validateLogAgainstFilter(log, this.filter);
          await this.sink.recordHint(log);
        },
        onError: this.onError,
      });
      if (!this.desiredRunning) {
        await subscription.close();
        return;
      }
      this.subscription = subscription;
    });
  }

  public async stop(): Promise<void> {
    this.desiredRunning = false;
    return this.serializeLifecycle(async () => {
      const active = this.subscription;
      this.subscription = null;
      if (active !== null) await active.close();
    });
  }

  public isRunning(): boolean {
    return this.subscription !== null;
  }

  private serializeLifecycle(operation: () => Promise<void>): Promise<void> {
    const result = this.lifecycle.then(operation, operation);
    this.lifecycle = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function chainLogId(log: ChainLog): string {
  return [
    log.chainId,
    log.blockHash.toLowerCase(),
    log.transactionHash.toLowerCase(),
    log.logIndex,
  ].join(":");
}

export function validateBlockHeader(
  header: BlockHeader,
  expectedNumber?: bigint,
): void {
  if (header.number < 0n) {
    throw new RangeError("Block header number must be non-negative");
  }
  if (expectedNumber !== undefined && header.number !== expectedNumber) {
    throw new Error(
      `Requested block ${expectedNumber} but received ${header.number}`,
    );
  }
  if (header.timestamp < 0n) {
    throw new RangeError("Block header timestamp must be non-negative");
  }
  assertBytes32(header.hash, "blockHeader.hash");
  assertBytes32(header.parentHash, "blockHeader.parentHash");
}

export function validateLog(log: ChainLog, expectedChainId: number): void {
  if (log.chainId !== expectedChainId) {
    throw new Error(
      `Received chain ${log.chainId} log while scanning ${expectedChainId}`,
    );
  }
  if (log.blockNumber < 0n) {
    throw new RangeError("Log blockNumber must be non-negative");
  }
  if (
    !Number.isSafeInteger(log.transactionIndex) ||
    log.transactionIndex < 0 ||
    !Number.isSafeInteger(log.logIndex) ||
    log.logIndex < 0
  ) {
    throw new RangeError("Log indices must be non-negative safe integers");
  }
  assertAddress(log.address, "log.address");
  assertBytes32(log.blockHash, "log.blockHash");
  assertBytes32(log.transactionHash, "log.transactionHash");
  assertHex(log.data, "log.data");
  for (const topic of log.topics) {
    assertBytes32(topic, "log.topic");
  }
}

export function validateLogFilter(filter: ChainLogFilter): void {
  if (!Number.isSafeInteger(filter.chainId) || filter.chainId <= 0) {
    throw new RangeError("filter.chainId must be a positive safe integer");
  }
  assertAddress(filter.address, "filter.address");
  if (filter.topics !== undefined) {
    if (filter.topics.length > 4) {
      throw new RangeError("filter.topics cannot contain more than 4 positions");
    }
    for (const predicate of filter.topics) {
      if (predicate === null) continue;
      if (typeof predicate === "string") {
        assertBytes32(predicate, "filter.topic");
        continue;
      }
      if (predicate.length === 0) {
        throw new TypeError("filter topic alternatives cannot be empty");
      }
      for (const alternative of predicate) {
        assertBytes32(alternative, "filter.topic alternative");
      }
    }
  }
}

export function validateLogAgainstFilter(
  log: ChainLog,
  filter: ChainLogFilter,
): void {
  validateLogFilter(filter);
  validateLog(log, filter.chainId);
  if (log.address.toLowerCase() !== filter.address.toLowerCase()) {
    throw new Error("RPC log does not match the configured contract address");
  }
  for (let index = 0; index < (filter.topics?.length ?? 0); index += 1) {
    const predicate = filter.topics?.[index];
    if (predicate === null || predicate === undefined) continue;
    const actual = log.topics[index]?.toLowerCase();
    const matches =
      typeof predicate === "string"
        ? actual === predicate.toLowerCase()
        : predicate.some(
            (alternative) => actual === alternative.toLowerCase(),
          );
    if (!matches) {
      throw new Error(`RPC log does not match topic predicate ${index}`);
    }
  }
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

function assertHex(value: string, name: string): void {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new TypeError(`${name} must be an even-length hexadecimal value`);
  }
}
