import { canonicalJson } from "../canonical/canonical-json";
import {
  Address,
  CandidateSnapshot,
  ChannelSnapshot,
} from "../domain/types";
import {
  isCanonicalCurrencyCode,
  isCanonicalRailGroup,
} from "../domain/validation";
import { liveOfferUsdc } from "./math";
import {
  CanonicalUniverseEntry,
  OperatorRoutingSnapshot,
  SelectionHistoryEvent,
  SelectionInput,
} from "./types";

export interface NormalizedSelectionInputs {
  readonly candidates: readonly CandidateSnapshot[];
  readonly universeEntries: readonly CanonicalUniverseEntry[];
  readonly operators: readonly OperatorRoutingSnapshot[];
  readonly history: readonly SelectionHistoryEvent[];
  readonly operatorByWallet: ReadonlyMap<string, OperatorRoutingSnapshot>;
}

export function normalizeSelectionInputs(
  input: SelectionInput,
): NormalizedSelectionInputs {
  const candidates = normalizeCandidates(input.candidates);
  const universeEntries = toUniverseEntries(candidates);
  validateUniverseEvidence(input, universeEntries.length);
  const {
    operators,
    operatorByWallet,
  } = normalizeOperators(input.operators, candidates);
  return {
    candidates,
    universeEntries,
    operators,
    history: normalizeHistory(input.history, input.sequence),
    operatorByWallet,
  };
}

function normalizeCandidates(
  candidates: readonly CandidateSnapshot[],
): readonly CandidateSnapshot[] {
  const byMerchant = new Map<string, CandidateSnapshot>();
  for (const candidate of candidates) {
    assertAddress(candidate.merchant, "candidate merchant");
    const key = candidate.merchant.toLowerCase();
    const normalizedChannels = normalizeChannels(candidate.channels);
    const normalized = { ...candidate, channels: normalizedChannels };
    const existing = byMerchant.get(key);
    if (existing === undefined) {
      byMerchant.set(key, normalized);
      continue;
    }
    if (
      canonicalJson(candidateCore(existing)) !==
      canonicalJson(candidateCore(normalized))
    ) {
      throw new TypeError(
        `Candidate ${candidate.merchant} appears with conflicting prestate`,
      );
    }
    byMerchant.set(key, {
      ...existing,
      channels: mergeChannels(existing.channels, normalized.channels),
    });
  }
  return [...byMerchant.values()].sort((left, right) =>
    left.merchant.toLowerCase().localeCompare(right.merchant.toLowerCase())
  );
}

function candidateCore(
  candidate: CandidateSnapshot,
): Omit<CandidateSnapshot, "channels"> {
  const {
    channels: ignoredChannels,
    ...core
  } = candidate;
  void ignoredChannels;
  return core;
}

function normalizeChannels(
  channels: readonly ChannelSnapshot[],
): readonly ChannelSnapshot[] {
  const byId = new Map<string, ChannelSnapshot>();
  for (const channel of channels) {
    assertBytes32(channel.channelId, "channelId");
    assertAddress(channel.merchant, "channel merchant");
    if (
      !isCanonicalCurrencyCode(channel.fiatCurrency) ||
      !isCanonicalRailGroup(channel.paymentRailGroup)
    ) {
      throw new TypeError(
        "Channel routing identifiers must use canonical public codes",
      );
    }
    const key = channel.channelId.toLowerCase();
    const existing = byId.get(key);
    if (
      existing !== undefined &&
      canonicalJson(existing) !== canonicalJson(channel)
    ) {
      throw new TypeError(
        `Channel ${channel.channelId} appears with conflicting prestate`,
      );
    }
    byId.set(key, { ...channel });
  }
  return [...byId.values()].sort((left, right) =>
    left.channelId.toLowerCase().localeCompare(right.channelId.toLowerCase())
  );
}

function mergeChannels(
  left: readonly ChannelSnapshot[],
  right: readonly ChannelSnapshot[],
): readonly ChannelSnapshot[] {
  return normalizeChannels([...left, ...right]);
}

function toUniverseEntries(
  candidates: readonly CandidateSnapshot[],
): readonly CanonicalUniverseEntry[] {
  const entries: CanonicalUniverseEntry[] = [];
  for (const candidate of candidates) {
    if (candidate.channels.length === 0) {
      entries.push({
        merchant: candidate.merchant,
        channelId: null,
        candidate,
      });
      continue;
    }
    for (const channel of candidate.channels) {
      entries.push({
        merchant: candidate.merchant,
        channelId: channel.channelId,
        candidate,
      });
    }
  }
  return entries.sort((left, right) => {
    const merchant = left.merchant.toLowerCase().localeCompare(
      right.merchant.toLowerCase(),
    );
    if (merchant !== 0) return merchant;
    return (left.channelId ?? "").toLowerCase().localeCompare(
      (right.channelId ?? "").toLowerCase(),
    );
  });
}

