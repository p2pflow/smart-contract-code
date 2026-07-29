const UINT64_MASK = (1n << 64n) - 1n;
const UINT64_RANGE = 1n << 64n;
const SPLITMIX_INCREMENT = 0x9e3779b97f4a7c15n;
const SPLITMIX_MULTIPLIER_ONE = 0xbf58476d1ce4e5b9n;
const SPLITMIX_MULTIPLIER_TWO = 0x94d049bb133111ebn;
const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

export type SimulationSeed = bigint | string;

/**
 * Small deterministic generator for simulations and fixtures.
 *
 * The generator intentionally exposes integer operations only so simulator
 * inputs remain exactly reproducible across runtimes and never depend on
 * Math.random or floating-point rounding.
 */
export class SeededPrng {
  private state: bigint;

  public constructor(seed: SimulationSeed) {
    this.state = normalizeSeed(seed);
  }

  public nextU64(): bigint {
    this.state = (this.state + SPLITMIX_INCREMENT) & UINT64_MASK;
    let mixed = this.state;
    mixed =
      ((mixed ^ (mixed >> 30n)) * SPLITMIX_MULTIPLIER_ONE) & UINT64_MASK;
    mixed =
      ((mixed ^ (mixed >> 27n)) * SPLITMIX_MULTIPLIER_TWO) & UINT64_MASK;
    return (mixed ^ (mixed >> 31n)) & UINT64_MASK;
  }

  public nextBelow(maxExclusive: bigint): bigint {
    if (maxExclusive <= 0n || maxExclusive > UINT64_RANGE) {
      throw new RangeError(
        "maxExclusive must be between 1 and 2^64 inclusive",
      );
    }

    const unbiasedRange = UINT64_RANGE - (UINT64_RANGE % maxExclusive);
    let sample = this.nextU64();
    while (sample >= unbiasedRange) {
      sample = this.nextU64();
    }
    return sample % maxExclusive;
  }

  public chance(numerator: bigint, denominator: bigint): boolean {
    if (denominator <= 0n) {
      throw new RangeError("denominator must be positive");
    }
    if (numerator < 0n || numerator > denominator) {
      throw new RangeError("numerator must be between zero and denominator");
    }
    if (numerator === 0n) return false;
    if (numerator === denominator) return true;
    return this.nextBelow(denominator) < numerator;
  }

  public pick<T>(values: readonly T[]): T {
    if (values.length === 0) {
      throw new RangeError("Cannot pick from an empty collection");
    }
    const index = Number(this.nextBelow(BigInt(values.length)));
    const selected = values[index];
    if (selected === undefined) {
      throw new Error("Deterministic selection produced an invalid index");
    }
    return selected;
  }

  public shuffle<T>(values: readonly T[]): T[] {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Number(this.nextBelow(BigInt(index + 1)));
      const current = shuffled[index];
      const replacement = shuffled[swapIndex];
      if (current === undefined || replacement === undefined) {
        throw new Error("Deterministic shuffle produced an invalid index");
      }
      shuffled[index] = replacement;
      shuffled[swapIndex] = current;
    }
    return shuffled;
  }
}

export function normalizeSeed(seed: SimulationSeed): bigint {
  if (typeof seed === "bigint") return seed & UINT64_MASK;

  const encoded = new TextEncoder().encode(seed.normalize("NFC"));
  let hash = FNV_OFFSET_BASIS;
  for (const byte of encoded) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & UINT64_MASK;
  }
  return hash;
}
