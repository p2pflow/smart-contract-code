import { canonicalJson } from "../canonical/canonical-json";
import {
  Bytes32,
  RoutingDomain,
} from "../domain/types";
import {
  VIRTUAL_FINISH_SCALE,
} from "./types";
import { maxBigInt } from "./math";

export interface CanonicalAcceptance {
  readonly acceptanceId: Bytes32;
  readonly orderId: Bytes32;
  readonly round: bigint;
  readonly operatorId: Bytes32;
  readonly domainEpoch: Bytes32;
  readonly domain: RoutingDomain;
  readonly usdcAmount: bigint;
  readonly governedDomainFloorQ: bigint;
  readonly acceptedAtBlock: bigint;
  readonly acceptedAtBlockHash: Bytes32;
}

export interface AcceptedOperatorLedger {
  readonly operatorId: Bytes32;
  readonly acceptedUsdc: bigint;
  readonly virtualFinishQ: bigint;
}

export interface AcceptanceReceiptNode {
  readonly key: string;
  readonly receipt: CanonicalAcceptance;
  readonly height: number;
  readonly left: AcceptanceReceiptNode | null;
  readonly right: AcceptanceReceiptNode | null;
}

export interface AcceptanceLedgerState {
  readonly schema: "p2pflow.accepted-service-ledger.v5";
  readonly domain: RoutingDomain;
  readonly domainEpoch: Bytes32;
  readonly operators: readonly AcceptedOperatorLedger[];
  readonly receiptIndex: AcceptanceReceiptNode | null;
  readonly semanticIndex: AcceptanceReceiptNode | null;
  readonly aliasIndex: AcceptanceReceiptNode | null;
  readonly receiptCount: number;
}

export interface AcceptanceApplyResult {
  readonly applied: boolean;
  readonly state: AcceptanceLedgerState;
}

export class AcceptanceConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AcceptanceConflictError";
  }
}

export function emptyAcceptanceLedger(
  domain: RoutingDomain,
  domainEpoch: Bytes32,
): AcceptanceLedgerState {
  assertBytes32(domainEpoch, "domainEpoch");
  assertRoutingDomain(domain, "Ledger routing domain");
  return {
    schema: "p2pflow.accepted-service-ledger.v5",
    domain: { ...domain },
    domainEpoch: canonicalBytes32(domainEpoch),
    operators: [],
    receiptIndex: null,
    semanticIndex: null,
    aliasIndex: null,
    receiptCount: 0,
  };
}

/**
 * Applies accepted service only after a canonical acceptance is observed.
 * Assignment forecasts must never call this function.
 */
export function applyCanonicalAcceptance(
  state: AcceptanceLedgerState,
  acceptance: CanonicalAcceptance,
): AcceptanceApplyResult {
  validateAcceptance(state, acceptance);
  const canonicalAcceptance = canonicalizeAcceptance(acceptance);
  const key = canonicalAcceptance.acceptanceId;
  const existing =
    findReceipt(state.receiptIndex, key) ??
    findReceipt(state.aliasIndex, key);
  if (existing !== null) {
    if (canonicalJson(existing) !== canonicalJson(canonicalAcceptance)) {
      throw new AcceptanceConflictError(
        `Acceptance ${canonicalAcceptance.acceptanceId} conflicts with its receipt`,
      );
    }
    return { applied: false, state };
  }
  const semanticKey = acceptanceSemanticKey(canonicalAcceptance);
  const semanticExisting = findReceipt(state.semanticIndex, semanticKey);
  if (semanticExisting !== null) {
    if (
      canonicalAcceptanceValue(semanticExisting) ===
      canonicalAcceptanceValue(canonicalAcceptance)
    ) {
      return {
        applied: false,
        state: {
          ...state,
          aliasIndex: insertReceipt(
            state.aliasIndex,
            key,
            cloneAcceptance(canonicalAcceptance),
          ),
        },
      };
    }
    throw new AcceptanceConflictError(
      "Acceptance semantic identity conflicts with its canonical receipt",
    );
  }

  const operatorIndex = state.operators.findIndex(
    (entry) =>
      entry.operatorId.toLowerCase() === canonicalAcceptance.operatorId,
  );
  const current = operatorIndex < 0
    ? {
        operatorId: canonicalAcceptance.operatorId,
        acceptedUsdc: 0n,
        virtualFinishQ: canonicalAcceptance.governedDomainFloorQ,
      }
    : state.operators[operatorIndex];
  if (current === undefined) {
    throw new Error("Accepted-service operator lookup failed");
  }

  const updated: AcceptedOperatorLedger = {
    operatorId: canonicalBytes32(current.operatorId),
    acceptedUsdc: current.acceptedUsdc + canonicalAcceptance.usdcAmount,
    virtualFinishQ:
      maxBigInt(
        current.virtualFinishQ,
        canonicalAcceptance.governedDomainFloorQ,
      ) + (VIRTUAL_FINISH_SCALE * canonicalAcceptance.usdcAmount),
  };
  const operators = [...state.operators];
  if (operatorIndex < 0) {
    operators.push(updated);
  } else {
    operators[operatorIndex] = updated;
  }
  operators.sort((left, right) =>
    left.operatorId.toLowerCase().localeCompare(right.operatorId.toLowerCase())
  );

  return {
    applied: true,
    state: {
      ...state,
      operators,
      receiptIndex: insertReceipt(
        state.receiptIndex,
        key,
        cloneAcceptance(canonicalAcceptance),
      ),
      semanticIndex: insertReceipt(
        state.semanticIndex,
        semanticKey,
        cloneAcceptance(canonicalAcceptance),
      ),
      receiptCount: state.receiptCount + 1,
    },
  };
}

