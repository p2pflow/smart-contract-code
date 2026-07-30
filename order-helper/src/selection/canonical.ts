import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import { canonicalJson } from "../canonical/canonical-json";
import { Bytes32 } from "../domain/types";
import {
  CanonicalShadowDecisionEnvelope,
} from "./types";

export function hashCanonicalPayloadText(payload: string): Bytes32 {
  return `0x${bytesToHex(
    keccak_256(new TextEncoder().encode(payload)),
  )}` as Bytes32;
}

export function canonicalShadowEnvelope(
  envelope: CanonicalShadowDecisionEnvelope,
): string {
  return canonicalJson(envelope);
}

export function decisionIdForEnvelope(
  envelope: CanonicalShadowDecisionEnvelope,
): Bytes32 {
  return hashCanonicalPayloadText(canonicalShadowEnvelope(envelope));
}

export function verifyCanonicalPayloadText(
  payload: string,
  expectedDigest: Bytes32,
): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
    return false;
  }
  if (canonicalJson(parsed) !== payload) return false;
  return (
    hashCanonicalPayloadText(payload).toLowerCase() ===
    expectedDigest.toLowerCase()
  );
}

export function canonicalMerkleRoot(
  schema: string,
  entries: readonly unknown[],
): Bytes32 {
  if (schema.trim().length === 0) {
    throw new TypeError("Merkle schema must not be empty");
  }
  if (entries.length === 0) {
    return hashCanonicalPayloadText(
      canonicalJson({
        schema: `${schema}.empty`,
        count: 0,
      }),
    );
  }

  let level = entries.map((entry, index) =>
    hashCanonicalPayloadText(
      canonicalJson({
        schema: `${schema}.leaf`,
        index,
        value: entry,
      }),
    )
  );
  while (level.length > 1) {
    const next: Bytes32[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      if (left === undefined || right === undefined) {
        throw new Error("Merkle level construction failed");
      }
      next.push(
        hashCanonicalPayloadText(
          canonicalJson({
            schema: `${schema}.node`,
            left,
            right,
          }),
        ),
      );
    }
    level = next;
  }
  const root = level[0];
  if (root === undefined) {
    throw new Error("Merkle root construction failed");
  }
  return root;
}
