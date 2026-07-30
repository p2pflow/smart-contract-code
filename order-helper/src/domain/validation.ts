import type { EligibilityCode } from "./types";

export const ELIGIBILITY_CODES: readonly EligibilityCode[] = [
  "ELIGIBLE",
  "SNAPSHOT_BLOCK_MISMATCH",
  "ORDER_NOT_OPEN",
  "WRONG_ROUND",
  "MERCHANT_NOT_REGISTERED",
  "ACCOUNT_NOT_ACTIVE",
  "MERCHANT_OFFLINE",
  "UNSTAKE_PENDING",
  "REMOVAL_PENDING",
  "NOT_ALLOWLISTED",
  "CHANNEL_NOT_OWNED",
  "CHANNEL_NOT_APPROVED",
  "CHANNEL_INACTIVE",
  "CHANNEL_WRONG_DOMAIN",
  "QUOTE_EXPIRED",
  "DAILY_LIMIT_EXCEEDED",
  "MONTHLY_LIMIT_EXCEEDED",
  "TOO_MANY_OPEN_OFFERS",
  "TOO_MANY_ACTIVE_ORDERS",
  "INSUFFICIENT_USDC",
  "INSUFFICIENT_FIAT_PRINCIPAL",
  "INSUFFICIENT_PHYSICAL_FIAT",
  "PROTOCOL_FIAT_DEFICIT",
  "RECONCILIATION_REQUIRED",
  "MISSING_RISK_CONFIGURATION",
  "AUTHORITATIVE_CHECK_UNAVAILABLE",
] as const;

const ELIGIBILITY_CODE_SET: ReadonlySet<string> =
  new Set(ELIGIBILITY_CODES);

export function isEligibilityCode(value: unknown): value is EligibilityCode {
  return typeof value === "string" && ELIGIBILITY_CODE_SET.has(value);
}

export function isCanonicalCurrencyCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Z]{3}$/.test(value) &&
    value.normalize("NFC") === value
  );
}

export function isCanonicalRailGroup(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?=.{2,32}$)(?=.*[A-Z])[A-Z][A-Z0-9_]*$/.test(value) &&
    value.normalize("NFC") === value
  );
}

export function isCanonicalVersionIdentifier(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    /^(?=.{3,96}$)(?=.*[a-z])(?=.*[0-9])[a-z0-9]+(?:[._+-][a-z0-9]+)*$/.test(
      value,
    ) &&
    value.normalize("NFC") === value
  );
}