function validateUniverseEvidence(
  input: SelectionInput,
  actualCount: number,
): void {
  const evidence = input.universe;
  if (!evidence.complete) {
    throw new TypeError("Candidate universe pagination is incomplete");
  }
  if (!Number.isSafeInteger(evidence.pageCount) || evidence.pageCount <= 0) {
    throw new RangeError("Candidate universe pageCount must be positive");
  }
  if (
    !Number.isSafeInteger(evidence.expectedEntryCount) ||
    evidence.expectedEntryCount < 0 ||
    evidence.expectedEntryCount !== actualCount
  ) {
    throw new RangeError(
      `Candidate universe count mismatch: expected ${evidence.expectedEntryCount}, canonical ${actualCount}`,
    );
  }
  if (
    evidence.finalizedBlock !== input.order.snapshotBlock ||
    evidence.finalizedBlockHash.toLowerCase() !==
      input.order.snapshotBlockHash.toLowerCase()
  ) {
    throw new TypeError("Candidate universe finalized block/hash mismatch");
  }
}

function normalizeOperators(
  operators: readonly OperatorRoutingSnapshot[],
  candidates: readonly CandidateSnapshot[],
): {
  readonly operators: readonly OperatorRoutingSnapshot[];
  readonly operatorByWallet: ReadonlyMap<string, OperatorRoutingSnapshot>;
} {
  const byId = new Map<string, OperatorRoutingSnapshot>();
  const byWallet = new Map<string, OperatorRoutingSnapshot>();
  const candidateWallets = new Set(
    candidates.map((candidate) => candidate.merchant.toLowerCase()),
  );

  for (const operator of operators) {
    assertBytes32(operator.operatorId, "operatorId");
    assertBytes32(operator.failureDomainId, "failureDomainId");
    if (operator.wallets.length === 0) {
      throw new TypeError("Operator must contain at least one opaque wallet");
    }
    if (
      operator.acceptedUsdc < 0n ||
      (operator.virtualFinishQ !== null && operator.virtualFinishQ < 0n) ||
      operator.activeAcceptedOrders < 0 ||
      operator.maxActiveAcceptedOrders <= 0 ||
      operator.recentFailureTier < 0
    ) {
      throw new RangeError("Operator routing prestate is outside valid bounds");
    }
    liveOfferUsdc(operator.openOffers);
    const normalizedWallets = [...new Set(
      operator.wallets.map((wallet) => {
        assertAddress(wallet, "operator wallet");
        return wallet.toLowerCase();
      }),
    )].sort() as Address[];
    const normalized: OperatorRoutingSnapshot = {
      ...operator,
      wallets: normalizedWallets,
      openOffers: [...operator.openOffers].sort((left, right) =>
        left.slotId.toLowerCase().localeCompare(right.slotId.toLowerCase())
      ),
    };
    const idKey = operator.operatorId.toLowerCase();
    if (byId.has(idKey)) {
      throw new TypeError(`Duplicate economic operator ${operator.operatorId}`);
    }
    byId.set(idKey, normalized);
    for (const wallet of normalizedWallets) {
      const walletKey = wallet.toLowerCase();
      if (byWallet.has(walletKey)) {
        throw new TypeError(`Wallet ${wallet} maps to multiple operators`);
      }
      byWallet.set(walletKey, normalized);
    }
  }

  for (const wallet of candidateWallets) {
    if (!byWallet.has(wallet)) {
      throw new TypeError(`Candidate wallet ${wallet} lacks an operator group`);
    }
  }
  for (const operator of byId.values()) {
    if (
      !operator.wallets.some((wallet) =>
        candidateWallets.has(wallet.toLowerCase())
      )
    ) {
      throw new TypeError(
        `Operator ${operator.operatorId} has no candidate-universe wallet`,
      );
    }
    for (const slot of operator.openOffers) {
      if (
        slot.operatorId.toLowerCase() !== operator.operatorId.toLowerCase() ||
        !operator.wallets.some(
          (wallet) => wallet.toLowerCase() === slot.merchant.toLowerCase(),
        )
      ) {
        throw new TypeError("Offer slot does not belong to its operator group");
      }
    }
  }

  return {
    operators: [...byId.values()].sort((left, right) =>
      left.operatorId.toLowerCase().localeCompare(
        right.operatorId.toLowerCase(),
      )
    ),
    operatorByWallet: byWallet,
  };
}

function normalizeHistory(
  history: readonly SelectionHistoryEvent[],
  currentSequence: bigint,
): readonly SelectionHistoryEvent[] {
  const byId = new Map<string, SelectionHistoryEvent>();
  for (const event of history) {
    assertBytes32(event.eventId, "history eventId");
    assertBytes32(event.operatorId, "history operatorId");
    assertBytes32(event.decisionId, "history decisionId");
    assertBytes32(event.orderId, "history orderId");
    if (
      event.sequence < 0n ||
      event.sequence >= currentSequence ||
      event.round < 0n
    ) {
      throw new RangeError("Selection history must precede current sequence");
    }
    const key = event.eventId.toLowerCase();
    const existing = byId.get(key);
    if (
      existing !== undefined &&
      canonicalJson(existing) !== canonicalJson(event)
    ) {
      throw new TypeError(`History event ${event.eventId} conflicts`);
    }
    byId.set(key, { ...event });
  }
  return [...byId.values()].sort((left, right) => {
    if (left.sequence < right.sequence) return -1;
    if (left.sequence > right.sequence) return 1;
    return left.eventId.toLowerCase().localeCompare(
      right.eventId.toLowerCase(),
    );
  });
}

function assertAddress(value: string, name: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new TypeError(`${name} must be a 20-byte hexadecimal value`);
  }
}

function assertBytes32(value: string, name: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError(`${name} must be a 32-byte hexadecimal value`);
  }
}
