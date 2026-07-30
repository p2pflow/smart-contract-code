import {
  AuthoritativeEligibilityAdapter,
  CandidateSnapshot,
  ChannelSnapshot,
  EligibilityCode,
  EligibilityResult,
  OrderSnapshot,
  SelectionPolicy,
} from "../domain/types";
import {
  buySafetyBuffer,
} from "./math";
import {
  ShadowSelectionPolicy,
} from "./types";

export interface OperatorEligibilityContext {
  readonly openOfferCount: number;
  readonly activeAcceptedOrders: number;
  readonly maxActiveAcceptedOrders: number;
}

export function evaluateSnapshotEligibility(
  order: OrderSnapshot,
  candidate: CandidateSnapshot,
  channel: ChannelSnapshot,
  policy: SelectionPolicy,
  shadowPolicy: ShadowSelectionPolicy,
  operator: OperatorEligibilityContext,
): EligibilityResult {
  const checkedAtBlock = order.snapshotBlock;
  if (
    candidate.observedAtBlock !== order.snapshotBlock ||
    candidate.observedAtBlockHash.toLowerCase() !==
      order.snapshotBlockHash.toLowerCase()
  ) {
    return result(
      "SNAPSHOT_BLOCK_MISMATCH",
      0n,
      0n,
      checkedAtBlock,
    );
  }
  if (candidate.merchant.toLowerCase() === order.user.toLowerCase()) {
    return result(
      "ACCOUNT_NOT_ACTIVE",
      0n,
      0n,
      checkedAtBlock,
      "Order user cannot route to the same wallet",
    );
  }
  if (!candidate.registered) {
    return result(
      "MERCHANT_NOT_REGISTERED",
      0n,
      0n,
      checkedAtBlock,
    );
  }
  if (candidate.accountStatus !== "ACTIVE") {
    return result("ACCOUNT_NOT_ACTIVE", 0n, 0n, checkedAtBlock);
  }
  if (candidate.availability !== "ONLINE") {
    return result("MERCHANT_OFFLINE", 0n, 0n, checkedAtBlock);
  }
  if (candidate.unstakePending) {
    return result("UNSTAKE_PENDING", 0n, 0n, checkedAtBlock);
  }
  if (candidate.pendingRemoval) {
    return result("REMOVAL_PENDING", 0n, 0n, checkedAtBlock);
  }
  if (candidate.allowlistEnabled && !candidate.allowlisted) {
    return result("NOT_ALLOWLISTED", 0n, 0n, checkedAtBlock);
  }
  if (candidate.principalTargetUsdc < policy.minMerchantStakeUsdc) {
    return result(
      "ACCOUNT_NOT_ACTIVE",
      policy.minMerchantStakeUsdc,
      candidate.principalTargetUsdc,
      checkedAtBlock,
      "Operator principal is below the explicit fixture threshold",
    );
  }
  if (operator.openOfferCount >= policy.maxPendingOffersPerMerchant) {
    return result(
      "TOO_MANY_OPEN_OFFERS",
      BigInt(policy.maxPendingOffersPerMerchant),
      BigInt(operator.openOfferCount),
      checkedAtBlock,
    );
  }
  if (
    operator.maxActiveAcceptedOrders <= 0 ||
    !Number.isSafeInteger(operator.maxActiveAcceptedOrders)
  ) {
    return result(
      "MISSING_RISK_CONFIGURATION",
      1n,
      BigInt(operator.maxActiveAcceptedOrders),
      checkedAtBlock,
    );
  }
  if (
    operator.activeAcceptedOrders >= operator.maxActiveAcceptedOrders
  ) {
    return result(
      "TOO_MANY_ACTIVE_ORDERS",
      BigInt(operator.maxActiveAcceptedOrders),
      BigInt(operator.activeAcceptedOrders),
      checkedAtBlock,
    );
  }
  if (channel.merchant.toLowerCase() !== candidate.merchant.toLowerCase()) {
    return result("CHANNEL_NOT_OWNED", 0n, 0n, checkedAtBlock);
  }
  if (channel.status !== "APPROVED") {
    return result("CHANNEL_NOT_APPROVED", 0n, 0n, checkedAtBlock);
  }
  if (channel.availability !== "ACTIVE") {
    return result("CHANNEL_INACTIVE", 0n, 0n, checkedAtBlock);
  }
  if (
    channel.fiatCurrency !== order.domain.fiatCurrency ||
    channel.paymentRailGroup !== order.domain.paymentRailGroup
  ) {
    return result("CHANNEL_WRONG_DOMAIN", 0n, 0n, checkedAtBlock);
  }
  if (channel.reconciliationRequired) {
    return result(
      "RECONCILIATION_REQUIRED",
      0n,
      0n,
      checkedAtBlock,
    );
  }
  if (channel.protocolFiatDeficit > 0n) {
    return result(
      "PROTOCOL_FIAT_DEFICIT",
      0n,
      channel.protocolFiatDeficit,
      checkedAtBlock,
    );
  }

  const daily = projectedLimitResult(
    "DAILY_LIMIT_EXCEEDED",
    channel.dailyVolumeUsedUsdc,
    channel.dailyLimitUsdc,
    order.usdcAmount,
    shadowPolicy.allowUnlimitedChannelLimits,
    checkedAtBlock,
  );
  if (daily !== null) return daily;
  const monthly = projectedLimitResult(
    "MONTHLY_LIMIT_EXCEEDED",
    channel.monthlyVolumeUsedUsdc,
    channel.monthlyLimitUsdc,
    order.usdcAmount,
    shadowPolicy.allowUnlimitedChannelLimits,
    checkedAtBlock,
  );
  if (monthly !== null) return monthly;

  if (order.side === "BUY") {
    const unavailable =
      candidate.reservedUsdc + candidate.riskUsdc >=
      candidate.usdcLiquidity
        ? 0n
        : candidate.usdcLiquidity -
          candidate.reservedUsdc -
          candidate.riskUsdc;
    const required = order.usdcAmount + buySafetyBuffer(
      order.usdcAmount,
      policy,
    );
    return unavailable < required
      ? result(
          "INSUFFICIENT_USDC",
          required,
          unavailable,
          checkedAtBlock,
        )
      : result("ELIGIBLE", required, unavailable, checkedAtBlock);
  }

  const availablePrincipal =
    channel.reservedPrincipalUsdc >= channel.fiatPrincipalUsdc
      ? 0n
      : channel.fiatPrincipalUsdc - channel.reservedPrincipalUsdc;
  if (availablePrincipal < order.usdcAmount) {
    return result(
      "INSUFFICIENT_FIAT_PRINCIPAL",
      order.usdcAmount,
      availablePrincipal,
      checkedAtBlock,
    );
  }
  const availableFiat =
    channel.reservedFiat >= channel.grossFiat
      ? 0n
      : channel.grossFiat - channel.reservedFiat;
  if (availableFiat < order.fiatAmount) {
    return result(
      "INSUFFICIENT_PHYSICAL_FIAT",
      order.fiatAmount,
      availableFiat,
      checkedAtBlock,
    );
  }
  return result(
    "ELIGIBLE",
    order.fiatAmount,
    availableFiat,
    checkedAtBlock,
  );
}

