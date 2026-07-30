import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import test from "node:test";
import { HelperConfig } from "../src/config";
import { createLogger, ReadinessCheck } from "../src/operations";
import {
  RuntimeComponents,
  startRuntime,
} from "../src/runtime";

const address = "0x1111111111111111111111111111111111111111" as const;
const hash = `0x${"11".repeat(32)}` as const;

function config(): HelperConfig {
  return {
    chainId: 84_532,
    diamondAddress: address,
    primaryRpcUrl: new URL("https://primary.example.invalid"),
    fallbackRpcUrl: new URL("https://fallback.example.invalid"),
    startBlock: 1n,
    finalityConfirmations: 2,
    mode: "shadow",
    sendGate: {
      requested: false,
      enabled: false,
      blockers: ["COUNCIL_REJECT"],
    },
    council: {
      verdict: "REJECT",
      billSha256:
        "4295e790fd8f4e96e17fd54e033c4004bce7ed18aafc5a6c5bbda8d6f4931916",
    },
    databaseSecretReference: "secret://postgres",
    redisSecretReference: "secret://redis",
    helperBuildVersion: "test",
    policy: {
      version: "test",
      policyHash: hash,
      candidateCount: 4,
      assignmentTtlSeconds: 90,
      leaseStepSeconds: 15,
      maxStateAgeBlocks: 20,
      maxPendingOffersPerMerchant: 8,
      openOfferWeightNumerator: 1n,
      openOfferWeightDenominator: 4n,
      targetFiatShareBps: 5_000,
      buySafetyBufferBps: 500,
      minBuySafetyBufferUsdc: 1_000_000n,
      maxPriceDeviationBps: 100,
      minMerchantStakeUsdc: 300_000_000n,
      minOrderUsdc: 1_000_000n,
      maxOrderUsdc: 100_000_000n,
      acceptedOrderTimeoutSeconds: 900,
      disputeWindowSeconds: 600,
    },
  };
}

class TestComponents implements RuntimeComponents {
  public started = false;
  public stopped = false;
  public readonly readinessChecks: readonly ReadinessCheck[] = [
    {
      name: "test_dependency",
      required: true,
      run: () => ({ status: "pass", code: "OK" }),
    },
  ];

  public async start(): Promise<void> {
    this.started = true;
  }

  public async stop(): Promise<void> {
    this.stopped = true;
  }
}

class FailingStopComponents extends TestComponents {
  public override async stop(): Promise<void> {
    await super.stop();
    throw new Error("component stop failed");
  }
}

test("runtime rolls components back when its operations port cannot start", async () => {
  const occupied = createServer();
  await new Promise<void>((resolve, reject) => {
    occupied.once("error", reject);
    occupied.listen(0, "127.0.0.1", resolve);
  });
  const port = (occupied.address() as AddressInfo).port;
  const components = new TestComponents();
  try {
    await assert.rejects(
      startRuntime({
        config: config(),
        components,
        logger: createLogger({
          service: "test",
          sink: { write: () => undefined },
        }),
        host: "127.0.0.1",
        port,
      }),
      /EADDRINUSE/,
    );
    assert.equal(components.started, true);
    assert.equal(components.stopped, true);
  } finally {
    await new Promise<void>((resolve, reject) => {
      occupied.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

test("runtime closes operations even when a component stop fails", async () => {
  const runtime = await startRuntime({
    config: config(),
    components: new FailingStopComponents(),
    logger: createLogger({
      service: "test",
      sink: { write: () => undefined },
    }),
    host: "127.0.0.1",
    port: 0,
  });
  await assert.rejects(runtime.stop(), AggregateError);
  assert.throws(() => runtime.operationsServer.address(), /not listening/);
  await assert.rejects(runtime.stop(), AggregateError);
});
