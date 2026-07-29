import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalJson,
  toCanonicalValue,
} from "../src/canonical/canonical-json";
import { keccakCanonical } from "../src/canonical/decision-hash";

test("canonical JSON sorts keys, decimalizes integers, and normalizes hex", () => {
  const value = {
    zebra: 5n,
    address: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
    nested: {
      z: 2,
      a: "e\u0301",
    },
  };
  assert.equal(
    canonicalJson(value),
    '{"address":"0xabcdefabcdefabcdefabcdefabcdefabcdefabcd","nested":{"a":"é","z":"2"},"zebra":"5"}',
  );
});

test("canonical conversion rejects floating point values", () => {
  assert.throws(() => toCanonicalValue({ unsafe: 1.5 }), TypeError);
});

test("Keccak implementation matches the Ethereum empty-input vector", () => {
  assert.equal(
    keccakCanonical(""),
    "0x2392a80f8a87b8cfde0aa5c84e199f163aae4c2a4c512d37598362ace687ad0c",
  );
});
