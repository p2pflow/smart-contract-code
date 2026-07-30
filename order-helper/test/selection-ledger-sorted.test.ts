import assert from "node:assert/strict";
import test from "node:test";
import {
  AcceptanceLedgerState,
  acceptanceReceipt,
  applyCanonicalAcceptance,
  emptyAcceptanceLedger,
} from "../src/selection/acceptance-ledger";
import {
  Bytes32,
} from "../src/domain/types";

test("sorted receipt keys remain balanced, immutable, counted, and idempotent", () => {
  const domainEpoch = hex32(1);
  const operatorId = hex32(2);
  const base = emptyAcceptanceLedger(
    {
      chainId: 84_532,
      fiatCurrency: "INR",
      paymentRailGroup: "FIXTURE_RAIL",
      orderSide: "BUY",
    },
    domainEpoch,
  );
  let state = base;
  let branchPoint: AcceptanceLedgerState | null = null;
  for (let index = 1; index <= 20_000; index += 1) {
    state = applyCanonicalAcceptance(
      state,
      sortedAcceptance(index, operatorId, domainEpoch),
    ).state;
    if (index === 10_000) branchPoint = state;
  }

  assert.equal(base.receiptIndex, null);
  assert.equal(base.semanticIndex, null);
  assert.equal(base.receiptCount, 0);
  assert.equal(state.receiptCount, 20_000);
  assert.ok((state.receiptIndex?.height ?? 0) <= 21);
  assert.ok((state.semanticIndex?.height ?? 0) <= 21);
  assert.equal(
    acceptanceReceipt(state, hex32(19_999))?.acceptedAtBlock,
    19_999n,
  );

  assert.ok(branchPoint !== null);
  if (branchPoint === null) return;
  const branchEvent = sortedAcceptance(
    30_000,
    operatorId,
    domainEpoch,
  );
  const branch = applyCanonicalAcceptance(
    branchPoint,
    branchEvent,
  ).state;
  assert.equal(branchPoint.receiptCount, 10_000);
  assert.equal(branch.receiptCount, 10_001);
  assert.equal(state.receiptCount, 20_000);
  assert.ok((branchPoint.semanticIndex?.height ?? 0) <= 20);
  assert.ok((branch.semanticIndex?.height ?? 0) <= 20);
  assert.equal(acceptanceReceipt(state, branchEvent.acceptanceId), null);
  assert.equal(
    acceptanceReceipt(branch, branchEvent.acceptanceId)?.acceptanceId,
    branchEvent.acceptanceId,
  );
  const duplicate = applyCanonicalAcceptance(branch, branchEvent);
  assert.equal(duplicate.applied, false);
  assert.strictEqual(duplicate.state, branch);
});

function sortedAcceptance(
  index: number,
  operatorId: Bytes32,
  domainEpoch: Bytes32,
) {
  return {
    acceptanceId: hex32(index),
    orderId: hex32(100_000 + index),
    round: 1n,
    operatorId,
    domainEpoch,
    domain: {
      chainId: 84_532,
      fiatCurrency: "INR",
      paymentRailGroup: "FIXTURE_RAIL",
      orderSide: "BUY" as const,
    },
    usdcAmount: 1n,
    governedDomainFloorQ: 0n,
    acceptedAtBlock: BigInt(index),
    acceptedAtBlockHash: hex32(200_000 + index),
  };
}

function hex32(value: number): Bytes32 {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("hex32 fixture value must be non-negative");
  }
  return `0x${value.toString(16).padStart(64, "0")}` as Bytes32;
}
