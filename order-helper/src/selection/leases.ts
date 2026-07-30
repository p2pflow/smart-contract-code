import { SelectionPolicy } from "../domain/types";
import {
  LeaseScheduleEntry,
  ShadowSelectionPolicy,
} from "./types";

export class TimingRunwayError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TimingRunwayError";
  }
}

export function validateTimingRunway(
  assignedAt: bigint,
  validUntil: bigint,
  quoteDeadline: bigint,
  policy: SelectionPolicy,
  shadowPolicy: ShadowSelectionPolicy,
): void {
  const leaseStep = asPositiveBigInt(
    policy.leaseStepSeconds,
    "leaseStepSeconds",
  );
  const assignmentTtl = asPositiveBigInt(
    policy.assignmentTtlSeconds,
    "assignmentTtlSeconds",
  );
  const finalWindow = asPositiveBigInt(
    shadowPolicy.minimumFinalAcceptanceWindowSeconds,
    "minimumFinalAcceptanceWindowSeconds",
  );
  if (assignedAt < 0n || validUntil <= assignedAt) {
    throw new TimingRunwayError("Assignment interval must be positive");
  }
  const requiredRunway = (3n * leaseStep) + finalWindow;
  if (validUntil > quoteDeadline) {
    throw new TimingRunwayError(
      "Assignment validity exceeds the quote deadline",
    );
  }
  if (validUntil < assignedAt + requiredRunway) {
    throw new TimingRunwayError(
      "Assignment validity lacks the final acceptance runway",
    );
  }
  if (assignmentTtl < requiredRunway) {
    throw new TimingRunwayError(
      "Assignment TTL lacks the final acceptance runway",
    );
  }
  if (validUntil > assignedAt + assignmentTtl) {
    throw new TimingRunwayError("Assignment validity exceeds its TTL");
  }
}

export function leaseSchedule(
  assignedAt: bigint,
  validUntil: bigint,
  leaseStepSeconds: number,
): readonly LeaseScheduleEntry[] {
  const step = asPositiveBigInt(leaseStepSeconds, "leaseStepSeconds");
  return [
    {
      rank: 0,
      unlockAt: assignedAt,
      intervalEnd: assignedAt + step,
    },
    {
      rank: 1,
      unlockAt: assignedAt + step,
      intervalEnd: assignedAt + (2n * step),
    },
    {
      rank: 2,
      unlockAt: assignedAt + (2n * step),
      intervalEnd: assignedAt + (3n * step),
    },
    {
      rank: 3,
      unlockAt: assignedAt + (3n * step),
      intervalEnd: validUntil,
    },
  ];
}

export function highestUnlockedRankAt(
  timestamp: bigint,
  assignedAt: bigint,
  validUntil: bigint,
  leaseStepSeconds: number,
): 0 | 1 | 2 | 3 | null {
  if (timestamp < assignedAt || timestamp >= validUntil) return null;
  const step = asPositiveBigInt(leaseStepSeconds, "leaseStepSeconds");
  const elapsed = timestamp - assignedAt;
  if (elapsed < step) return 0;
  if (elapsed < 2n * step) return 1;
  if (elapsed < 3n * step) return 2;
  return 3;
}

export function isRankEligibleAt(
  rank: 0 | 1 | 2 | 3,
  timestamp: bigint,
  assignedAt: bigint,
  validUntil: bigint,
  leaseStepSeconds: number,
): boolean {
  const highest = highestUnlockedRankAt(
    timestamp,
    assignedAt,
    validUntil,
    leaseStepSeconds,
  );
  return highest !== null && rank <= highest;
}

function asPositiveBigInt(value: number, name: string): bigint {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return BigInt(value);
}
