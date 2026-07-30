import assert from "node:assert/strict";
import test from "node:test";
import {
  createLogger,
  MetricsRegistry,
  OperationsHttpServer,
  redact,
  sanitizeEndpoint,
  ServiceHealth,
} from "../src/operations";

test("recursive redaction removes secrets, PII, endpoints, and binary data", () => {
  const value: Record<string, unknown> = {
    authorization: "Bearer do-not-expose",
    nested: {
      password: "password-value",
      contactEmail: "operator@example.test",
      primaryRpcUrl:
        "https://rpc-user:rpc-password@rpc.example.test/path?apiKey=query-value",
    },
    message:
      "request to https://rpc.example.test/path?token=query-value failed",
    bytes: Buffer.from("private-material"),
  };
  value.self = value;

  const serialized = JSON.stringify(redact(value));
  for (const forbidden of [
    "do-not-expose",
    "password-value",
    "operator@example.test",
    "rpc-user",
    "rpc-password",
    "rpc.example.test",
    "query-value",
    "private-material",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.match(serialized, /\[REDACTED\]/);
  assert.match(serialized, /\[REDACTED_PII\]/);
  assert.match(serialized, /\[CIRCULAR\]/);

  assert.deepEqual(sanitizeEndpoint("http://127.0.0.1:8545/private?token=x"), {
    transport: "http",
    networkClass: "loopback",
    credentials: "absent",
    query: "present",
    fragment: "absent",
    path: "present",
  });
});

test("structured logger emits stable JSON and never emits supplied secrets", () => {
  let output = "";
  const logger = createLogger({
    service: "order-helper",
    minimumLevel: "debug",
    clock: () => new Date("2026-07-29T12:00:00.000Z"),
    sink: {
      write(line: string): void {
        output += line;
      },
    },
  });

  logger.info(
    "dependency_check",
    {
      rpcEndpoint:
        "https://rpc-user:rpc-password@rpc.example.test/v1?token=value",
      apiKey: "secret-value",
      error: new Error(
        "Bearer bearer-value rejected by https://rpc.example.test/private",
      ),
    },
    "dependency completed",
  );

  assert.equal(output.endsWith("\n"), true);
  const record = JSON.parse(output) as Record<string, unknown>;
  assert.equal(record.level, "info");
  assert.equal(record.service, "order-helper");
  assert.equal(record.event, "dependency_check");
  for (const forbidden of [
    "rpc-user",
    "rpc-password",
    "rpc.example.test",
    "secret-value",
    "bearer-value",
  ]) {
    assert.equal(output.includes(forbidden), false);
  }
});

test("structured logging cannot fail business control flow", () => {
  const logger = createLogger({
    service: "order-helper",
    sink: {
      write(): never {
        throw new Error("sink unavailable");
      },
    },
  });
  assert.doesNotThrow(() => logger.info("safe_failure"));
});

test("Prometheus registry renders deterministic counter, gauge, and histogram samples", () => {
  const registry = new MetricsRegistry();
  const counter = registry.counter({
    name: "order_helper_jobs_total",
    help: "Jobs handled.",
    labelNames: ["outcome"],
  });
  const gauge = registry.gauge({
    name: "order_helper_queue_depth",
    help: "Current queue depth.",
  });
  const histogram = registry.histogram({
    name: "order_helper_assignment_seconds",
    help: "Assignment duration.",
    labelNames: ["mode"],
    buckets: [0.5, 1, 5],
  });

  counter.increment(2, { outcome: "success" });
  gauge.set(3);
  histogram.observe(0.75, { mode: "shadow" });

  const metrics = registry.render();
  assert.match(metrics, /# TYPE order_helper_jobs_total counter/);
  assert.match(metrics, /order_helper_jobs_total\{outcome="success"\} 2/);
  assert.match(metrics, /order_helper_queue_depth 3/);
  assert.match(
    metrics,
    /order_helper_assignment_seconds_bucket\{mode="shadow",le="0.5"\} 0/,
  );
  assert.match(
    metrics,
    /order_helper_assignment_seconds_bucket\{mode="shadow",le="1"\} 1/,
  );
  assert.match(
    metrics,
    /order_helper_assignment_seconds_bucket\{mode="shadow",le="\+Inf"\} 1/,
  );
  assert.match(metrics, /order_helper_assignment_seconds_count\{mode="shadow"\} 1/);

  counter.increment(1, {
    outcome: "https://private.example.test/path?token=value",
  });
  const sanitizedMetrics = registry.render();
  assert.equal(sanitizedMetrics.includes("private.example.test"), false);
  assert.match(sanitizedMetrics, /outcome="\[redacted\]"/);
  assert.throws(() => counter.increment(1, { unexpected: "value" }));
});

test("readiness fails closed for dependencies and a closed live send gate", async () => {
  const emptyShadowHealth = new ServiceHealth({ mode: "shadow" });
  emptyShadowHealth.markRunning();
  const emptyReadiness = await emptyShadowHealth.readiness();
  assert.equal(emptyReadiness.status, "fail");
  assert.equal(emptyReadiness.checks[0]?.code, "NO_READINESS_CHECKS");

  const shadowHealth = new ServiceHealth({
    mode: "shadow",
    checkTimeoutMs: 100,
    checks: [
      {
        name: "rpc",
        required: true,
        run: () => ({ status: "pass", code: "RPC_OK" }),
      },
      {
        name: "subgraph",
        required: false,
        run: () => ({ status: "degraded", code: "SUBGRAPH_LAGGING" }),
      },
    ],
  });
  assert.equal(shadowHealth.liveness().status, "fail");
  shadowHealth.markRunning();
  const shadowReadiness = await shadowHealth.readiness();
  assert.equal(shadowReadiness.status, "degraded");
  assert.equal(shadowReadiness.transactionSending, "disabled");

  const liveHealth = new ServiceHealth({
    mode: "live",
    sendGateEnabled: false,
  });
  liveHealth.markRunning();
  const liveReadiness = await liveHealth.readiness();
  assert.equal(liveReadiness.status, "fail");
  assert.equal(
    liveReadiness.checks.some(
      (check) =>
        check.name === "transaction_send_gate" &&
        check.code === "SEND_GATE_CLOSED",
    ),
    true,
  );

  const timedOut = new ServiceHealth({
    mode: "shadow",
    checkTimeoutMs: 5,
    checks: [
      {
        name: "queue",
        required: true,
        run: () => new Promise(() => undefined),
      },
    ],
  });
  timedOut.markRunning();
  const timeoutReadiness = await timedOut.readiness();
  assert.equal(timeoutReadiness.status, "fail");
  assert.equal(timeoutReadiness.checks[0]?.code, "TIMEOUT");
});

test("operations HTTP server serves health, readiness, and Prometheus endpoints", async () => {
  const health = new ServiceHealth({
    mode: "shadow",
    checks: [
      {
        name: "scanner",
        required: true,
        run: () => ({ status: "pass", code: "SCANNER_OK" }),
      },
    ],
  });
  health.markRunning();
  const metrics = new MetricsRegistry();
  metrics
    .gauge({
      name: "order_helper_up",
      help: "Process health marker.",
    })
    .set(1);
  const server = new OperationsHttpServer({
    health,
    metrics,
    host: "127.0.0.1",
    port: 0,
  });

  const address = await server.start();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const healthResponse = await fetch(`${baseUrl}/healthz?ignored=value`);
    assert.equal(healthResponse.status, 200);
    assert.equal((await healthResponse.json() as { status: string }).status, "pass");

    const readinessResponse = await fetch(`${baseUrl}/readyz`);
    assert.equal(readinessResponse.status, 200);
    assert.equal(
      (await readinessResponse.json() as { status: string }).status,
      "pass",
    );

    const metricsResponse = await fetch(`${baseUrl}/metrics`);
    assert.equal(metricsResponse.status, 200);
    assert.match(
      metricsResponse.headers.get("content-type") ?? "",
      /text\/plain/,
    );
    assert.match(await metricsResponse.text(), /order_helper_up 1/);

    const postResponse = await fetch(`${baseUrl}/metrics`, { method: "POST" });
    assert.equal(postResponse.status, 405);
    assert.equal(postResponse.headers.get("allow"), "GET, HEAD");
  } finally {
    await server.stop();
  }
});
