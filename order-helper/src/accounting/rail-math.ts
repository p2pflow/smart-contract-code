export const USDC_ATOM_SCALE = 1_000_000n;
export const MAX_UINT256 = (1n << 256n) - 1n;

export class AccountingInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AccountingInputError";
  }
}

export class AccountingFreezeError extends Error {
  public readonly reasons: readonly string[];

  public constructor(reasons: readonly string[]) {
    super(`Accounting operation is frozen: ${reasons.join(", ")}`);
    this.name = "AccountingFreezeError";
    this.reasons = [...reasons];
  }
}

export interface RailConversionInput {
  readonly usdcAtoms: bigint;
  readonly priceMicroFiatPerUsdc: bigint;
  readonly railQuantumMicroFiat: bigint;
  readonly usdcAtomScale?: bigint;
}

export interface SweepFreezeState {
  readonly priceStale: boolean;
  readonly deficit: boolean;
  readonly reconciliationRequired: boolean;
  readonly unresolvedCashTreatment: boolean;
  readonly migrationIncomplete: boolean;
}

export interface ReservationSafeSweepInput {
  readonly fiatPrincipalUsdcAtoms: bigint;
  readonly reservedPrincipalUsdcAtoms: bigint;
  readonly reservedFiatMicro: bigint;
  readonly grossFiatMicro: bigint;
  readonly accountingPriceMicroFiatPerUsdc: bigint;
  readonly stressPriceMicroFiatPerUsdc: bigint;
  readonly railQuantumMicroFiat: bigint;
  readonly safetyBufferMicroFiat: bigint;
  readonly freeze: SweepFreezeState;
  readonly usdcAtomScale?: bigint;
}

export interface ReservationSafeSweepResult {
  readonly governedPriceMicroFiatPerUsdc: bigint;
  readonly aggregateBackingFloorMicroFiat: bigint;
  readonly reservationBackingFloorMicroFiat: bigint;
  readonly obligationFloorMicroFiat: bigint;
  readonly safetyBufferMicroFiat: bigint;
  readonly sweepableMicroFiat: bigint;
}

function assertUint256(value: bigint, name: string, allowZero: boolean): void {
  if (
    value < 0n ||
    value > MAX_UINT256 ||
    (!allowZero && value === 0n)
  ) {
    throw new AccountingInputError(
      `${name} must be ${allowZero ? "a" : "a positive"} uint256 value`,
    );
  }
}

function checkedAddUint256(
  left: bigint,
  right: bigint,
  name: string,
): bigint {
  const result = left + right;
  if (result > MAX_UINT256) {
    throw new AccountingInputError(`${name} exceeds uint256`);
  }
  return result;
}

function checkedMultiplyUint256(
  left: bigint,
  right: bigint,
  name: string,
): bigint {
  const result = left * right;
  if (result > MAX_UINT256) {
    throw new AccountingInputError(`${name} exceeds uint256`);
  }
  return result;
}

function validateConversion(input: RailConversionInput): {
  readonly numerator: bigint;
  readonly denominator: bigint;
} {
  const scale = input.usdcAtomScale ?? USDC_ATOM_SCALE;
  assertUint256(input.usdcAtoms, "usdcAtoms", true);
  assertUint256(
    input.priceMicroFiatPerUsdc,
    "priceMicroFiatPerUsdc",
    false,
  );
  assertUint256(
    input.railQuantumMicroFiat,
    "railQuantumMicroFiat",
    false,
  );
  assertUint256(scale, "usdcAtomScale", false);
  const numerator = input.usdcAtoms * input.priceMicroFiatPerUsdc;
  const denominator = scale * input.railQuantumMicroFiat;
  if (numerator > MAX_UINT256 * MAX_UINT256) {
    throw new AccountingInputError("conversion numerator exceeds uint512");
  }
  if (denominator > MAX_UINT256) {
    throw new AccountingInputError("conversion denominator exceeds uint256");
  }
  return { numerator, denominator };
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (numerator === 0n) return 0n;
  return (numerator - 1n) / denominator + 1n;
}

export function buyRailCeiling(input: RailConversionInput): bigint {
  const { numerator, denominator } = validateConversion(input);
  return checkedMultiplyUint256(
    input.railQuantumMicroFiat,
    ceilDiv(numerator, denominator),
    "BUY rail result",
  );
}

export function requiredRailCeiling(input: RailConversionInput): bigint {
  return buyRailCeiling(input);
}