export async function checkAuthoritativeEligibility(
  adapter: AuthoritativeEligibilityAdapter,
  order: OrderSnapshot,
  merchant: CandidateSnapshot["merchant"],
  channelId: ChannelSnapshot["channelId"],
  minimumRequired: bigint,
): Promise<EligibilityResult> {
  if (minimumRequired <= 0n) {
    return result(
      "AUTHORITATIVE_CHECK_UNAVAILABLE",
      0n,
      0n,
      order.snapshotBlock,
      "Local eligibility requirement is not positive",
    );
  }
  let checked: EligibilityResult | null;
  try {
    checked = decodeEligibilityResult(
      await adapter.check({
        order,
        merchant,
        channelId,
        minimumRequired,
      }),
    );
  } catch {
    return result(
      "AUTHORITATIVE_CHECK_UNAVAILABLE",
      0n,
      0n,
      order.snapshotBlock,
      "Eligibility adapter did not return a result",
    );
  }
  if (checked === null) {
    return result(
      "AUTHORITATIVE_CHECK_UNAVAILABLE",
      0n,
      0n,
      order.snapshotBlock,
      "Eligibility adapter returned malformed evidence",
    );
  }
  if (checked.checkedAtBlock !== order.snapshotBlock) {
    return result(
      "SNAPSHOT_BLOCK_MISMATCH",
      order.snapshotBlock,
      checked.checkedAtBlock,
      order.snapshotBlock,
    );
  }
  if (
    checked.code === "ELIGIBLE" &&
    (
      checked.required <= 0n ||
      checked.required < minimumRequired ||
      checked.available < checked.required
    )
  ) {
    return result(
      "AUTHORITATIVE_CHECK_UNAVAILABLE",
      0n,
      0n,
      order.snapshotBlock,
      "Eligibility adapter returned contradictory ELIGIBLE evidence",
    );
  }
  return checked;
}

