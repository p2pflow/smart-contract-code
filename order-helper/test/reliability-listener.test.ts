import assert from "node:assert/strict";
import test from "node:test";
import {
  ChainLog,
  ChainLogFilter,
  ChainLogObserver,
  ChainLogSubscriber,
  ChainLogSubscription,
  EventHintSink,
  LiveChainListener,
} from "../src/reliability/chain-events";

const FILTER: ChainLogFilter = {
  chainId: 84_532,
  address: `0x${"11".repeat(20)}`,
};

class FakeSubscriber implements ChainLogSubscriber {
  public subscriptions = 0;
  public closes = 0;
  private observer: ChainLogObserver | null = null;

  public async subscribe(
    _filter: ChainLogFilter,
    observer: ChainLogObserver,
  ): Promise<ChainLogSubscription> {
    this.subscriptions += 1;
    this.observer = observer;
    return {
      close: async () => {
        this.closes += 1;
      },
    };
  }

  public async emit(log: ChainLog): Promise<void> {
    const observer = this.observer;
    if (observer === null) throw new Error("Listener is not subscribed");
    await observer.onLog(log);
  }
}

test("live listener is lifecycle-idempotent and emits hints only", async () => {
  const subscriber = new FakeSubscriber();
  const hints: ChainLog[] = [];
  const errors: unknown[] = [];
  const sink: EventHintSink = {
    recordHint: async (log) => {
      hints.push(log);
    },
  };
  const listener = new LiveChainListener(
    subscriber,
    FILTER,
    sink,
    async (error) => {
      errors.push(error);
    },
  );

  await listener.start();
  await listener.start();
  assert.equal(listener.isRunning(), true);
  assert.equal(subscriber.subscriptions, 1);
  await subscriber.emit(logForChain(84_532));
  assert.equal(hints.length, 1);
  assert.deepEqual(errors, []);

  await listener.stop();
  await listener.stop();
  assert.equal(listener.isRunning(), false);
  assert.equal(subscriber.closes, 1);
});

test("live listener rejects cross-chain subscription data", async () => {
  const subscriber = new FakeSubscriber();
  const hints: ChainLog[] = [];
  const listener = new LiveChainListener(
    subscriber,
    FILTER,
    {
      recordHint: async (log) => {
        hints.push(log);
      },
    },
    async () => undefined,
  );
  await listener.start();
  await assert.rejects(subscriber.emit(logForChain(1)), /while scanning/);
  assert.equal(hints.length, 0);
});

function logForChain(chainId: number): ChainLog {
  return {
    chainId,
    address: FILTER.address,
    topics: [],
    data: "0x",
    blockNumber: 10n,
    blockHash: `0x${"22".repeat(32)}`,
    transactionHash: `0x${"33".repeat(32)}`,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  };
}
