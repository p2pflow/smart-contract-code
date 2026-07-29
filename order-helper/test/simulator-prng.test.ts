import assert from "node:assert/strict";
import test from "node:test";
import {
  SeededPrng,
  normalizeSeed,
} from "../src/simulator/prng";

test("seeded PRNG has a stable integer golden vector", () => {
  const generator = new SeededPrng(0n);
  assert.deepEqual(
    Array.from({ length: 5 }, () => generator.nextU64()),
    [
      0xe220a8397b1dcdafn,
      0x6e789e6aa1b965f4n,
      0x06c45d188009454fn,
      0xf88bb8a8724c81ecn,
      0x1b39896a51a8749bn,
    ],
  );
});

test("string seeds normalize reproducibly and distinguish values", () => {
  assert.equal(normalizeSeed("fairness-seed"), normalizeSeed("fairness-seed"));
  assert.notEqual(normalizeSeed("fairness-seed"), normalizeSeed("other-seed"));
  assert.equal(normalizeSeed("e\u0301"), normalizeSeed("\u00e9"));
});

test("bounded draws, chance, pick, and shuffle are deterministic", () => {
  const left = new SeededPrng("bounded");
  const right = new SeededPrng("bounded");
  const leftDraws = Array.from({ length: 128 }, () => left.nextBelow(7n));
  const rightDraws = Array.from({ length: 128 }, () => right.nextBelow(7n));

  assert.deepEqual(leftDraws, rightDraws);
  assert.ok(leftDraws.every((draw) => draw >= 0n && draw < 7n));
  assert.equal(left.chance(0n, 10n), false);
  assert.equal(left.chance(10n, 10n), true);
  assert.deepEqual(
    new SeededPrng("shuffle").shuffle(["a", "b", "c", "d"]),
    new SeededPrng("shuffle").shuffle(["a", "b", "c", "d"]),
  );
  assert.equal(
    new SeededPrng("pick").pick(["a", "b", "c"]),
    new SeededPrng("pick").pick(["a", "b", "c"]),
  );
});

test("invalid integer bounds and probabilities fail closed", () => {
  const generator = new SeededPrng(1n);
  assert.throws(() => generator.nextBelow(0n), RangeError);
  assert.throws(() => generator.nextBelow((1n << 64n) + 1n), RangeError);
  assert.throws(() => generator.chance(-1n, 2n), RangeError);
  assert.throws(() => generator.chance(3n, 2n), RangeError);
  assert.throws(() => generator.chance(0n, 0n), RangeError);
  assert.throws(() => generator.pick([]), RangeError);
});