export function acceptanceSemanticKey(
  acceptance: CanonicalAcceptance,
): string {
  return canonicalJson({
    schema: "p2pflow.acceptance-semantic-key.v1",
    domain: acceptance.domain,
    domainEpoch: canonicalBytes32(acceptance.domainEpoch),
    orderId: canonicalBytes32(acceptance.orderId),
    round: acceptance.round,
  });
}

export function operatorAcceptedState(
  state: AcceptanceLedgerState,
  operatorId: Bytes32,
): AcceptedOperatorLedger | null {
  return state.operators.find(
    (entry) => entry.operatorId.toLowerCase() === operatorId.toLowerCase(),
  ) ?? null;
}

export function acceptanceReceipt(
  state: AcceptanceLedgerState,
  acceptanceId: Bytes32,
): CanonicalAcceptance | null {
  assertBytes32(acceptanceId, "acceptanceId");
  const receipt = findReceipt(
    state.receiptIndex,
    acceptanceId.toLowerCase(),
  ) ?? findReceipt(
    state.aliasIndex,
    acceptanceId.toLowerCase(),
  );
  return receipt === null ? null : cloneAcceptance(receipt);
}

export function acceptanceReceiptsInOrder(
  state: AcceptanceLedgerState,
): readonly CanonicalAcceptance[] {
  const receipts: CanonicalAcceptance[] = [];
  collectReceipts(state.receiptIndex, receipts);
  return receipts;
}

function findReceipt(
  node: AcceptanceReceiptNode | null,
  key: string,
): CanonicalAcceptance | null {
  let cursor = node;
  while (cursor !== null) {
    if (key === cursor.key) return cursor.receipt;
    cursor = key < cursor.key ? cursor.left : cursor.right;
  }
  return null;
}

function insertReceipt(
  node: AcceptanceReceiptNode | null,
  key: string,
  receipt: CanonicalAcceptance,
): AcceptanceReceiptNode {
  if (node === null) {
    return makeNode(key, receipt, null, null);
  }
  if (key < node.key) {
    return rebalance(
      makeNode(
        node.key,
        node.receipt,
        insertReceipt(node.left, key, receipt),
        node.right,
      ),
    );
  }
  if (key > node.key) {
    return rebalance(
      makeNode(
        node.key,
        node.receipt,
        node.left,
        insertReceipt(node.right, key, receipt),
      ),
    );
  }
  throw new AcceptanceConflictError(`Acceptance ${key} already exists`);
}

function rebalance(node: AcceptanceReceiptNode): AcceptanceReceiptNode {
  const balance = nodeHeight(node.left) - nodeHeight(node.right);
  if (balance > 1) {
    const left = node.left;
    if (left === null) throw new Error("AVL left branch is missing");
    const normalizedLeft =
      nodeHeight(left.left) < nodeHeight(left.right)
        ? rotateLeft(left)
        : left;
    return rotateRight(
      makeNode(node.key, node.receipt, normalizedLeft, node.right),
    );
  }
  if (balance < -1) {
    const right = node.right;
    if (right === null) throw new Error("AVL right branch is missing");
    const normalizedRight =
      nodeHeight(right.right) < nodeHeight(right.left)
        ? rotateRight(right)
        : right;
    return rotateLeft(
      makeNode(node.key, node.receipt, node.left, normalizedRight),
    );
  }
  return node;
}

function rotateLeft(root: AcceptanceReceiptNode): AcceptanceReceiptNode {
  const pivot = root.right;
  if (pivot === null) throw new Error("AVL left rotation lacks a pivot");
  const movedRoot = makeNode(
    root.key,
    root.receipt,
    root.left,
    pivot.left,
  );
  return makeNode(
    pivot.key,
    pivot.receipt,
    movedRoot,
    pivot.right,
  );
}

