import { Address, Bytes32 } from "../domain/types";

type CanonicalPrimitive = boolean | null | string;
export type CanonicalValue =
  | CanonicalPrimitive
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

function normalizeString(value: string): string {
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return value.toLowerCase() as Address;
  }
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) {
    return value.toLowerCase() as Bytes32;
  }
  return value.normalize("NFC");
}

export function toCanonicalValue(value: unknown): CanonicalValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return normalizeString(value);
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("Canonical numbers must be safe integers");
    }
    return value.toString(10);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toCanonicalValue(entry));
  }
  if (typeof value === "object" && value !== null) {
    const source = value as Readonly<Record<string, unknown>>;
    const result: Record<string, CanonicalValue> = {};
    for (const key of Object.keys(source).sort()) {
      const entry = source[key];
      if (entry !== undefined) result[key] = toCanonicalValue(entry);
    }
    return result;
  }
  throw new TypeError(`Unsupported canonical value type: ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(toCanonicalValue(value));
}
