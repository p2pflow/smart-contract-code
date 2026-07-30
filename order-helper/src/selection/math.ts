import {
  CandidateSnapshot,
  OrderSide,
  SelectionPolicy,
} from "../domain/types";
import {
  OpenOfferSlot,
  OperatorRoutingSnapshot,
  VIRTUAL_FINISH_SCALE,
} from "./types";

const BPS_DENOMINATOR = 10_000n;

export function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

export function compareBigInt(left: bigint, right: bigint): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) {
    throw new RangeError(
      "ceilDiv requires a non-negative numerator and positive denominator",
    );
  }
  return numerator === 0n
    ? 0n
    : ((numerator - 1n) / denominator) + 1n;
}

export function buySafetyBuffer(
  orderUsdc: bigint,
  policy: SelectionPolicy,
): bigint {
  const proportional = ceilDiv(
    orderUsdc * BigInt(policy.buySafetyBufferBps),
    BPS_DENOMINATOR,
  );
  return maxBigInt(proportional, policy.minBuySafetyBufferUsdc);
}

export function baseVirtualFinishQ(
  operator: OperatorRoutingSnapshot,
  domainFloorQ: bigint,
): bigint {
  return maxBigInt(operator.virtualFinishQ ?? domainFloorQ, domainFloorQ);
}

export function liveOfferUsdc(slots: readonly OpenOfferSlot[]): bigint {
  const seen = new Set<string>();
  let total = 0n;
  for (const slot of slots) {
    const key = slot.slotId.toLowerCase();
    if (seen.has(key)) {
      throw new TypeError(`Duplicate live offer slot ${slot.slotId}`);
    }
    seen.add(key);
    if (slot.usdcAmount <= 0n) {
      throw new RangeError("Live offer amounts must be positive");
    }
    total += slot.usdcAmount;
  }
  return total;
}

export function offerLoadQ(
  openOfferUsdc: bigint,
  policy: SelectionPolicy,
): bigint {
  if (
    policy.openOfferWeightNumerator < 0n ||
    policy.openOfferWeightDenominator <= 0n
  ) {
    throw new RangeError("Open-offer weight must be a non-negative ratio");
  }
  return ceilDiv(
    openOfferUsdc *
      VIRTUAL_FINISH_SCALE *
      policy.openOfferWeightNumerator,
    policy.openOfferWeightDenominator,
  );
}

export function rankingFinishQ(
  baseFinishQ: bigint,
  offersQ: bigint,
  orderUsdc: bigint,
): bigint {
  return baseFinishQ + offersQ + (VIRTUAL_FINISH_SCALE * orderUsdc);
}

export function forecastAcceptanceFinishQ(
  baseFinishQ: bigint,
  orderUsdc: bigint,
): bigint {
  return baseFinishQ + (VIRTUAL_FINISH_SCALE * orderUsdc);
}

export function operatorInventoryImbalanceBps(
  side: OrderSide,
  orderUsdc: bigint,
  candidates: readonly CandidateSnapshot[],
  targetFiatShareBps: number,
): bigint {
  let target = 0n;
  let fiatPrincipal = 0n;
  const seenChannels = new Set<string>();

  for (const candidate of candidates) {
    target += candidate.principalTargetUsdc;
    for (const channel of candidate.channels) {
      const channelKey = channel.channelId.toLowerCase();
      if (seenChannels.has(channelKey)) continue;
      seenChannels.add(channelKey);
      fiatPrincipal += channel.fiatPrincipalUsdc;
    }
  }

  if (target <= 0n) {
    throw new RangeError("Operator principal target must be positive");
  }
  const projected =
    side === "BUY"
      ? fiatPrincipal + orderUsdc
      : fiatPrincipal >= orderUsdc
        ? fiatPrincipal - orderUsdc
        : 0n;
  const projectedBps = (projected * BPS_DENOMINATOR) / target;
  const targetBps = BigInt(targetFiatShareBps);
  return projectedBps >= targetBps
    ? projectedBps - targetBps
    : targetBps - projectedBps;
}
