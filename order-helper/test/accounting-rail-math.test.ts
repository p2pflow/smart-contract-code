import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountingFreezeError,
  AccountingInputError,
  MAX_UINT256,
  buyRailCeiling,
  requiredRailCeiling,
  reservationSafeSweep,
  sellRailFloor,
} from "../src/accounting/rail-math";

const OPEN = {
  priceStale: false,
  deficit: false,
  reconciliationRequired: false,
  unresolvedCashTreatment: false,
  migrationIncomplete: false,
} as const;

test("direct rational rounding reproduces the Council undercharge vector", () => {
  const input = {
    usdcAtoms: 1_000n,
    priceMicroFiatPerUsdc: 90_000_001n,
    railQuantumMicroFiat: 10_000n,
  };
  assert.equal(buyRailCeiling(input), 100_000n);
  assert.equal(requiredRailCeiling(input), 100_000n);
  assert.equal(sellRailFloor(input), 90_000n);
});

test("BUY and SELL satisfy exact direct rail bounds", () => {
  const scale = 1_000_000n;
  const quantum = 10_000n;
  for (const usdcAtoms of [999_999n, 1_000_000n, 12_345_678n]) {
    const price = 90_000_001n;
    const buy = buyRailCeiling({
      usdcAtoms,
      priceMicroFiatPerUsdc: price,
      railQuantumMicroFiat: quantum,
    });
    const sell = sellRailFloor({
      usdcAtoms,
      priceMicroFiatPerUsdc: price,
      railQuantumMicroFiat: quantum,
    });
    const rational = usdcAtoms * price;
    assert.ok(buy * scale >= rational);
    assert.ok((buy - quantum) * scale < rational);
    assert.ok(sell * scale <= rational);
    assert.ok((sell + quantum) * scale > rational);
  }
});

test("reservation-aware floor permits at most INR 40 in the locked payout vector", () => {
  const result = reservationSafeSweep({
    fiatPrincipalUsdcAtoms: 10_000_000n,
    reservedPrincipalUsdcAtoms: 10_000_000n,
    reservedFiatMicro: 950_000_000n,
    grossFiatMicro: 1_000_000_000n,
    accountingPriceMicroFiatPerUsdc: 90_000_000n,
    stressPriceMicroFiatPerUsdc: 90_000_000n,
    railQuantumMicroFiat: 10_000n,
    safetyBufferMicroFiat: 10_000_000n,
    freeze: OPEN,
  });
  assert.equal(result.aggregateBackingFloorMicroFiat, 900_000_000n);
  assert.equal(result.reservationBackingFloorMicroFiat, 950_000_000n);
  assert.equal(result.obligationFloorMicroFiat, 950_000_000n);
  assert.equal(result.sweepableMicroFiat, 40_000_000n);
});

test("every governed freeze predicate denies a sweep", () => {
  for (const reason of Object.keys(OPEN) as (keyof typeof OPEN)[]) {
    assert.throws(
      () =>
        reservationSafeSweep({
          fiatPrincipalUsdcAtoms: 10_000_000n,
          reservedPrincipalUsdcAtoms: 0n,
          reservedFiatMicro: 0n,
          grossFiatMicro: 1_000_000_000n,
          accountingPriceMicroFiatPerUsdc: 90_000_000n,
          stressPriceMicroFiatPerUsdc: 90_000_000n,
          railQuantumMicroFiat: 10_000n,
          safetyBufferMicroFiat: 10_000_000n,
          freeze: { ...OPEN, [reason]: true },
        }),
      AccountingFreezeError,
    );
  }
});

test("nonzero SELL values that round to zero are rejected", () => {
  assert.throws(() =>
    sellRailFloor({
      usdcAtoms: 1n,
      priceMicroFiatPerUsdc: 1n,
      railQuantumMicroFiat: 10_000n,
    }),
  );
});

