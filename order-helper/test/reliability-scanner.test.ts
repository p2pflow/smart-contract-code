import assert from "node:assert/strict";
import test from "node:test";
import {
  BlockHeader,
  ChainLog,
  ChainLogFilter,
  FinalizedChainSource,
  Hex,
} from "../src/reliability/chain-events";
import {
  FinalizedEventScanner,
  InMemoryFinalizedScanStore,
} from "../src/reliability/finalized-scanner";

const CHAIN_ID = 84_532;
const CONTRACT = `0x${"aa".repeat(20)}` as Hex;
const TOPIC = hex32(777n);
const FILTER: ChainLogFilter = {
  chainId: CHAIN_ID,
  address: CONTRACT,
  topics: [TOPIC],
};

class MutableChainSource implements FinalizedChainSource {
  public head = 0n;
  public readonly headers = new Map<bigint, BlockHeader>();
  public chainLogs: ChainLog[] = [];

  public async latestBlockNumber(): Promise<bigint> {
    return this.head;
  }

  public async blockHeader(
    _chainId: number,
    blockNumber: bigint,
  ): Promise<BlockHeader | null> {
    return this.headers.get(blockNumber) ?? null;
  }

  public async logs(
    _filter: ChainLogFilter,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<readonly ChainLog[]> {
    return this.chainLogs.filter(
      (log) =>
        log.blockNumber >= fromBlock && log.blockNumber <= toBlock,
    );
  }
}

test("finalized scanner survives restart without duplicating events", async () => {
  const source = new MutableChainSource();
  installLinearHeaders(source, [
    [1n, hex32(1n), hex32(0n)],
    [2n, hex32(2n), hex32(1n)],
    [3n, hex32(3n), hex32(2n)],
  ]);
  source.chainLogs = [makeLog(2n, hex32(2n), hex32(102n))];
  source.head = 5n;
  const store = new InMemoryFinalizedScanStore();

  const firstScanner = scanner(source, store);
  const first = await firstScanner.scanOnce();
  assert.equal(first.kind, "committed");
  assert.equal(first.toBlock, 3n);
  assert.equal(first.logCount, 1);
  assert.equal(store.events(CHAIN_ID).length, 1);

  const restartedScanner = scanner(source, store);
  const afterRestart = await restartedScanner.scanOnce();
  assert.equal(afterRestart.kind, "idle");
  assert.equal(afterRestart.cursor?.nextBlock, 4n);
  assert.equal(store.events(CHAIN_ID).length, 1);
});

test("scanner rewinds orphaned finalized events and applies canonical logs", async () => {
  const source = new MutableChainSource();
  installLinearHeaders(source, [
    [1n, hex32(1n), hex32(0n)],
    [2n, hex32(2n), hex32(1n)],
    [3n, hex32(3n), hex32(2n)],
  ]);
  const stableTransaction = hex32(201n);
  const orphanedTransaction = hex32(202n);
  source.chainLogs = [
    makeLog(2n, hex32(2n), stableTransaction),
    makeLog(3n, hex32(3n), orphanedTransaction),
  ];
  source.head = 5n;
  const store = new InMemoryFinalizedScanStore();
  await scanner(source, store).scanOnce();

  const canonicalThree = hex32(303n);
  const canonicalFour = hex32(304n);
  installLinearHeaders(source, [
    [3n, canonicalThree, hex32(2n)],
    [4n, canonicalFour, canonicalThree],
  ]);
  const replacementTransaction = hex32(404n);
  source.chainLogs = [
    makeLog(2n, hex32(2n), stableTransaction),
    makeLog(3n, canonicalThree, replacementTransaction),
  ];
  source.head = 6n;

  const result = await scanner(source, store).scanOnce();
  assert.equal(result.kind, "committed");
  assert.equal(result.reorgRewindFrom, 3n);
  assert.equal(result.fromBlock, 3n);
  assert.equal(result.toBlock, 4n);
  assert.deepEqual(
    store.events(CHAIN_ID).map((log) => log.transactionHash),
    [stableTransaction, replacementTransaction],
  );
  assert.equal(
    store.events(CHAIN_ID).some(
      (log) => log.transactionHash === orphanedTransaction,
    ),
    false,
  );
});

test("scanner fails closed when an RPC log hash disagrees with its header", async () => {
  const source = new MutableChainSource();
  installLinearHeaders(source, [[1n, hex32(1n), hex32(0n)]]);
  source.chainLogs = [makeLog(1n, hex32(999n), hex32(100n))];
  source.head = 1n;
  const store = new InMemoryFinalizedScanStore();

  await assert.rejects(
    new FinalizedEventScanner(source, store, FILTER, {
      confirmationDepth: 0n,
      startBlock: 1n,
      batchSize: 10n,
      checkpointRetention: 16,
    }).scanOnce(),
    /Log block hash does not match header/,
  );
  assert.equal(await store.loadCursor(CHAIN_ID), null);
});

test("scanner fails closed when RPC logs do not match its filter", async () => {
  const source = new MutableChainSource();
  installLinearHeaders(source, [[1n, hex32(1n), hex32(0n)]]);
  source.chainLogs = [
    {
      ...makeLog(1n, hex32(1n), hex32(100n)),
      topics: [hex32(778n)],
    },
  ];
  source.head = 1n;
  const store = new InMemoryFinalizedScanStore();

  await assert.rejects(
    new FinalizedEventScanner(source, store, FILTER, {
      confirmationDepth: 0n,
      startBlock: 1n,
      batchSize: 10n,
      checkpointRetention: 16,
    }).scanOnce(),
    /topic predicate 0/,
  );
  assert.equal(await store.loadCursor(CHAIN_ID), null);
});

test("scanner rejects malformed external block headers before checkpointing", async () => {
  const malformedHeaders: readonly BlockHeader[] = [
    {
      number: -1n,
      hash: hex32(1n),
      parentHash: hex32(0n),
      timestamp: 1n,
    },
    {
      number: 1n,
      hash: hex32(1n),
      parentHash: hex32(0n),
      timestamp: -1n,
    },
    {
      number: 1n,
      hash: "0x1234",
      parentHash: hex32(0n),
      timestamp: 1n,
    },
    {
      number: 1n,
      hash: hex32(1n),
      parentHash: "0x1234",
      timestamp: 1n,
    },
  ];
  for (const header of malformedHeaders) {
    const source = new MutableChainSource();
    source.headers.set(1n, header);
    source.head = 1n;
    const store = new InMemoryFinalizedScanStore();
    await assert.rejects(
      new FinalizedEventScanner(source, store, FILTER, {
        confirmationDepth: 0n,
        startBlock: 1n,
        batchSize: 1n,
        checkpointRetention: 1,
      }).scanOnce(),
    );
    assert.equal(await store.loadCursor(CHAIN_ID), null);
  }
});

function scanner(
  source: FinalizedChainSource,
  store: InMemoryFinalizedScanStore,
): FinalizedEventScanner {
  return new FinalizedEventScanner(source, store, FILTER, {
    confirmationDepth: 2n,
    startBlock: 1n,
    batchSize: 20n,
    checkpointRetention: 32,
  });
}

function installLinearHeaders(
  source: MutableChainSource,
  headers: readonly [
    bigint,
    Hex,
    Hex,
  ][],
): void {
  for (const [number, hash, parentHash] of headers) {
    source.headers.set(number, {
      number,
      hash,
      parentHash,
      timestamp: number * 2n,
    });
  }
}

function makeLog(
  blockNumber: bigint,
  blockHash: Hex,
  transactionHash: Hex,
): ChainLog {
  return {
    chainId: CHAIN_ID,
    address: CONTRACT,
    topics: [TOPIC],
    data: "0x",
    blockNumber,
    blockHash,
    transactionHash,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  };
}

function hex32(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, "0")}`;
}
