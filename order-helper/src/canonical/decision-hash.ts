import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import { Bytes32 } from "../domain/types";
import { canonicalJson } from "./canonical-json";

/**
 * Generic Keccak helper retained for canonical-JSON test vectors. Selection
 * decisions must use the v2 shadow envelope and content-addressed witness in
 * `src/selection`; this module deliberately exposes no decision constructor.
 */
export function keccakCanonical(value: unknown): Bytes32 {
  const encoded = new TextEncoder().encode(canonicalJson(value));
  return `0x${bytesToHex(keccak_256(encoded))}` as Bytes32;
}
