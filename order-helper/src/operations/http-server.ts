import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from "node:http";
import { AddressInfo } from "node:net";
import { ServiceHealth } from "./health";
import { MetricsRegistry } from "./metrics";

export interface OperationsServerOptions {
  readonly health: ServiceHealth;
  readonly metrics: MetricsRegistry;
  readonly host?: string;
  readonly port?: number;
}

export interface OperationsServerAddress {
  readonly host: string;
  readonly port: number;
}

interface ResponsePayload {
  readonly statusCode: number;
  readonly contentType: string;
  readonly body: string;
  readonly headers?: Readonly<Record<string, string>>;
}

function jsonPayload(statusCode: number, value: unknown): ResponsePayload {
  return {
    statusCode,
    contentType: "application/json; charset=utf-8",
    body: `${JSON.stringify(value)}\n`,
  };
}

function parsePath(request: IncomingMessage): string | null {
  try {
    return new URL(request.url ?? "/", "http://local.invalid").pathname;
  } catch {
    return null;
  }
}

function writeResponse(
  request: IncomingMessage,
  response: ServerResponse,
  payload: ResponsePayload,
): void {
  response.statusCode = payload.statusCode;
  response.setHeader("Content-Type", payload.contentType);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  if (payload.headers !== undefined) {
    Object.entries(payload.headers).forEach(([name, value]) => {
      response.setHeader(name, value);
    });
  }
  const body = request.method === "HEAD" ? "" : payload.body;
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

export class OperationsHttpServer {
  private readonly health: ServiceHealth;
  private readonly metrics: MetricsRegistry;
  private readonly host: string;
  private readonly port: number;
  private readonly server: Server;
  private running = false;

  public constructor(options: OperationsServerOptions) {
    this.health = options.health;
    this.metrics = options.metrics;
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 0;
    if (
      !Number.isSafeInteger(this.port) ||
      this.port < 0 ||
      this.port > 65_535
    ) {
      throw new RangeError("operations HTTP port is invalid");
    }
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch(() => {
        if (response.headersSent) {
          response.destroy();
          return;
        }
        writeResponse(
          request,
          response,
          jsonPayload(500, {
            status: "fail",
            code: "OPERATIONS_HANDLER_ERROR",
          }),
        );
      });
    });
    this.server.on("clientError", (_error, socket) => {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    });
  }

  public async start(): Promise<OperationsServerAddress> {
    if (this.running) return this.address();
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        this.server.off("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.port, this.host);
    });
    this.running = true;
    return this.address();
  }

  public async stop(): Promise<void> {
    if (!this.running) return;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
      this.server.closeIdleConnections();
    });
    this.running = false;
  }

  public address(): OperationsServerAddress {
    const address = this.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("operations HTTP server is not listening");
    }
    const networkAddress = address as AddressInfo;
    return { host: networkAddress.address, port: networkAddress.port };
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      writeResponse(
        request,
        response,
        {
          ...jsonPayload(405, { status: "fail", code: "METHOD_NOT_ALLOWED" }),
          headers: { Allow: "GET, HEAD" },
        },
      );
      return;
    }

    const path = parsePath(request);
    if (path === null) {
      writeResponse(
        request,
        response,
        jsonPayload(400, { status: "fail", code: "INVALID_REQUEST_TARGET" }),
      );
      return;
    }

    if (path === "/healthz") {
      const health = this.health.liveness();
      writeResponse(
        request,
        response,
        jsonPayload(health.status === "pass" ? 200 : 503, health),
      );
      return;
    }
    if (path === "/readyz") {
      const readiness = await this.health.readiness();
      writeResponse(
        request,
        response,
        jsonPayload(readiness.status === "fail" ? 503 : 200, readiness),
      );
      return;
    }
    if (path === "/metrics") {
      writeResponse(request, response, {
        statusCode: 200,
        contentType: this.metrics.contentType,
        body: this.metrics.render(),
      });
      return;
    }

    writeResponse(
      request,
      response,
      jsonPayload(404, { status: "fail", code: "NOT_FOUND" }),
    );
  }
}
