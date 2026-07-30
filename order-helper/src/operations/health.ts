import { performance } from "node:perf_hooks";

export type HelperRuntimeMode = "shadow" | "live";
export type LifecycleState = "starting" | "running" | "stopping";
export type CheckStatus = "pass" | "degraded" | "fail";

export interface DependencyCheckResult {
  readonly status: CheckStatus;
  readonly code: string;
}

export interface ReadinessCheck {
  readonly name: string;
  readonly required: boolean;
  run(
    signal: AbortSignal,
  ): DependencyCheckResult | Promise<DependencyCheckResult>;
}

export interface CheckSnapshot {
  readonly name: string;
  readonly required: boolean;
  readonly status: CheckStatus;
  readonly code: string;
  readonly latencyMs: number;
}

export interface LivenessSnapshot {
  readonly status: "pass" | "fail";
  readonly lifecycle: LifecycleState;
  readonly mode: HelperRuntimeMode;
  readonly transactionSending: "enabled" | "disabled";
  readonly checkedAt: string;
  readonly uptimeSeconds: number;
}

export interface ReadinessSnapshot {
  readonly status: "pass" | "degraded" | "fail";
  readonly lifecycle: LifecycleState;
  readonly mode: HelperRuntimeMode;
  readonly transactionSending: "enabled" | "disabled";
  readonly checkedAt: string;
  readonly uptimeSeconds: number;
  readonly checks: readonly CheckSnapshot[];
}

export interface ServiceHealthOptions {
  readonly mode: HelperRuntimeMode;
  readonly sendGateEnabled?: boolean;
  readonly checks?: readonly ReadinessCheck[];
  readonly checkTimeoutMs?: number;
  readonly clock?: () => Date;
  readonly monotonicClock?: () => number;
}

class CheckTimeoutError extends Error {
  public constructor() {
    super("readiness check timed out");
    this.name = "CheckTimeoutError";
  }
}

function safeCode(value: string, fallback: string): string {
  return /^[A-Z0-9_.:-]{1,96}$/i.test(value) ? value : fallback;
}

function validateCheck(check: ReadinessCheck): ReadinessCheck {
  if (!/^[a-zA-Z0-9_.:-]{1,96}$/.test(check.name)) {
    throw new TypeError("readiness check name must be a bounded token");
  }
  return check;
}

export class ServiceHealth {
  private readonly mode: HelperRuntimeMode;
  private readonly sendGateEnabled: boolean;
  private readonly checks: readonly ReadinessCheck[];
  private readonly checkTimeoutMs: number;
  private readonly clock: () => Date;
  private readonly monotonicClock: () => number;
  private readonly startedAt: number;
  private lifecycle: LifecycleState = "starting";

  public constructor(options: ServiceHealthOptions) {
    this.mode = options.mode;
    this.sendGateEnabled =
      options.mode === "live" && (options.sendGateEnabled ?? false);
    this.checks = (options.checks ?? []).map(validateCheck);
    if (new Set(this.checks.map((check) => check.name)).size !== this.checks.length) {
      throw new TypeError("readiness check names must be unique");
    }
    this.checkTimeoutMs = options.checkTimeoutMs ?? 5_000;
    if (
      !Number.isSafeInteger(this.checkTimeoutMs) ||
      this.checkTimeoutMs <= 0 ||
      this.checkTimeoutMs > 30_000
    ) {
      throw new RangeError("checkTimeoutMs must be between 1 and 30000");
    }
    this.clock = options.clock ?? (() => new Date());
    this.monotonicClock = options.monotonicClock ?? (() => performance.now());
    this.startedAt = this.monotonicClock();
  }

  public markRunning(): void {
    if (this.lifecycle === "stopping") {
      throw new Error("cannot mark a stopping service as running");
    }
    this.lifecycle = "running";
  }

  public markStopping(): void {
    this.lifecycle = "stopping";
  }

  public liveness(): LivenessSnapshot {
    return {
      status: this.lifecycle === "running" ? "pass" : "fail",
      lifecycle: this.lifecycle,
      mode: this.mode,
      transactionSending: this.sendGateEnabled ? "enabled" : "disabled",
      checkedAt: this.clock().toISOString(),
      uptimeSeconds: this.uptimeSeconds(),
    };
  }

  public async readiness(): Promise<ReadinessSnapshot> {
    const checks = await Promise.all(
      this.checks.map((check) => this.runCheck(check)),
    );
    if (this.checks.length === 0) {
      checks.push({
        name: "readiness_configuration",
        required: true,
        status: "fail",
        code: "NO_READINESS_CHECKS",
        latencyMs: 0,
      });
    }

    if (this.mode === "live" && !this.sendGateEnabled) {
      checks.push({
        name: "transaction_send_gate",
        required: true,
        status: "fail",
        code: "SEND_GATE_CLOSED",
        latencyMs: 0,
      });
    }

    const requiredFailure = checks.some(
      (check) => check.required && check.status === "fail",
    );
    const degraded = checks.some(
      (check) =>
        check.status === "degraded" ||
        (!check.required && check.status === "fail"),
    );
    const status =
      this.lifecycle !== "running" || requiredFailure
        ? "fail"
        : degraded
          ? "degraded"
          : "pass";

    return {
      status,
      lifecycle: this.lifecycle,
      mode: this.mode,
      transactionSending: this.sendGateEnabled ? "enabled" : "disabled",
      checkedAt: this.clock().toISOString(),
      uptimeSeconds: this.uptimeSeconds(),
      checks,
    };
  }

  private uptimeSeconds(): number {
    return Math.max(
      0,
      Math.floor((this.monotonicClock() - this.startedAt) / 1_000),
    );
  }

  private async runCheck(check: ReadinessCheck): Promise<CheckSnapshot> {
    const startedAt = this.monotonicClock();
    const controller = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve(check.run(controller.signal)),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new CheckTimeoutError());
          }, this.checkTimeoutMs);
        }),
      ]);
      const status: CheckStatus =
        result.status === "pass" ||
        result.status === "degraded" ||
        result.status === "fail"
          ? result.status
          : "fail";
      return {
        name: check.name,
        required: check.required,
        status,
        code: safeCode(result.code, "INVALID_CHECK_CODE"),
        latencyMs: Math.max(
          0,
          Math.round(this.monotonicClock() - startedAt),
        ),
      };
    } catch (error: unknown) {
      return {
        name: check.name,
        required: check.required,
        status: "fail",
        code:
          error instanceof CheckTimeoutError
            ? "TIMEOUT"
            : "CHECK_ERROR",
        latencyMs: Math.max(
          0,
          Math.round(this.monotonicClock() - startedAt),
        ),
      };
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}
