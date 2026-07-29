import { isIP } from "node:net";

export const REDACTED = "[REDACTED]";
export const REDACTED_PII = "[REDACTED_PII]";

const CIRCULAR = "[CIRCULAR]";
const MAX_DEPTH = "[MAX_DEPTH]";
const UNAVAILABLE = "[UNAVAILABLE]";

const SECRET_KEY_MARKERS = [
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "password",
  "passwd",
  "passphrase",
  "secret",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "bearertoken",
  "clientsecret",
  "privatekey",
  "mnemonic",
  "seedphrase",
  "rawtransaction",
  "signature",
  "credential",
  "kmskeyreference",
] as const;

const PII_KEY_MARKERS = [
  "accountnumber",
  "bankaccount",
  "routingnumber",
  "beneficiary",
  "iban",
  "swift",
  "upi",
  "vpa",
  "email",
  "phone",
  "telegram",
  "username",
  "firstname",
  "lastname",
  "fullname",
  "paymentdetails",
  "paymentchannel",
] as const;

export type EndpointNetworkClass =
  | "loopback"
  | "private-ip"
  | "link-local"
  | "private-dns"
  | "public-ip"
  | "public-dns"
  | "unix"
  | "invalid";

export interface EndpointSummary {
  readonly transport: string;
  readonly networkClass: EndpointNetworkClass;
  readonly credentials: "present" | "absent";
  readonly query: "present" | "absent";
  readonly fragment: "present" | "absent";
  readonly path: "present" | "absent";
}

export interface RedactionOptions {
  readonly maxDepth?: number;
  readonly maxArrayLength?: number;
  readonly maxStringLength?: number;
}

interface ResolvedRedactionOptions {
  readonly maxDepth: number;
  readonly maxArrayLength: number;
  readonly maxStringLength: number;
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function hasMarker(key: string, markers: readonly string[]): boolean {
  const normalized = normalizeKey(key);
  return markers.some((marker) => normalized.includes(marker));
}

function isEndpointKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (
    normalized === "endpointclass" ||
    normalized === "endpointkind" ||
    normalized === "networkclass"
  ) {
    return false;
  }
  return (
    normalized.endsWith("url") ||
    normalized.endsWith("uri") ||
    normalized.endsWith("dsn") ||
    normalized.includes("endpoint")
  );
}

function classifyIpv4(hostname: string): EndpointNetworkClass {
  const octets = hostname.split(".").map(Number);
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  if (first === 127) return "loopback";
  if (first === 10) return "private-ip";
  if (first === 192 && second === 168) return "private-ip";
  if (first === 172 && second >= 16 && second <= 31) return "private-ip";
  if (first === 169 && second === 254) return "link-local";
  return "public-ip";
}

function classifyHostname(hostname: string): EndpointNetworkClass {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return "loopback";
  const family = isIP(normalized);
  if (family === 4) return classifyIpv4(normalized);
  if (family === 6) {
    if (/^fe[89ab]/.test(normalized)) {
      return "link-local";
    }
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
      return "private-ip";
    }
    return "public-ip";
  }
  if (
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".cluster.local")
  ) {
    return "private-dns";
  }
  return normalized.length > 0 ? "public-dns" : "invalid";
}

export function sanitizeEndpoint(value: unknown): EndpointSummary {
  try {
    const url = value instanceof URL ? new URL(value.href) : new URL(String(value));
    const transport = url.protocol.replace(/:$/, "").toLowerCase() || "unknown";
    const networkClass =
      transport === "unix" ? "unix" : classifyHostname(url.hostname);
    return {
      transport,
      networkClass,
      credentials:
        url.username.length > 0 || url.password.length > 0
          ? "present"
          : "absent",
      query: url.search.length > 0 ? "present" : "absent",
      fragment: url.hash.length > 0 ? "present" : "absent",
      path:
        url.pathname.length > 0 && url.pathname !== "/" ? "present" : "absent",
    };
  } catch {
    return {
      transport: "unknown",
      networkClass: "invalid",
      credentials: "absent",
      query: "absent",
      fragment: "absent",
      path: "absent",
    };
  }
}

function endpointSummaryText(value: string): string {
  const summary = sanitizeEndpoint(value);
  return `<endpoint:${summary.transport}/${summary.networkClass}>`;
}

