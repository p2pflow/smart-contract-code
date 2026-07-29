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

  await options.components.start();
  const address = await operationsServer.start();
  health.markRunning();
  options.logger.info("runtime_started", {
    mode: options.config.mode,
    transactionSending: "disabled",
    operationsHostClass:
      address.host === "127.0.0.1" || address.host === "::1"
        ? "loopback"
        : "non-loopback",
    operationsPort: address.port,
  });

  let stopped = false;
  return {
    health,
    metrics,
    operationsServer,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      health.markStopping();
      await options.components.stop();
      await operationsServer.stop();
      options.logger.info("runtime_stopped", {
        mode: options.config.mode,
        transactionSending: "disabled",
      });
    },
  };
}
