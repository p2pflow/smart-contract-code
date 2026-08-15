import { BPS_DENOMINATOR, E6, MAX_UINT256 } from "./constants.js";

export type RoundingMode = "floor" | "ceil";
export type TradeSide = "BUY" | "SELL";

function assertNonNegative(value: bigint, label: string): void {
  if (value < 0n || value > MAX_UINT256) throw new RangeError(`${label} must fit uint256`);
}

function assertSpreadBps(spreadBps: bigint): void {
  if (spreadBps < 0n || spreadBps > BPS_DENOMINATOR) {
    throw new RangeError("spreadBps must be between 0 and 10000");
  }
}

export function parseE6(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u.test(value)) {
    throw new TypeError("E6 input must be a non-negative plain decimal string with at most six fractional digits");
  }
  const [whole = "0", fraction = ""] = value.split(".");
  const parsed = BigInt(whole) * E6 + BigInt(fraction.padEnd(6, "0") || "0");
  assertNonNegative(parsed, "value");
  return parsed;
}

export function formatE6(value: bigint, options: Readonly<{ trim?: boolean }> = {}): string {
  assertNonNegative(value, "value");
  const whole = value / E6;
  const rawFraction = (value % E6).toString().padStart(6, "0");
  const fraction = options.trim === false ? rawFraction : rawFraction.replace(/0+$/u, "");
  return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
}

export function mulDivFloor(multiplicand: bigint, multiplier: bigint, divisor: bigint): bigint {
  assertNonNegative(multiplicand, "multiplicand");
  assertNonNegative(multiplier, "multiplier");
  if (divisor <= 0n) throw new RangeError("divisor must be positive");
  assertNonNegative(divisor, "divisor");
  const result = (multiplicand * multiplier) / divisor;
  assertNonNegative(result, "result");
  return result;
}

export function mulDivCeil(multiplicand: bigint, multiplier: bigint, divisor: bigint): bigint {
  const floor = mulDivFloor(multiplicand, multiplier, divisor);
  const result = (multiplicand * multiplier) % divisor === 0n ? floor : floor + 1n;
  assertNonNegative(result, "result");
  return result;
}

export function calculateFiatE6(usdcAtoms: bigint, priceE6: bigint, side: TradeSide): bigint {
  if (side === "BUY") return mulDivCeil(usdcAtoms, priceE6, E6);
  if (side === "SELL") return mulDivFloor(usdcAtoms, priceE6, E6);
  throw new TypeError("side must be BUY or SELL");
}

export function applyBuySpreadE6(midPriceE6: bigint, spreadBps: bigint): bigint {
  assertSpreadBps(spreadBps);
  return mulDivCeil(midPriceE6, BPS_DENOMINATOR + spreadBps, BPS_DENOMINATOR);
}

export function applySellSpreadE6(midPriceE6: bigint, spreadBps: bigint): bigint {
  assertSpreadBps(spreadBps);
  return mulDivFloor(midPriceE6, BPS_DENOMINATOR - spreadBps, BPS_DENOMINATOR);
}

export function roundRationalToE6(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (mode === "ceil") return mulDivCeil(numerator, E6, denominator);
  if (mode === "floor") return mulDivFloor(numerator, E6, denominator);
  throw new TypeError("rounding mode must be floor or ceil");
}
