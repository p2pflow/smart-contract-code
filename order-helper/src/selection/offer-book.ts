import { canonicalJson } from "../canonical/canonical-json";
import { Bytes32 } from "../domain/types";
import { OpenOfferSlot } from "./types";

export type OfferReleaseReason =
  | "ACCEPTED"
  | "CANCELLED"
  | "EXPIRED"
  | "INELIGIBLE"
  | "CANONICAL_REORG_REPLACEMENT";

export interface OfferLifecycleRecord {
  readonly slot: OpenOfferSlot;
  readonly status: "LIVE" | "RELEASED";
  readonly openedByEventId: Bytes32;
  readonly releasedByEventId: Bytes32 | null;
  readonly releaseReason: OfferReleaseReason | null;
}

export interface OfferBookState {
  readonly schema: "p2pflow.reversible-offer-book.v2";
  readonly records: readonly OfferLifecycleRecord[];
}

export interface OfferMutationResult {
  readonly applied: boolean;
  readonly state: OfferBookState;
}

export class OfferBookConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OfferBookConflictError";
  }
}

export function emptyOfferBook(): OfferBookState {
  return {
    schema: "p2pflow.reversible-offer-book.v2",
    records: [],
  };
}

export function openOffer(
  state: OfferBookState,
  eventId: Bytes32,
  slot: OpenOfferSlot,
): OfferMutationResult {
  validateSlot(slot);
  assertBytes32(eventId, "eventId");
  const canonicalSlot = canonicalizeSlot(slot);
  const canonicalEventId = canonicalBytes32(eventId);
  const existing = findRecord(state, canonicalSlot.slotId);
  const semanticExisting = findSemanticRecord(state, canonicalSlot);
  const proposed: OfferLifecycleRecord = {
    slot: canonicalSlot,
    status: "LIVE",
    openedByEventId: canonicalEventId,
    releasedByEventId: null,
    releaseReason: null,
  };
  if (existing !== null) {
    if (
      existing.status === "LIVE" &&
      canonicalJson(existing.slot) === canonicalJson(canonicalSlot)
    ) {
      return { applied: false, state };
    }
    throw new OfferBookConflictError(
      `Offer slot ${canonicalSlot.slotId} was reused with different data`,
    );
  }
  if (semanticExisting !== null) {
    if (
      semanticExisting.status === "LIVE" &&
      canonicalOfferValue(semanticExisting.slot) === canonicalOfferValue(canonicalSlot)
    ) {
      return { applied: false, state };
    }
    throw new OfferBookConflictError(
      "Offer semantic identity was reused with different data",
    );
  }
  return {
    applied: true,
    state: {
      ...state,
      records: sortedRecords([...state.records, proposed]),
    },
  };
}

export function offerSemanticKey(slot: OpenOfferSlot): string {
  return canonicalJson({
    schema: "p2pflow.offer-semantic-key.v1",
    operatorId: canonicalBytes32(slot.operatorId),
    orderId: canonicalBytes32(slot.orderId),
    round: slot.round,
  });
}

export function releaseOffer(
  state: OfferBookState,
  eventId: Bytes32,
  slotId: Bytes32,
  reason: OfferReleaseReason,
): OfferMutationResult {
  assertBytes32(eventId, "eventId");
  assertBytes32(slotId, "slotId");
  const canonicalEventId = canonicalBytes32(eventId);
  const canonicalSlotId = canonicalBytes32(slotId);
  const index = state.records.findIndex(
    (record) => record.slot.slotId.toLowerCase() === canonicalSlotId,
  );
  if (index < 0) {
    throw new OfferBookConflictError(`Offer slot ${slotId} does not exist`);
  }
  const existing = state.records[index];
  if (existing === undefined) {
    throw new Error("Offer record lookup failed");
  }
  if (existing.status === "RELEASED") {
    if (
      existing.releasedByEventId?.toLowerCase() === canonicalEventId &&
      existing.releaseReason === reason
    ) {
      return { applied: false, state };
    }
    throw new OfferBookConflictError(
      `Offer slot ${slotId} was already released`,
    );
  }
  const records = [...state.records];
  records[index] = {
    ...existing,
    status: "RELEASED",
    releasedByEventId: canonicalEventId,
    releaseReason: reason,
  };
  return {
    applied: true,
    state: { ...state, records },
  };
}

export function liveOffersForOperator(
  state: OfferBookState,
  operatorId: Bytes32,
): readonly OpenOfferSlot[] {
  return state.records
    .filter(
      (record) =>
        record.status === "LIVE" &&
        record.slot.operatorId.toLowerCase() === operatorId.toLowerCase(),
    )
    .map((record) => ({ ...record.slot }));
}

export function liveOfferTotalUsdc(
  state: OfferBookState,
  operatorId: Bytes32,
): bigint {
  return liveOffersForOperator(state, operatorId).reduce(
    (total, slot) => total + slot.usdcAmount,
    0n,
  );
}

function findRecord(
  state: OfferBookState,
  slotId: Bytes32,
): OfferLifecycleRecord | null {
  return state.records.find(
    (record) => record.slot.slotId.toLowerCase() === slotId.toLowerCase(),
  ) ?? null;
}

function findSemanticRecord(
  state: OfferBookState,
  slot: OpenOfferSlot,
): OfferLifecycleRecord | null {
  const key = offerSemanticKey(slot);
  return state.records.find(
    (record) => offerSemanticKey(record.slot) === key,
  ) ?? null;
}

function canonicalOfferValue(slot: OpenOfferSlot): string {
  return canonicalJson({
    schema: "p2pflow.offer-semantic-value.v1",
    operatorId: canonicalBytes32(slot.operatorId),
    orderId: canonicalBytes32(slot.orderId),
    round: slot.round,
    merchant: canonicalAddress(slot.merchant),
    channelId: canonicalBytes32(slot.channelId),
    usdcAmount: slot.usdcAmount,
    openedAtSequence: slot.openedAtSequence,
  });
}

function canonicalizeSlot(slot: OpenOfferSlot): OpenOfferSlot {
  return {
    ...slot,
    slotId: canonicalBytes32(slot.slotId),
    orderId: canonicalBytes32(slot.orderId),
    operatorId: canonicalBytes32(slot.operatorId),
    merchant: canonicalAddress(slot.merchant),
    channelId: canonicalBytes32(slot.channelId),
  };
}

function canonicalBytes32(value: Bytes32): Bytes32 {
  return value.toLowerCase() as Bytes32;
}

function canonicalAddress(value: OpenOfferSlot["merchant"]): OpenOfferSlot["merchant"] {
  return value.toLowerCase() as OpenOfferSlot["merchant"];
}

function sortedRecords(
  records: readonly OfferLifecycleRecord[],
): readonly OfferLifecycleRecord[] {
  return [...records].sort((left, right) =>
    left.slot.slotId.toLowerCase().localeCompare(
      right.slot.slotId.toLowerCase(),
    )
  );
}

function validateSlot(slot: OpenOfferSlot): void {
  assertBytes32(slot.slotId, "slotId");
  assertBytes32(slot.orderId, "orderId");
  assertBytes32(slot.operatorId, "operatorId");
  assertBytes32(slot.channelId, "channelId");
  if (
    slot.usdcAmount <= 0n ||
    slot.round < 0n ||
    slot.openedAtSequence < 0n
  ) {
    throw new RangeError("Offer slot integer fields are outside valid bounds");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(slot.merchant)) {
    throw new TypeError("merchant must be a 20-byte hexadecimal value");
  }
}

function assertBytes32(value: string, name: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError(`${name} must be a 32-byte hexadecimal value`);
  }
}