test("exact rail boundary and one micro-fiat below/above use direct bounds", () => {
  const quantum = 10_000n;
  const exact = {
    usdcAtoms: 1_000_000n,
    priceMicroFiatPerUsdc: 90_000_000n,
    railQuantumMicroFiat: quantum,
  };
  assert.equal(buyRailCeiling(exact), 90_000_000n);
  assert.equal(requiredRailCeiling(exact), 90_000_000n);
  assert.equal(sellRailFloor(exact), 90_000_000n);

  const below = { ...exact, priceMicroFiatPerUsdc: 89_999_999n };
  assert.equal(buyRailCeiling(below), 90_000_000n);
  assert.equal(requiredRailCeiling(below), 90_000_000n);
  assert.equal(sellRailFloor(below), 89_990_000n);

  const above = { ...exact, priceMicroFiatPerUsdc: 90_000_001n };
  assert.equal(buyRailCeiling(above), 90_010_000n);
  assert.equal(requiredRailCeiling(above), 90_010_000n);
  assert.equal(sellRailFloor(above), 90_000_000n);
});

test("same-price aligned and unaligned BUY/SELL dust is one rail quantum or less", () => {
  for (const price of [90_000_000n, 90_000_001n]) {
    const input = {
      usdcAtoms: 1_000_000n,
      priceMicroFiatPerUsdc: price,
      railQuantumMicroFiat: 10_000n,
    };
    const dust = buyRailCeiling(input) - sellRailFloor(input);
    assert.ok(dust >= 0n);
    assert.ok(dust <= input.railQuantumMicroFiat);
  }
});

test("rail ceiling is non-additive by one quantum in the two-principal fixture", () => {
  const one = {
    usdcAtoms: 1_000_000n,
    priceMicroFiatPerUsdc: 90_000_001n,
    railQuantumMicroFiat: 10_000n,
  };
  const two = { ...one, usdcAtoms: 2_000_000n };
  assert.equal(
    requiredRailCeiling(one) * 2n - requiredRailCeiling(two),
    10_000n,
  );
});

test("locked payout formula exposes a hard ₹40 cap, below ₹40.01 and ₹41", () => {
  const result = reservationSafeSweep({
    fiatPrincipalUsdcAtoms: 10_000_000n,
    reservedPrincipalUsdcAtoms: 10_000_000n,
    reservedFiatMicro: 950_000_000n,
    grossFiatMicro: 1_000_000_000n,
    accountingPriceMicroFiatPerUsdc: 90_000_000n,
    stressPriceMicroFiatPerUsdc: 90_000_000n,
    railQuantumMicroFiat: 10_000n,
    safetyBufferMicroFiat: 10_000_000n,
    freeze: OPEN,
  });
  assert.equal(result.sweepableMicroFiat, 40_000_000n);
  assert.ok(40_010_000n > result.sweepableMicroFiat);
  assert.ok(41_000_000n > result.sweepableMicroFiat);
});

test("worked ₹95/₹90 cycle leaves only ₹40 sweepable from terminal ₹50 equity", () => {
  const result = reservationSafeSweep({
    fiatPrincipalUsdcAtoms: 0n,
    reservedPrincipalUsdcAtoms: 0n,
    reservedFiatMicro: 0n,
    grossFiatMicro: 50_000_000n,
    accountingPriceMicroFiatPerUsdc: 90_000_000n,
    stressPriceMicroFiatPerUsdc: 90_000_000n,
    railQuantumMicroFiat: 10_000n,
    safetyBufferMicroFiat: 10_000_000n,
    freeze: OPEN,
  });
  assert.equal(result.obligationFloorMicroFiat, 0n);
  assert.equal(result.sweepableMicroFiat, 40_000_000n);
});

