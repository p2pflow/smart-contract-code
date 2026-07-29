import { redact, RedactionOptions } from "./redaction";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogSink {
  write(line: string): unknown;
}

export interface LoggerOptions {
  readonly service: string;
  readonly minimumLevel?: LogLevel;
  readonly sink?: LogSink;
  readonly clock?: () => Date;
  readonly baseFields?: Readonly<Record<string, unknown>>;
  readonly redaction?: RedactionOptions;
}

export interface StructuredLogger {
  debug(
    event: string,
    fields?: Readonly<Record<string, unknown>>,
    message?: string,
  ): void;
  info(
    event: string,
    fields?: Readonly<Record<string, unknown>>,
    message?: string,
  ): void;
  warn(
    event: string,
    fields?: Readonly<Record<string, unknown>>,
    message?: string,
  ): void;
  error(
    event: string,
    fields?: Readonly<Record<string, unknown>>,
    message?: string,
  ): void;
  child(fields: Readonly<Record<string, unknown>>): StructuredLogger;
}

function safeToken(value: string, fallback: string): string {
  return /^[a-zA-Z0-9_.:-]{1,128}$/.test(value) ? value : fallback;
}

class JsonStructuredLogger implements StructuredLogger {
  private readonly service: string;
  private readonly minimumLevel: LogLevel;
  private readonly sink: LogSink;
  private readonly clock: () => Date;
  private readonly baseFields: Readonly<Record<string, unknown>>;
  private readonly redactionOptions: RedactionOptions;

  public constructor(options: LoggerOptions) {
    this.service = safeToken(options.service, "order-helper");
    this.minimumLevel = options.minimumLevel ?? "info";
    this.sink = options.sink ?? process.stdout;
    this.clock = options.clock ?? (() => new Date());
    this.baseFields = options.baseFields ?? {};
    this.redactionOptions = options.redaction ?? {};
  }

  public debug(
    event: string,
    fields: Readonly<Record<string, unknown>> = {},
    message?: string,
  ): void {
    this.emit("debug", event, fields, message);
  }

  public info(
    event: string,
    fields: Readonly<Record<string, unknown>> = {},
    message?: string,
  ): void {
    this.emit("info", event, fields, message);
  }

  public warn(
    event: string,
    fields: Readonly<Record<string, unknown>> = {},
    message?: string,
  ): void {
    this.emit("warn", event, fields, message);
  }

  public error(
    event: string,
    fields: Readonly<Record<string, unknown>> = {},
    message?: string,
  ): void {
    this.emit("error", event, fields, message);
  }

  public child(fields: Readonly<Record<string, unknown>>): StructuredLogger {
    const childOptions: LoggerOptions = {
      service: this.service,
      minimumLevel: this.minimumLevel,
      sink: this.sink,
      clock: this.clock,
      baseFields: { ...this.baseFields, ...fields },
      redaction: this.redactionOptions,
    };
    return new JsonStructuredLogger(childOptions);
  }

  private emit(
    level: LogLevel,
    event: string,
    fields: Readonly<Record<string, unknown>>,
    message: string | undefined,
  ): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minimumLevel]) return;

    const record: Record<string, unknown> = {
      timestamp: this.clock().toISOString(),
      level,
      service: this.service,
      event: safeToken(event, "invalid_event"),
      data: redact(
        { ...this.baseFields, ...fields },
        this.redactionOptions,
      ),
    };
    if (message !== undefined) {
      record.message = redact(message, this.redactionOptions);
    }

    try {
      this.sink.write(`${JSON.stringify(record)}\n`);
    } catch {
      this.sink.write(
        '{"level":"error","service":"order-helper","event":"log_serialization_failed"}\n',
      );
    }
  }
}

export function createLogger(options: LoggerOptions): StructuredLogger {
  return new JsonStructuredLogger(options);
}
