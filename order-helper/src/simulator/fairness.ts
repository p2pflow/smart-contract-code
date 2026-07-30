export const JAIN_SCALE = 1_000_000_000_000n;

export interface ExactJainIndex {
  readonly scaled: bigint;
  readonly scale: bigint;
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export interface VolumeSpread {
  readonly minimum: bigint;
  readonly maximum: bigint;
  readonly difference: bigint;
}

export function exactJainIndex(
  values: readonly bigint[],
  scale: bigint = JAIN_SCALE,
): ExactJainIndex {
  if (values.length === 0 || scale <= 0n) {
    throw new RangeError("Jain index requires values and a positive scale");
  }
  let sum = 0n;
  let sumSquares = 0n;
  for (const value of values) {
    if (value < 0n) {
      throw new RangeError("Fairness values must be non-negative");
    }
    sum += value;
    sumSquares += value * value;
  }
  if (sumSquares === 0n) {
    return {
      scaled: scale,
      scale,
      numerator: 0n,
      denominator: 0n,
    };
  }
  const numerator = sum * sum;
  const denominator = BigInt(values.length) * sumSquares;
  return {
    scaled: (numerator * scale) / denominator,
    scale,
    numerator,
    denominator,
  };
}

export function volumeSpread(values: readonly bigint[]): VolumeSpread {
  if (values.length === 0) {
    throw new RangeError("Volume spread requires at least one value");
  }
  let minimum = values[0];
  let maximum = values[0];
  if (minimum === undefined || maximum === undefined) {
    throw new Error("Volume spread initialization failed");
  }
  for (const value of values.slice(1)) {
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  return {
    minimum,
    maximum,
    difference: maximum - minimum,
  };
}

export function formatScaledInteger(
  value: bigint,
  scale: bigint,
  decimalPlaces: number,
): string {
  if (
    value < 0n ||
    scale <= 0n ||
    !Number.isSafeInteger(decimalPlaces) ||
    decimalPlaces < 0
  ) {
    throw new RangeError("Scaled formatting inputs are outside valid bounds");
  }
  const whole = value / scale;
  if (decimalPlaces === 0) return whole.toString(10);
  const fractionalScale = 10n ** BigInt(decimalPlaces);
  const fractional = ((value % scale) * fractionalScale) / scale;
  return `${whole}.${fractional.toString(10).padStart(decimalPlaces, "0")}`;
}