test("unreserved ₹90 to ₹92 fixture derives a ₹10 backing deficit and freezes", () => {
  const atNinety = reservationSafeSweep({
    fiatPrincipalUsdcAtoms: 10_000_000n,
    reservedPrincipalUsdcAtoms: 0n,
    reservedFiatMicro: 0n,
    grossFiatMicro: 950_000_000n,
    accountingPriceMicroFiatPerUsdc: 90_000_000n,
    stressPriceMicroFiatPerUsdc: 90_000_000n,
    railQuantumMicroFiat: 10_000n,
    safetyBufferMicroFiat: 10_000_000n,
    freeze: OPEN,
  });
  assert.equal(atNinety.sweepableMicroFiat, 40_000_000n);
  const postSweepGross = 950_000_000n - atNinety.sweepableMicroFiat;
  const backingAtNinetyTwo = requiredRailCeiling({
    usdcAtoms: 10_000_000n,
    priceMicroFiatPerUsdc: 92_000_000n,
    railQuantumMicroFiat: 10_000n,
  });
  assert.equal(backingAtNinetyTwo - postSweepGross, 10_000_000n);
  assert.throws(
    () =>
      reservationSafeSweep({
        fiatPrincipalUsdcAtoms: 10_000_000n,
        reservedPrincipalUsdcAtoms: 0n,
        reservedFiatMicro: 0n,
        grossFiatMicro: postSweepGross,
        accountingPriceMicroFiatPerUsdc: 92_000_000n,
        stressPriceMicroFiatPerUsdc: 92_000_000n,
        railQuantumMicroFiat: 10_000n,
        safetyBufferMicroFiat: 10_000_000n,
        freeze: { ...OPEN, deficit: true },
      }),
    AccountingFreezeError,
  );
});

test("freeze schema rejects missing, extra, and nonboolean predicates", () => {
  const base = {
    fiatPrincipalUsdcAtoms: 1_000_000n,
    reservedPrincipalUsdcAtoms: 0n,
    reservedFiatMicro: 0n,
    grossFiatMicro: 100_000_000n,
    accountingPriceMicroFiatPerUsdc: 90_000_000n,
    stressPriceMicroFiatPerUsdc: 90_000_000n,
    railQuantumMicroFiat: 10_000n,
    safetyBufferMicroFiat: 0n,
  };
  assert.throws(
    () => reservationSafeSweep({ ...base, freeze: {} as typeof OPEN }),
    AccountingInputError,
  );
  assert.throws(
    () =>
      reservationSafeSweep({
        ...base,
        freeze: {
          ...OPEN,
          unexpected: false,
        } as unknown as typeof OPEN,
      }),
    AccountingInputError,
  );
  assert.throws(
    () =>
      reservationSafeSweep({
        ...base,
        freeze: {
          ...OPEN,
          deficit: "false",
        } as unknown as typeof OPEN,
      }),
    AccountingInputError,
  );
});

test("both governed prices and reservation inequalities are fail-closed", () => {
  const base = {
    fiatPrincipalUsdcAtoms: 1n,
    reservedPrincipalUsdcAtoms: 0n,
    reservedFiatMicro: 0n,
    grossFiatMicro: 10n,
    accountingPriceMicroFiatPerUsdc: 1n,
    stressPriceMicroFiatPerUsdc: 1n,
    railQuantumMicroFiat: 1n,
    safetyBufferMicroFiat: 0n,
    freeze: OPEN,
    usdcAtomScale: 1n,
  };
  assert.throws(
    () =>
      reservationSafeSweep({
        ...base,
        accountingPriceMicroFiatPerUsdc: -1n,
      }),
    AccountingInputError,
  );
  assert.throws(
    () =>
      reservationSafeSweep({
        ...base,
        stressPriceMicroFiatPerUsdc: -1n,
      }),
    AccountingInputError,
  );
  assert.throws(
    () =>
      reservationSafeSweep({
        ...base,
        reservedFiatMicro: 11n,
      }),
    AccountingInputError,
  );
});

test("rail outputs and sweep additions reject uint256 overflow", () => {
  assert.throws(
    () =>
      buyRailCeiling({
        usdcAtoms: MAX_UINT256,
        priceMicroFiatPerUsdc: MAX_UINT256,
        railQuantumMicroFiat: 1n,
        usdcAtomScale: 1n,
      }),
    AccountingInputError,
  );
  assert.throws(
    () =>
      reservationSafeSweep({
        fiatPrincipalUsdcAtoms: 1n,
        reservedPrincipalUsdcAtoms: 0n,
        reservedFiatMicro: MAX_UINT256,
        grossFiatMicro: MAX_UINT256,
        accountingPriceMicroFiatPerUsdc: 1n,
        stressPriceMicroFiatPerUsdc: 1n,
        railQuantumMicroFiat: 1n,
        safetyBufferMicroFiat: 0n,
        freeze: OPEN,
        usdcAtomScale: 1n,
      }),
    AccountingInputError,
  );
});
