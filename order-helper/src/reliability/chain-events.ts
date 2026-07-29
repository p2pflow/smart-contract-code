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

  public constructor(
    private readonly subscriber: ChainLogSubscriber,
    private readonly filter: ChainLogFilter,
    private readonly sink: EventHintSink,
    private readonly onError: (error: unknown) => Promise<void>,
  ) {}

  public async start(): Promise<void> {
    if (this.subscription !== null) return;
    this.subscription = await this.subscriber.subscribe(this.filter, {
      onLog: async (log) => {
        validateLog(log, this.filter.chainId);
        await this.sink.recordHint(log);
      },
      onError: this.onError,
    });
  }

  public async stop(): Promise<void> {
    const active = this.subscription;
    this.subscription = null;
    if (active !== null) await active.close();
  }

  public isRunning(): boolean {
    return this.subscription !== null;
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
}
