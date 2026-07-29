import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import {
  Bytes32,
  OrderSnapshot,
  RankedCandidate,
  SelectionPolicy,
} from "../domain/types";
import { canonicalJson } from "./canonical-json";

export interface DecisionCommitment {
  readonly schema: "p2pflow.assignment-decision.v1";
  readonly chainId: number;
  readonly diamond: string;
  readonly orderId: string;
  readonly round: bigint;
  readonly snapshotBlock: bigint;
  readonly snapshotBlockHash: string;
  readonly validUntil: bigint;
  readonly quoteHash: string;
  readonly policyHash: string;
  readonly helperBuildVersion: string;
  readonly candidates: readonly {
    readonly merchant: string;
    readonly channelId: string;
    readonly rank: number;
    readonly unlockAt: bigint;
    readonly rankingFinish: bigint;
    readonly commitFinish: bigint;
  }[];
}

export function decisionCommitment(
  order: OrderSnapshot,
  policy: SelectionPolicy,
  candidates: readonly RankedCandidate[],
  helperBuildVersion: string,
): DecisionCommitment {
  if (candidates.length !== 4) {
    throw new RangeError("Decision commitments require exactly four candidates");
  }
  return {
    schema: "p2pflow.assignment-decision.v1",
    chainId: order.chainId,
    diamond: order.diamond,
    orderId: order.orderId,
    round: order.round,
    snapshotBlock: order.snapshotBlock,
    snapshotBlockHash: order.snapshotBlockHash,
    validUntil: order.validUntil,
    quoteHash: order.quoteHash,
    policyHash: policy.policyHash,
    helperBuildVersion,
    candidates: candidates.map((candidate) => ({
      merchant: candidate.merchant,
      channelId: candidate.channelId,
      rank: candidate.rank,
      unlockAt: candidate.unlockAt,
      rankingFinish: candidate.rankingFinish,
      commitFinish: candidate.commitFinish,
    })),
  };
}

export function keccakCanonical(value: unknown): Bytes32 {
  const encoded = new TextEncoder().encode(canonicalJson(value));
  return `0x${bytesToHex(keccak_256(encoded))}` as Bytes32;
}

export function computeDecisionId(
  order: OrderSnapshot,
  policy: SelectionPolicy,
  candidates: readonly RankedCandidate[],
  helperBuildVersion: string,
): Bytes32 {
  return keccakCanonical(
    decisionCommitment(order, policy, candidates, helperBuildVersion),
  );
}