export function sellRailFloor(input: RailConversionInput): bigint {
  const { numerator, denominator } = validateConversion(input);
  const result = checkedMultiplyUint256(
    input.railQuantumMicroFiat,
    numerator / denominator,
    "SELL rail result",
  );
  if (input.usdcAtoms > 0n && result === 0n) {
    throw new AccountingInputError("SELL would round to zero rail value");
  }
  return result;
}

export function reservationSafeSweep(
  input: ReservationSafeSweepInput,
): ReservationSafeSweepResult {
  const freezeReasons = validateFreezeState(input.freeze);
  if (freezeReasons.length > 0) {
    throw new AccountingFreezeError(freezeReasons);
  }
  for (const [name, value] of Object.entries({
    fiatPrincipalUsdcAtoms: input.fiatPrincipalUsdcAtoms,
    reservedPrincipalUsdcAtoms: input.reservedPrincipalUsdcAtoms,
    reservedFiatMicro: input.reservedFiatMicro,
    grossFiatMicro: input.grossFiatMicro,
    safetyBufferMicroFiat: input.safetyBufferMicroFiat,
  })) {
    assertUint256(value, name, true);
  }
  if (
    input.reservedPrincipalUsdcAtoms >
    input.fiatPrincipalUsdcAtoms
  ) {
    throw new AccountingInputError(
      "reserved principal exceeds fiat principal",
    );
  }
  if (input.reservedFiatMicro > input.grossFiatMicro) {
    throw new AccountingInputError("reserved fiat exceeds gross fiat");
  }
  assertUint256(
    input.accountingPriceMicroFiatPerUsdc,
    "accountingPriceMicroFiatPerUsdc",
    false,
  );
  assertUint256(
    input.stressPriceMicroFiatPerUsdc,
    "stressPriceMicroFiatPerUsdc",
    false,
  );

  const governedPrice =
    input.accountingPriceMicroFiatPerUsdc >=
    input.stressPriceMicroFiatPerUsdc
      ? input.accountingPriceMicroFiatPerUsdc
      : input.stressPriceMicroFiatPerUsdc;
  const scale = input.usdcAtomScale ?? USDC_ATOM_SCALE;
  const conversionBase = {
    priceMicroFiatPerUsdc: governedPrice,
    railQuantumMicroFiat: input.railQuantumMicroFiat,
    usdcAtomScale: scale,
  };
  const aggregateBackingFloorMicroFiat = requiredRailCeiling({
    ...conversionBase,
    usdcAtoms: input.fiatPrincipalUsdcAtoms,
  });
  const unreservedPrincipal =
    input.fiatPrincipalUsdcAtoms -
    input.reservedPrincipalUsdcAtoms;
  const reservationBackingFloorMicroFiat =
    checkedAddUint256(
      input.reservedFiatMicro,
      requiredRailCeiling({
        ...conversionBase,
        usdcAtoms: unreservedPrincipal,
      }),
      "reservation backing floor",
    );
  const obligationFloorMicroFiat =
    aggregateBackingFloorMicroFiat >= reservationBackingFloorMicroFiat
      ? aggregateBackingFloorMicroFiat
      : reservationBackingFloorMicroFiat;
  const retained = checkedAddUint256(
    obligationFloorMicroFiat,
    input.safetyBufferMicroFiat,
    "retained fiat",
  );
  const sweepableMicroFiat =
    input.grossFiatMicro > retained
      ? input.grossFiatMicro - retained
      : 0n;

  return {
    governedPriceMicroFiatPerUsdc: governedPrice,
    aggregateBackingFloorMicroFiat,
    reservationBackingFloorMicroFiat,
    obligationFloorMicroFiat,
    safetyBufferMicroFiat: input.safetyBufferMicroFiat,
    sweepableMicroFiat,
  };
}

const FREEZE_KEYS = [
  "priceStale",
  "deficit",
  "reconciliationRequired",
  "unresolvedCashTreatment",
  "migrationIncomplete",
] as const;

function validateFreezeState(
  value: SweepFreezeState,
): readonly string[] {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new AccountingInputError(
      "freeze must contain exactly the five governed predicates",
    );
  }
  const record = value as unknown as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== FREEZE_KEYS.length ||
    keys.some((key) => !FREEZE_KEYS.includes(
      key as (typeof FREEZE_KEYS)[number],
    ))
  ) {
    throw new AccountingInputError(
      "freeze must contain exactly the five governed predicates",
    );
  }
  const active: string[] = [];
  for (const key of FREEZE_KEYS) {
    if (typeof record[key] !== "boolean") {
      throw new AccountingInputError(
        `freeze.${key} must be a boolean`,
      );
    }
    if (record[key] === true) active.push(key);
  }
  return active;
}
