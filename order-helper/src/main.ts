import {
  ConfigurationError,
  loadConfig,
} from "./config";
import { createLogger } from "./operations";
import {
  startRuntime,
  UnconfiguredShadowComponents,
} from "./runtime";

const logger = createLogger({
  service: "p2pflow-order-helper",
  minimumLevel: "info",
});

function httpPort(environment: NodeJS.ProcessEnv): number {
  const raw = environment.HTTP_PORT?.trim() ?? "8080";
  if (!/^\d+$/.test(raw)) {
    throw new ConfigurationError(["HTTP_PORT"]);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 65_535) {
    throw new ConfigurationError(["HTTP_PORT"]);
  }
  return value;
}

function httpHost(environment: NodeJS.ProcessEnv): string {
  const value = environment.HTTP_HOST?.trim() ?? "127.0.0.1";
  if (!/^[a-zA-Z0-9.:[\]-]{1,255}$/.test(value)) {
    throw new ConfigurationError(["HTTP_HOST"]);
  }
  return value;
}

export async function main(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  try {
    const config = loadConfig(environment);
    const runtime = await startRuntime({
      config,
      // Honest placeholder: health starts, but readiness remains failed until
      // verified read-only chain and durable-store adapters are injected.
      components: new UnconfiguredShadowComponents(),
      logger,
      host: httpHost(environment),
      port: httpPort(environment),
    });

    const stop = async (signal: string): Promise<void> => {
      logger.info("shutdown_requested", { signal });
      await runtime.stop();
    };
    process.once("SIGINT", () => {
      void stop("SIGINT");
    });
    process.once("SIGTERM", () => {
      void stop("SIGTERM");
    });
  } catch (error: unknown) {
    if (error instanceof ConfigurationError) {
      logger.error("startup_configuration_invalid", {
        missingOrInvalidNames: error.missingOrInvalidNames,
      });
    } else {
      logger.error("startup_failed", {
        errorCategory: error instanceof Error ? error.name : "UnknownError",
      });
    }
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