const ELIGIBILITY_CODES: ReadonlySet<string> = new Set<EligibilityCode>([
  "ELIGIBLE",
  "SNAPSHOT_BLOCK_MISMATCH",
  "ORDER_NOT_OPEN",
  "WRONG_ROUND",
  "MERCHANT_NOT_REGISTERED",
  "ACCOUNT_NOT_ACTIVE",
  "MERCHANT_OFFLINE",
  "UNSTAKE_PENDING",
  "REMOVAL_PENDING",
  "NOT_ALLOWLISTED",
  "CHANNEL_NOT_OWNED",
  "CHANNEL_NOT_APPROVED",
  "CHANNEL_INACTIVE",
  "CHANNEL_WRONG_DOMAIN",
  "QUOTE_EXPIRED",
  "DAILY_LIMIT_EXCEEDED",
  "MONTHLY_LIMIT_EXCEEDED",
  "TOO_MANY_OPEN_OFFERS",
  "TOO_MANY_ACTIVE_ORDERS",
  "INSUFFICIENT_USDC",
  "INSUFFICIENT_FIAT_PRINCIPAL",
  "INSUFFICIENT_PHYSICAL_FIAT",
  "PROTOCOL_FIAT_DEFICIT",
  "RECONCILIATION_REQUIRED",
  "MISSING_RISK_CONFIGURATION",
  "AUTHORITATIVE_CHECK_UNAVAILABLE",
]);

function decodeEligibilityResult(value: unknown): EligibilityResult | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.code !== "string" ||
    !ELIGIBILITY_CODES.has(candidate.code) ||
    typeof candidate.required !== "bigint" ||
    candidate.required < 0n ||
    typeof candidate.available !== "bigint" ||
    candidate.available < 0n ||
    (
      candidate.source !== "snapshot" &&
      candidate.source !== "contract"
    ) ||
    typeof candidate.checkedAtBlock !== "bigint" ||
    candidate.checkedAtBlock < 0n ||
    (
      candidate.detail !== undefined &&
      typeof candidate.detail !== "string"
    )
  ) {
    return null;
  }
  const decoded: EligibilityResult = {
    code: candidate.code as EligibilityCode,
    required: candidate.required,
    available: candidate.available,
    source: candidate.source,
    checkedAtBlock: candidate.checkedAtBlock,
  };
  // Adapter prose is intentionally discarded. Only typed evidence crosses
  // into selection output so a provider cannot inject PII into a trace.
  return decoded;
}

function projectedLimitResult(
  code: "DAILY_LIMIT_EXCEEDED" | "MONTHLY_LIMIT_EXCEEDED",
  used: bigint,
  limit: bigint | null,
  orderUsdc: bigint,
  allowUnlimited: boolean,
  checkedAtBlock: bigint,
): EligibilityResult | null {
  if (limit === null) {
    return allowUnlimited
      ? null
      : result(
          "MISSING_RISK_CONFIGURATION",
          1n,
          0n,
          checkedAtBlock,
          "Unlimited channel limit was not explicitly enabled",
        );
  }
  if (limit < 0n || used < 0n) {
    return result(
      "MISSING_RISK_CONFIGURATION",
      0n,
      0n,
      checkedAtBlock,
      "Channel limit inputs must be non-negative",
    );
  }
  const projected = used + orderUsdc;
  return projected > limit
    ? result(code, projected, limit, checkedAtBlock)
    : null;
}

function result(
  code: EligibilityCode,
  required: bigint,
  available: bigint,
  checkedAtBlock: bigint,
  detail?: string,
): EligibilityResult {
  const base: EligibilityResult = {
    code,
    required,
    available,
    source: "snapshot",
    checkedAtBlock,
  };
  return detail === undefined ? base : { ...base, detail };
}