function sanitizeString(value: string, maxLength: number): string {
  let result = value
    .replace(/\b(Bearer|Basic)\s+\S+/gi, `$1 ${REDACTED}`)
    .replace(
      /-----BEGIN[\s\S]*?PRIVATE KEY-----[\s\S]*?-----END[\s\S]*?PRIVATE KEY-----/gi,
      REDACTED,
    )
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|signature)=)[^&\s]+/gi,
      `$1${REDACTED}`,
    )
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      REDACTED_PII,
    )
    .replace(
      /\b(?:https?|wss?|postgres(?:ql)?|redis):\/\/[^\s,;]+/gi,
      (endpoint) => endpointSummaryText(endpoint),
    );

  if (result.length > maxLength) {
    result = `${result.slice(0, maxLength)}...[TRUNCATED]`;
  }
  return result;
}

function safePropertyName(key: string, index: number): string {
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(key)) {
    return `redacted_key_${index}`;
  }
  return key;
}

function redactValue(
  value: unknown,
  keyHint: string | undefined,
  depth: number,
  seen: WeakSet<object>,
  options: ResolvedRedactionOptions,
): unknown {
  if (keyHint !== undefined && hasMarker(keyHint, SECRET_KEY_MARKERS)) {
    return REDACTED;
  }
  if (keyHint !== undefined && hasMarker(keyHint, PII_KEY_MARKERS)) {
    return REDACTED_PII;
  }
  if (keyHint !== undefined && isEndpointKey(keyHint)) {
    return sanitizeEndpoint(value);
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "string") {
    return sanitizeString(value, options.maxStringLength);
  }
  if (typeof value === "undefined") return "[UNDEFINED]";
  if (typeof value === "symbol") return "[SYMBOL]";
  if (typeof value === "function") return "[FUNCTION]";

  if (depth >= options.maxDepth) return MAX_DEPTH;
  if (seen.has(value)) return CIRCULAR;
  seen.add(value);

  if (value instanceof URL) return sanitizeEndpoint(value);
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  }
  if (value instanceof Error) {
    const errorRecord: Record<string, unknown> = {
      name: sanitizeString(value.name, 128),
      message: sanitizeString(value.message, options.maxStringLength),
    };
    if (value.stack) {
      errorRecord.stack = sanitizeString(value.stack, options.maxStringLength);
    }
    if (value.cause !== undefined) {
      errorRecord.cause = redactValue(
        value.cause,
        "cause",
        depth + 1,
        seen,
        options,
      );
    }
    return errorRecord;
  }
  if (value instanceof Map) {
    return { type: "Map", size: value.size, contents: REDACTED };
  }
  if (value instanceof Set) {
    const setValues = [...value].slice(0, options.maxArrayLength);
    return {
      type: "Set",
      values: setValues.map((entry) =>
        redactValue(entry, undefined, depth + 1, seen, options),
      ),
      truncated: value.size > setValues.length,
    };
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return {
      type: value.constructor.name,
      byteLength: value.byteLength,
      contents: REDACTED,
    };
  }
  if (Array.isArray(value)) {
    const entries = value.slice(0, options.maxArrayLength).map((entry) =>
      redactValue(entry, undefined, depth + 1, seen, options),
    );
    if (value.length > entries.length) {
      entries.push(`[${value.length - entries.length} ITEMS OMITTED]`);
    }
    return entries;
  }

  const result: Record<string, unknown> = {};
  Object.keys(value).forEach((key, index) => {
    const outputKey = safePropertyName(key, index);
    try {
      const record = value as Record<string, unknown>;
      result[outputKey] = redactValue(
        record[key],
        key,
        depth + 1,
        seen,
        options,
      );
    } catch {
      result[outputKey] = UNAVAILABLE;
    }
  });
  return result;
}

export function redact(
  value: unknown,
  options: RedactionOptions = {},
): unknown {
  const resolved: ResolvedRedactionOptions = {
    maxDepth: options.maxDepth ?? 8,
    maxArrayLength: options.maxArrayLength ?? 100,
    maxStringLength: options.maxStringLength ?? 4_096,
  };
  return redactValue(value, undefined, 0, new WeakSet<object>(), resolved);
}
