import assert from "node:assert/strict";
import test from "node:test";
import { HelperConfig } from "../src/config";
import { createLogger, ReadinessCheck } from "../src/operations";
import {
  RuntimeComponents,
  startRuntime,
  UnconfiguredShadowComponents,
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
      blockers: ["test"],
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

test("runtime starts and stops injected components with healthy readiness", async () => {
  const components = new TestComponents();
  const lines: string[] = [];
  const runtime = await startRuntime({
    config: config(),
    components,
    logger: createLogger({
      service: "test",
      sink: { write: (line) => lines.push(line) },
    }),
    host: "127.0.0.1",
    port: 0,
  });
  assert.equal(components.started, true);
  assert.equal((await runtime.health.readiness()).status, "pass");
  assert.match(lines[0] ?? "", /"transactionSending":"disabled"/);
  assert.match(
    runtime.metrics.render(),
    /p2pflow_order_helper_up\{mode="shadow"\} 1/,
  );
  assert.match(
    runtime.metrics.render(),
    /p2pflow_order_helper_transaction_sending_enabled\{mode="shadow"\} 0/,
  );

  await runtime.stop();
  assert.equal(components.stopped, true);
  assert.match(
    runtime.metrics.render(),
    /p2pflow_order_helper_up\{mode="shadow"\} 0/,
  );
  await runtime.stop();
});

test("shipped unconfigured components fail readiness honestly", async () => {
  const runtime = await startRuntime({
    config: config(),
    components: new UnconfiguredShadowComponents(),
    logger: createLogger({
      service: "test",
      sink: { write: () => undefined },
    }),
    host: "127.0.0.1",
    port: 0,
  });
  const readiness = await runtime.health.readiness();
  assert.equal(readiness.status, "fail");
  assert.equal(
    readiness.checks.find((check) => check.name === "contract_interface")?.code,
    "UNVERIFIED_INTERFACE",
  );
  await runtime.stop();
});
