import { describe, expect, it } from "vitest";

import {
  applyBuySpreadE6,
  applySellSpreadE6,
  calculateFiatE6,
  formatE6,
  mulDivCeil,
  mulDivFloor,
  parseE6,
  roundRationalToE6,
  MAX_UINT256,
} from "../src/index.js";

describe("exact E6 arithmetic", () => {
  it("parses and formats without JavaScript numbers", () => {
    expect(parseE6("0")).toBe(0n);
    expect(parseE6("1.000001")).toBe(1_000_001n);
    expect(parseE6("999999999999999999.999999")).toBe(999_999_999_999_999_999_999_999n);
    expect(formatE6(1_230_000n)).toBe("1.23");
    expect(formatE6(1_230_000n, { trim: false })).toBe("1.230000");
    expect(() => parseE6("1.0000001")).toThrow(/at most six/u);
    expect(() => parseE6("1e6")).toThrow(/plain decimal/u);
    expect(() => parseE6("-1")).toThrow(/non-negative/u);
  });

  it("rounds BUY upward and SELL downward at exact boundaries", () => {
    expect(mulDivFloor(10n, 2n, 3n)).toBe(6n);
    expect(mulDivCeil(10n, 2n, 3n)).toBe(7n);
    expect(calculateFiatE6(1n, 1_500_001n, "BUY")).toBe(2n);
    expect(calculateFiatE6(1n, 1_500_001n, "SELL")).toBe(1n);
    expect(calculateFiatE6(2_000_000n, 83_250_000n, "BUY")).toBe(166_500_000n);
  });

  it("applies spreads and rational rounding deterministically", () => {
    expect(applyBuySpreadE6(83_000_001n, 50n)).toBe(83_415_002n);
    expect(applySellSpreadE6(83_000_001n, 50n)).toBe(82_585_000n);
    expect(roundRationalToE6(1n, 3n, "floor")).toBe(333_333n);
    expect(roundRationalToE6(1n, 3n, "ceil")).toBe(333_334n);
    expect(() => applyBuySpreadE6(83_000_001n, -1n)).toThrow(/between 0 and 10000/u);
    expect(() => applySellSpreadE6(83_000_001n, 10_001n)).toThrow(/between 0 and 10000/u);
    expect(() => roundRationalToE6(1n, 3n, "nearest" as never)).toThrow(/floor or ceil/u);
  });

  it("matches uint256 bounds and rejects an overflowing Solidity result", () => {
    expect(mulDivFloor(MAX_UINT256, 1n, 1n)).toBe(MAX_UINT256);
    expect(() => mulDivCeil(MAX_UINT256, 2n, 1n)).toThrow(/uint256/u);
    expect(() => formatE6(MAX_UINT256 + 1n)).toThrow(/uint256/u);
  });
});
