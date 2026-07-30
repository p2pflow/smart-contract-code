import { HelperConfig } from "./config";
import {
  MetricsRegistry,
  OperationsHttpServer,
  ReadinessCheck,
  ServiceHealth,
  StructuredLogger,
} from "./operations";

export interface RuntimeComponents {
  readonly readinessChecks: readonly ReadinessCheck[];
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface RuntimeOptions {
  readonly config: HelperConfig;
  readonly components: RuntimeComponents;
  readonly logger: StructuredLogger;
  readonly host: string;
  readonly port: number;
}

export interface RunningRuntime {
  readonly health: ServiceHealth;
  readonly metrics: MetricsRegistry;
  readonly operationsServer: OperationsHttpServer;
  stop(): Promise<void>;
}

export class UnconfiguredShadowComponents implements RuntimeComponents {
  public readonly readinessChecks: readonly ReadinessCheck[] = [
    {
      name: "chain_snapshot",
      required: true,
      run: () => ({ status: "fail", code: "ADAPTER_NOT_INJECTED" }),
    },
    {
      name: "decision_store",
      required: true,
      run: () => ({ status: "fail", code: "ADAPTER_NOT_INJECTED" }),
    },
    {
      name: "contract_interface",
      required: true,
      run: () => ({ status: "fail", code: "UNVERIFIED_INTERFACE" }),
    },
  ];

  public async start(): Promise<void> {
    return Promise.resolve();
  }

  public async stop(): Promise<void> {
    return Promise.resolve();
  }
}

export async function startRuntime(
  options: RuntimeOptions,
): Promise<RunningRuntime> {
  const metrics = new MetricsRegistry();
  const metricLabels = { mode: options.config.mode } as const;
  const upMetric = metrics.gauge({
    name: "p2pflow_order_helper_up",
    help: "Whether the order helper runtime is running.",
    labelNames: ["mode"],
  });
  const sendingMetric = metrics.gauge({
    name: "p2pflow_order_helper_transaction_sending_enabled",
    help: "Whether transaction sending is enabled for this runtime.",
    labelNames: ["mode"],
  });
  upMetric.set(0, metricLabels);
  // The generic runtime is intentionally deny-all. A future reviewed runtime
  // must register its own evidence-backed authorization state.
  sendingMetric.set(0, metricLabels);
  const health = new ServiceHealth({
    mode: options.config.mode,
    // Concrete deployments must derive an authorizing gate from reviewed
    // evidence. This generic runtime never turns broadcasting on.
    sendGateEnabled: false,
    checks: options.components.readinessChecks,
  });
  const operationsServer = new OperationsHttpServer({
    health,
    metrics,
    host: options.host,
    port: options.port,
  });

  let componentsStarted = false;
  let address: { readonly host: string; readonly port: number };
  try {
    await options.components.start();
    componentsStarted = true;
    address = await operationsServer.start();
  } catch (startupError: unknown) {
    health.markStopping();
    upMetric.set(0, metricLabels);
    if (!componentsStarted) throw startupError;
    try {
      await options.components.stop();
    } catch (cleanupError: unknown) {
      throw new AggregateError(
        [startupError, cleanupError],
        "Runtime startup failed and component rollback also failed",
      );
    }
    throw startupError;
  }
  health.markRunning();
  upMetric.set(1, metricLabels);
  options.logger.info("runtime_started", {
    mode: options.config.mode,
    transactionSending: "disabled",
    operationsHostClass:
      address.host === "127.0.0.1" || address.host === "::1"
        ? "loopback"
        : "non-loopback",
    operationsPort: address.port,
  });

  let stopPromise: Promise<void> | null = null;
  const stopOnce = async (): Promise<void> => {
    health.markStopping();
    upMetric.set(0, metricLabels);
    const failures: unknown[] = [];
    try {
      await options.components.stop();
    } catch (error: unknown) {
      failures.push(error);
    }
    try {
      await operationsServer.stop();
    } catch (error: unknown) {
      failures.push(error);
    }
    options.logger.info("runtime_stopped", {
      mode: options.config.mode,
      transactionSending: "disabled",
    });
    if (failures.length > 0) {
      throw new AggregateError(failures, "Runtime shutdown failed");
    }
  };
  return {
    health,
    metrics,
    operationsServer,
    stop: async () => {
      stopPromise ??= stopOnce();
      await stopPromise;
    },
  };
}
