import {
  CollapsedOperatorCandidate,
  OperatorRoutingSnapshot,
  SelectionHistoryEvent,
  ShadowSelectionPolicy,
} from "./types";
import { compareBigInt } from "./math";

export function isOperatorCooling(
  operator: OperatorRoutingSnapshot,
  history: readonly SelectionHistoryEvent[],
  sequence: bigint,
  policy: ShadowSelectionPolicy,
): boolean {
  const latest = [...history]
    .filter(
      (event) =>
        event.operatorId.toLowerCase() ===
        operator.operatorId.toLowerCase(),
    )
    .sort((left, right) => {
      if (left.sequence < right.sequence) return 1;
      if (left.sequence > right.sequence) return -1;
      return right.eventId.toLowerCase().localeCompare(
        left.eventId.toLowerCase(),
      );
    })[0];
  if (latest === undefined || latest.kind !== "RANK_ZERO_MISSED") {
    return false;
  }
  return sequence - latest.sequence <= policy.nonresponseCooldownSequences;
}

export function rankZeroConcentrationCount(
  operator: OperatorRoutingSnapshot,
  history: readonly SelectionHistoryEvent[],
  sequence: bigint,
  policy: ShadowSelectionPolicy,
): number {
  const window = BigInt(policy.concentrationWindowSequences);
  const lowerBound = sequence > window ? sequence - window : 0n;
  return history.filter(
    (event) =>
      event.operatorId.toLowerCase() === operator.operatorId.toLowerCase() &&
      event.kind === "RANK_ZERO_ASSIGNED" &&
      event.sequence >= lowerBound &&
      event.sequence < sequence,
  ).length;
}

export function compareBaseCandidates(
  left: CollapsedOperatorCandidate,
  right: CollapsedOperatorCandidate,
  policy: ShadowSelectionPolicy,
): number {
  const finish = compareBigInt(left.rankingFinishQ, right.rankingFinishQ);
  if (finish !== 0) return finish;

  const leftConcentrated =
    left.concentrationCount >= policy.maxRankZeroPerOperatorInWindow ? 1 : 0;
  const rightConcentrated =
    right.concentrationCount >= policy.maxRankZeroPerOperatorInWindow ? 1 : 0;
  if (leftConcentrated !== rightConcentrated) {
    return leftConcentrated - rightConcentrated;
  }

  const inventory = compareBigInt(
    left.inventoryImbalanceBps,
    right.inventoryImbalanceBps,
  );
  if (inventory !== 0) return inventory;
  if (
    left.operator.recentFailureTier !== right.operator.recentFailureTier
  ) {
    return (
      left.operator.recentFailureTier - right.operator.recentFailureTier
    );
  }
  const activity = compareNullableTimestamp(
    left.lastAcceptedOrAssignedAt,
    right.lastAcceptedOrAssignedAt,
  );
  if (activity !== 0) return activity;
  return left.deterministicTieBreak.toLowerCase().localeCompare(
    right.deterministicTieBreak.toLowerCase(),
  );
}

export function compareRecoveryCandidates(
  left: CollapsedOperatorCandidate,
  right: CollapsedOperatorCandidate,
  policy: ShadowSelectionPolicy,
): number {
  if (left.cooling !== right.cooling) return left.cooling ? 1 : -1;
  return compareBaseCandidates(left, right, policy);
}

function compareNullableTimestamp(
  left: bigint | null,
  right: bigint | null,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return compareBigInt(left, right);
}
