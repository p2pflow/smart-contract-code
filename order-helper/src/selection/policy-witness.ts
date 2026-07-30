import {
  COUNCIL_BILL_SHA256,
  COUNCIL_VERDICT,
} from "../authority";
import { canonicalJson } from "../canonical/canonical-json";
import type {
  Bytes32,
  SelectionPolicy,
} from "../domain/types";
import { hashCanonicalPayloadText } from "./canonical";
import type { ShadowSelectionPolicy } from "./types";

export type SelectionPolicyMaterial = Omit<SelectionPolicy, "policyHash">;

export interface CanonicalPolicyWitness {
  readonly schema: "p2pflow.shadow-policy-witness.v1";
  readonly councilBillSha256: typeof COUNCIL_BILL_SHA256;
  readonly councilVerdict: typeof COUNCIL_VERDICT;
  readonly actionAuthorization: false;
  readonly selectionPolicy: SelectionPolicyMaterial;
  readonly shadowPolicy: ShadowSelectionPolicy;
}

export function selectionPolicyMaterial(
  policy: SelectionPolicy | SelectionPolicyMaterial,
): SelectionPolicyMaterial {
  return {
    version: policy.version,
    candidateCount: policy.candidateCount,
    assignmentTtlSeconds: policy.assignmentTtlSeconds,
    leaseStepSeconds: policy.leaseStepSeconds,
    maxStateAgeBlocks: policy.maxStateAgeBlocks,
    maxPendingOffersPerMerchant: policy.maxPendingOffersPerMerchant,
    openOfferWeightNumerator: policy.openOfferWeightNumerator,
    openOfferWeightDenominator: policy.openOfferWeightDenominator,
    targetFiatShareBps: policy.targetFiatShareBps,
    buySafetyBufferBps: policy.buySafetyBufferBps,
    minBuySafetyBufferUsdc: policy.minBuySafetyBufferUsdc,
    maxPriceDeviationBps: policy.maxPriceDeviationBps,
    minMerchantStakeUsdc: policy.minMerchantStakeUsdc,
    minOrderUsdc: policy.minOrderUsdc,
    maxOrderUsdc: policy.maxOrderUsdc,
    acceptedOrderTimeoutSeconds: policy.acceptedOrderTimeoutSeconds,
    disputeWindowSeconds: policy.disputeWindowSeconds,
  };
}

export function canonicalPolicyWitness(
  policy: SelectionPolicy | SelectionPolicyMaterial,
  shadowPolicy: ShadowSelectionPolicy,
): CanonicalPolicyWitness {
  return {
    schema: "p2pflow.shadow-policy-witness.v1",
    councilBillSha256: COUNCIL_BILL_SHA256,
    councilVerdict: COUNCIL_VERDICT,
    actionAuthorization: false,
    selectionPolicy: selectionPolicyMaterial(policy),
    shadowPolicy: { ...shadowPolicy },
  };
}

export function selectionPolicyHash(
  policy: SelectionPolicy | SelectionPolicyMaterial,
  shadowPolicy: ShadowSelectionPolicy,
): Bytes32 {
  return hashCanonicalPayloadText(
    canonicalJson(canonicalPolicyWitness(policy, shadowPolicy)),
  );
}