function rotateRight(root: AcceptanceReceiptNode): AcceptanceReceiptNode {
  const pivot = root.left;
  if (pivot === null) throw new Error("AVL right rotation lacks a pivot");
  const movedRoot = makeNode(
    root.key,
    root.receipt,
    pivot.right,
    root.right,
  );
  return makeNode(
    pivot.key,
    pivot.receipt,
    pivot.left,
    movedRoot,
  );
}

function makeNode(
  key: string,
  receipt: CanonicalAcceptance,
  left: AcceptanceReceiptNode | null,
  right: AcceptanceReceiptNode | null,
): AcceptanceReceiptNode {
  return {
    key,
    receipt,
    height: Math.max(nodeHeight(left), nodeHeight(right)) + 1,
    left,
    right,
  };
}

function nodeHeight(node: AcceptanceReceiptNode | null): number {
  return node?.height ?? 0;
}

function collectReceipts(
  node: AcceptanceReceiptNode | null,
  target: CanonicalAcceptance[],
): void {
  if (node === null) return;
  collectReceipts(node.left, target);
  target.push(cloneAcceptance(node.receipt));
  collectReceipts(node.right, target);
}

function validateAcceptance(
  state: AcceptanceLedgerState,
  acceptance: CanonicalAcceptance,
): void {
  assertBytes32(acceptance.acceptanceId, "acceptanceId");
  assertBytes32(acceptance.orderId, "orderId");
  assertBytes32(acceptance.operatorId, "operatorId");
  assertBytes32(acceptance.domainEpoch, "domainEpoch");
  assertBytes32(acceptance.acceptedAtBlockHash, "acceptedAtBlockHash");
  assertRoutingDomain(state.domain, "Ledger routing domain");
  assertRoutingDomain(acceptance.domain, "Acceptance routing domain");
  if (
    state.domainEpoch.toLowerCase() !== acceptance.domainEpoch.toLowerCase()
  ) {
    throw new AcceptanceConflictError("Acceptance domain epoch mismatch");
  }
  if (!routingDomainsEqual(state.domain, acceptance.domain)) {
    throw new AcceptanceConflictError("Acceptance routing domain mismatch");
  }
  if (
    acceptance.usdcAmount <= 0n ||
    acceptance.round < 0n ||
    acceptance.governedDomainFloorQ < 0n ||
    acceptance.acceptedAtBlock < 0n
  ) {
    throw new RangeError("Acceptance integer fields are outside valid bounds");
  }
}

function cloneAcceptance(
  acceptance: CanonicalAcceptance,
): CanonicalAcceptance {
  return canonicalizeAcceptance(acceptance);
}

function canonicalAcceptanceValue(
  acceptance: CanonicalAcceptance,
): string {
  return canonicalJson({
    schema: "p2pflow.acceptance-semantic-value.v1",
    orderId: canonicalBytes32(acceptance.orderId),
    round: acceptance.round,
    operatorId: canonicalBytes32(acceptance.operatorId),
    domainEpoch: canonicalBytes32(acceptance.domainEpoch),
    domain: acceptance.domain,
    usdcAmount: acceptance.usdcAmount,
    governedDomainFloorQ: acceptance.governedDomainFloorQ,
    acceptedAtBlock: acceptance.acceptedAtBlock,
    acceptedAtBlockHash: canonicalBytes32(acceptance.acceptedAtBlockHash),
  });
}

function canonicalizeAcceptance(
  acceptance: CanonicalAcceptance,
): CanonicalAcceptance {
  return {
    ...acceptance,
    acceptanceId: canonicalBytes32(acceptance.acceptanceId),
    orderId: canonicalBytes32(acceptance.orderId),
    operatorId: canonicalBytes32(acceptance.operatorId),
    domainEpoch: canonicalBytes32(acceptance.domainEpoch),
    domain: { ...acceptance.domain },
    acceptedAtBlockHash: canonicalBytes32(acceptance.acceptedAtBlockHash),
  };
}

function canonicalBytes32(value: Bytes32): Bytes32 {
  return value.toLowerCase() as Bytes32;
}

function routingDomainsEqual(
  left: RoutingDomain,
  right: RoutingDomain,
): boolean {
  return (
    left.chainId === right.chainId &&
    left.fiatCurrency === right.fiatCurrency &&
    left.paymentRailGroup === right.paymentRailGroup &&
    left.orderSide === right.orderSide
  );
}

function assertRoutingDomain(domain: RoutingDomain, name: string): void {
  if (
    !Number.isSafeInteger(domain.chainId) ||
    domain.chainId <= 0 ||
    domain.fiatCurrency.trim().length === 0 ||
    domain.paymentRailGroup.trim().length === 0 ||
    (domain.orderSide !== "BUY" && domain.orderSide !== "SELL")
  ) {
    throw new TypeError(`${name} is invalid`);
  }
}

function assertBytes32(value: string, name: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError(`${name} must be a 32-byte hexadecimal value`);
  }
}
