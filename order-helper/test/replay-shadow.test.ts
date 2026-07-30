import assert from "node:assert/strict";
import test from "node:test";
import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_DIAMOND_ADDRESS,
} from "../src/authority";
import { canonicalJson } from "../src/canonical/canonical-json";
import {
  InMemoryShadowTraceLedger,
  ShadowTraceConflictError,
  ShadowTraceLedger,
  ShadowTraceRecord,
} from "../src/persistence/shadow-trace-ledger";
import {
  ReplayFixtureError,
  decodeReplayFixture,
  executeReplayFixture,
  parseTaggedJson,
  stringifyTaggedJson,
} from "../src/replay/fixture-codec";
import { buildUnapprovedReplayFixture } from "../src/replay/unapproved-fixture";
import { ShadowOrderProcessor } from "../src/service/shadow-processor";
import {
  canonicalMerkleRoot,
  hashCanonicalPayloadText,
  selectionPolicyHash,
  ShadowSelectionResult,
  verifyCanonicalPayloadText,
} from "../src/selection";
import { fixtureBytes32 } from "../src/simulator";

test("tagged JSON preserves bigint values without decimal ambiguity", () => {
  const encoded = stringifyTaggedJson({ value: 12345678901234567890n });
  assert.equal(
    encoded,
    '{"value":{"$bigint":"12345678901234567890"}}',
  );
  assert.deepEqual(parseTaggedJson(encoded), {
    value: 12345678901234567890n,
  });
  assert.throws(
    () => parseTaggedJson('{"value":{"$bigint":"01"}}'),
    ReplayFixtureError,
  );
});

test("replay reproduces one trace and the shadow ledger deduplicates it", async () => {
  const fixture = await buildUnapprovedReplayFixture();
  const encoded = stringifyTaggedJson(fixture);
  const decoded = decodeReplayFixture(encoded);
  const replayed = await executeReplayFixture(decoded);
  assert.equal(replayed.trace.traceId, fixture.expectedTraceId);
  assert.equal(replayed.trace.actionAuthorization, false);
  assert.equal(
    replayed.trace.capability,
    "TRANSACTION_DISABLED_SHADOW_ONLY",
  );

  const ledger = new InMemoryShadowTraceLedger();
  const processor = new ShadowOrderProcessor(ledger);
  const first = await processor.process(decoded.input, 1_000);
  const duplicate = await processor.process(decoded.input, 1_000);
  assert.equal(first.persisted.inserted, true);
  assert.equal(duplicate.persisted.inserted, false);
  assert.equal(
    (await ledger.get(replayed.trace.traceId))?.actionAuthorization,
    false,
  );
});

test("replay fails closed on a mismatched expected trace", async () => {
  const fixture = await buildUnapprovedReplayFixture();
  const decoded = decodeReplayFixture(
    stringifyTaggedJson({
      ...fixture,
      expectedTraceId: fixtureBytes32("wrong-replay-trace"),
    }),
  );
  await assert.rejects(
    () => executeReplayFixture(decoded),
    ReplayFixtureError,
  );
});

test("missing recorded eligibility cannot be mistaken for eligibility", async () => {
  const fixture = await buildUnapprovedReplayFixture();
  const incomplete = {
    ...fixture,
    authoritativeResults: fixture.authoritativeResults.slice(0, 4),
    expectedTraceId: undefined,
  };
  const replayed = await executeReplayFixture(
    decodeReplayFixture(stringifyTaggedJson(incomplete)),
  );
  assert.ok("status" in replayed.outcome);
  assert.notEqual(replayed.trace.noServiceReason, null);
  assert.equal(replayed.trace.actionAuthorization, false);
});

test("replay rejects malformed nested types instead of applying JavaScript truthiness", async () => {
  const fixture = await buildUnapprovedReplayFixture();
  const malformed = {
    ...fixture,
    expectedTraceId: undefined,
    input: {
      ...fixture.input,
      candidates: fixture.input.candidates.map((candidate) => ({
        ...candidate,
        registered: "false",
      })),
    },
  };
  assert.throws(
    () => decodeReplayFixture(stringifyTaggedJson(malformed)),
    ReplayFixtureError,
  );
});

test("replay rejects inconsistent authoritative ELIGIBLE results", async () => {
  const fixture = await buildUnapprovedReplayFixture();
  const malformed = {
    ...fixture,
    expectedTraceId: undefined,
    authoritativeResults: fixture.authoritativeResults.map((entry) => ({
      ...entry,
      result: {
        ...entry.result,
        code: "ELIGIBLE",
        required: 0n,
        available: 0n,
      },
    })),
  };
  assert.throws(
    () => decodeReplayFixture(stringifyTaggedJson(malformed)),
    ReplayFixtureError,
  );
});

test("replay rejects unknown nested fields, enum values, and uint256 overflow", async () => {
  const fixture = await buildUnapprovedReplayFixture();
  const firstCandidate = fixture.input.candidates[0];
  assert.ok(firstCandidate !== undefined);
  const withUnknown = {
    ...fixture,
    input: {
      ...fixture.input,
      candidates: [
        { ...firstCandidate, executableAdapter: true },
        ...fixture.input.candidates.slice(1),
      ],
    },
  };
  assert.throws(
    () => decodeReplayFixture(stringifyTaggedJson(withUnknown)),
    ReplayFixtureError,
  );
  const invalidEnum = {
    ...fixture,
    input: {
      ...fixture.input,
      candidates: [
        { ...firstCandidate, accountStatus: "UNKNOWN" },
        ...fixture.input.candidates.slice(1),
      ],
    },
  };
  assert.throws(
    () => decodeReplayFixture(stringifyTaggedJson(invalidEnum)),
    ReplayFixtureError,
  );
  const overflow = {
    ...fixture,
    input: {
      ...fixture.input,
      sequence: 1n << 256n,
    },
  };
  assert.throws(
    () => decodeReplayFixture(stringifyTaggedJson(overflow)),
    ReplayFixtureError,
  );
});

test("replay enforces the Base Sepolia target and fail-closed policy ratios", async () => {
  const fixture = await buildUnapprovedReplayFixture();
  const wrongChain = {
    ...fixture,
    input: {
      ...fixture.input,
      order: {
        ...fixture.input.order,
        chainId: 1,
        domain: { ...fixture.input.order.domain, chainId: 1 },
      },
    },
  };
  assert.throws(
    () => decodeReplayFixture(stringifyTaggedJson(wrongChain)),
    ReplayFixtureError,
  );
  const excessiveDeviation = {
    ...fixture,
    input: {
      ...fixture.input,
      policy: {
        ...fixture.input.policy,
        maxPriceDeviationBps: 10_001,
      },
    },
  };
  assert.throws(
    () => decodeReplayFixture(stringifyTaggedJson(excessiveDeviation)),
    ReplayFixtureError,
  );
  const fullOfferWeight = {
    ...fixture,
    input: {
      ...fixture.input,
      policy: {
        ...fixture.input.policy,
        openOfferWeightNumerator:
          fixture.input.policy.openOfferWeightDenominator,
      },
    },
  };
  assert.throws(
    () => decodeReplayFixture(stringifyTaggedJson(fullOfferWeight)),
    ReplayFixtureError,
  );
});

test("replay rejects detached policy hashes and accepts recomputed witnesses", async () => {
  const fixture = await buildUnapprovedReplayFixture();
  const detached = decodeReplayFixture(stringifyTaggedJson({
    ...fixture,
    expectedTraceId: undefined,
    input: {
      ...fixture.input,
      policy: {
        ...fixture.input.policy,
        version: "detached-policy-material-2",
      },
    },
  }));
  await assert.rejects(
    () => executeReplayFixture(detached),
    /Policy hash does not match/i,
  );

  const shadowPolicy = {
    ...fixture.input.shadowPolicy,
    readinessReserveF: 0,
  };
  const rebound = decodeReplayFixture(stringifyTaggedJson({
    ...fixture,
    expectedTraceId: undefined,
    input: {
      ...fixture.input,
      policy: {
        ...fixture.input.policy,
        policyHash: selectionPolicyHash(fixture.input.policy, shadowPolicy),
      },
      shadowPolicy,
    },
  }));
  const replayed = await executeReplayFixture(rebound);
  assert.ok(
    verifyCanonicalPayloadText(
      replayed.trace.canonicalWitness,
      replayed.trace.witnessContentId,
    ),
  );
});

test("shadow ledger rejects noncanonical text and metadata not bound to payload", async () => {
  const record = await validDecisionRecord();
  const noncanonicalPayload = JSON.stringify(
    JSON.parse(record.canonicalPayload) as unknown,
    null,
    2,
  );
  const noncanonicalTraceId = hashCanonicalPayloadText(noncanonicalPayload);
  await assert.rejects(
    () =>
      new InMemoryShadowTraceLedger().append({
        ...record,
        canonicalPayload: noncanonicalPayload,
        traceId: noncanonicalTraceId,
        decisionId: noncanonicalTraceId,
      }),
    ShadowTraceConflictError,
  );
  await assert.rejects(
    () =>
      new InMemoryShadowTraceLedger().append({
        ...record,
        chainId: record.chainId + 1,
      }),
    ShadowTraceConflictError,
  );
});

test("shadow ledger rejects content-addressed witness semantic tampering", async () => {
  const record = await validDecisionRecord();
  assert.ok(
    verifyCanonicalPayloadText(
      record.canonicalWitness,
      record.witnessContentId,
    ),
  );
  const cases: readonly ((witness: Record<string, unknown>) => void)[] = [
    (witness) => {
      const input = requirePayloadRecord(witness.input, "witness.input");
      const policy = requirePayloadRecord(
        input.canonicalPolicyWitness,
        "witness.input.canonicalPolicyWitness",
      );
      policy.councilVerdict = "PASS";
    },
    (witness) => {
      const input = requirePayloadRecord(witness.input, "witness.input");
      const order = requirePayloadRecord(input.order, "witness.input.order");
      order.orderId = fixtureBytes32("detached-witness-order");
    },
    (witness) => {
      witness.universeEntries = [];
    },
    (witness) => {
      const output = requirePayloadRecord(witness.output, "witness.output");
      output.serviceStatus = "NO_SERVICE";
    },
  ];
  for (const mutate of cases) {
    const tampered = rehashWitnessRecord(record, mutate);
    assert.ok(
      verifyCanonicalPayloadText(
        tampered.canonicalWitness,
        tampered.witnessContentId,
      ),
    );
    assert.equal(
      hashCanonicalPayloadText(tampered.canonicalPayload),
      tampered.traceId,
    );
    await assert.rejects(
      () => new InMemoryShadowTraceLedger().append(tampered),
      ShadowTraceConflictError,
    );
  }
});

test("shadow ledger rejects fully rehashed but unreplayable witness semantics", async () => {
  const record = await validDecisionRecord();
  const detachedExclusion = rehashWitnessRecord(record, (witness) => {
    const prestates = requirePayloadObjectArray(
      witness.eligibilityPrestates,
      "witness.eligibilityPrestates",
    );
    const first = requirePayloadEntry(
      prestates,
      0,
      "witness.eligibilityPrestates",
    );
    const exclusions = witness.exclusions;
    assert.ok(Array.isArray(exclusions));
    exclusions.push({
      merchant: first.merchant,
      channelId: first.channelId,
      result: {
        code: "ORDER_NOT_OPEN",
        required: "0",
        available: "0",
        source: "snapshot",
        checkedAtBlock: first.checkedAtBlock,
      },
    });
  });
  const malformedPrestate = rehashEligibilityPrestateRecord(
    record,
    (prestate) => {
      prestate.eligibilityCode = "SELF_REHASHED_UNKNOWN_CODE";
    },
  );

  for (const tampered of [detachedExclusion, malformedPrestate]) {
    assert.ok(
      verifyCanonicalPayloadText(
        tampered.canonicalWitness,
        tampered.witnessContentId,
      ),
    );
    assert.ok(
      verifyCanonicalPayloadText(
        tampered.canonicalPayload,
        tampered.traceId,
      ),
    );
    await assert.rejects(
      () => new InMemoryShadowTraceLedger().append(tampered),
      ShadowTraceConflictError,
    );
  }
});

test("shadow ledger rejects a same-length detached universe after full rehash", async () => {
  const record = await validDecisionRecord();
  const detached = rehashDetachedUniverseRecord(record);
  const witness = requirePayloadRecord(
    JSON.parse(detached.canonicalWitness) as unknown,
    "canonicalWitness",
  );
  const universeEntries = requirePayloadObjectArray(
    witness.universeEntries,
    "witness.universeEntries",
  );
  assert.equal(universeEntries.length, record.universeCount);
  assert.equal(detached.universeCount, record.universeCount);
  assert.equal(
    canonicalMerkleRoot("p2pflow.candidate-universe.v1", universeEntries),
    detached.universeRoot,
  );
  assert.ok(
    verifyCanonicalPayloadText(
      detached.canonicalWitness,
      detached.witnessContentId,
    ),
  );
  assert.equal(
    hashCanonicalPayloadText(detached.canonicalPayload),
    detached.traceId,
  );
  await assert.rejects(
    () => new InMemoryShadowTraceLedger().append(detached),
    ShadowTraceConflictError,
  );
});

test("shadow ledger pins fully rehashed injected-selector output to Base Sepolia authority", async () => {
  const record = await validDecisionRecord();
  const rogueDiamond = `0x${"51".repeat(20)}` as const;
  const cases = [
    rehashAuthorityRecord(record, BASE_SEPOLIA_CHAIN_ID + 1, BASE_SEPOLIA_DIAMOND_ADDRESS),
    rehashAuthorityRecord(record, BASE_SEPOLIA_CHAIN_ID, rogueDiamond),
  ];
  for (const injected of cases) {
    assert.ok(verifyCanonicalPayloadText(injected.canonicalWitness, injected.witnessContentId));
    assert.ok(verifyCanonicalPayloadText(injected.canonicalPayload, injected.traceId));
    await assert.rejects(
      () => new InMemoryShadowTraceLedger().append(injected),
      ShadowTraceConflictError,
    );
  }
});

test("shadow ledger rejects unknown status and non-exact or duplicate decision operators", async () => {
  const record = await validDecisionRecord();
  const unknownStatus = {
    ...record,
    serviceStatus: "BOGUS",
  } as unknown as ShadowTraceRecord;
  await assert.rejects(
    () => new InMemoryShadowTraceLedger().append(unknownStatus),
    ShadowTraceConflictError,
  );
  await assert.rejects(
    () =>
      new InMemoryShadowTraceLedger().append({
        ...record,
        selectedOperatorIds: record.selectedOperatorIds.slice(0, 3),
      }),
    ShadowTraceConflictError,
  );
  const first = record.selectedOperatorIds[0];
  assert.ok(first !== undefined);
  await assert.rejects(
    () =>
      new InMemoryShadowTraceLedger().append({
        ...record,
        selectedOperatorIds: [
          first,
          first,
          ...record.selectedOperatorIds.slice(2),
        ],
      }),
    ShadowTraceConflictError,
  );
});

test("shadow ledger rejects hash/root-consistent invalid lease semantics", async () => {
  const record = await validDecisionRecord();
  const cases: readonly ((payload: Record<string, unknown>) => void)[] = [
    (payload) => {
      payload.assignedAt = payload.validUntil;
    },
    (payload) => {
      payload.validUntil = (
        BigInt(requirePayloadString(payload.quoteDeadline, "quoteDeadline")) +
        1n
      ).toString();
    },
    (payload) => {
      const candidates = requirePayloadObjectArray(
        payload.candidates,
        "candidates",
      );
      const leases = requirePayloadObjectArray(
        payload.leaseSchedule,
        "leaseSchedule",
      );
      const firstCandidate = requirePayloadEntry(candidates, 0, "candidates");
      const firstLease = requirePayloadEntry(leases, 0, "leaseSchedule");
      const shifted = (
        BigInt(requirePayloadString(firstLease.unlockAt, "unlockAt")) + 1n
      ).toString();
      firstCandidate.unlockAt = shifted;
      firstLease.unlockAt = shifted;
    },
    (payload) => {
      const candidates = requirePayloadObjectArray(
        payload.candidates,
        "candidates",
      );
      const leases = requirePayloadObjectArray(
        payload.leaseSchedule,
        "leaseSchedule",
      );
      const firstLease = requirePayloadEntry(leases, 0, "leaseSchedule");
      const secondLease = requirePayloadEntry(leases, 1, "leaseSchedule");
      const secondCandidate = requirePayloadEntry(candidates, 1, "candidates");
      const gappedUnlock = (
        BigInt(requirePayloadString(firstLease.intervalEnd, "intervalEnd")) +
        1n
      ).toString();
      secondLease.unlockAt = gappedUnlock;
      secondCandidate.unlockAt = gappedUnlock;
    },
    (payload) => {
      const leases = requirePayloadObjectArray(
        payload.leaseSchedule,
        "leaseSchedule",
      );
      const finalLease = requirePayloadEntry(leases, 3, "leaseSchedule");
      finalLease.intervalEnd = (
        BigInt(requirePayloadString(payload.validUntil, "validUntil")) - 1n
      ).toString();
    },
    (payload) => {
      const candidates = requirePayloadObjectArray(
        payload.candidates,
        "candidates",
      );
      const first = requirePayloadEntry(candidates, 0, "candidates");
      const second = requirePayloadEntry(candidates, 1, "candidates");
      second.failureDomainId = first.failureDomainId;
    },
  ];

  for (const mutate of cases) {
    const malformed = rehashDecisionRecord(record, mutate);
    const payload = requirePayloadRecord(
      JSON.parse(malformed.canonicalPayload) as unknown,
      "canonicalPayload",
    );
    assert.equal(
      hashCanonicalPayloadText(malformed.canonicalPayload),
      malformed.traceId,
    );
    assert.equal(
      canonicalMerkleRoot("p2pflow.shadow-output.v2", [
        {
          candidates: payload.candidates,
          leaseSchedule: payload.leaseSchedule,
        },
      ]),
      malformed.outputRoot,
    );
    await assert.rejects(
      () => new InMemoryShadowTraceLedger().append(malformed),
      ShadowTraceConflictError,
    );
  }
});

test("no-service ledger records require the canonical reason and zero selected operators", async () => {
  const fixture = await buildUnapprovedReplayFixture();
  const incomplete = {
    ...fixture,
    authoritativeResults: fixture.authoritativeResults.slice(0, 4),
    expectedTraceId: undefined,
  };
  const decoded = decodeReplayFixture(stringifyTaggedJson(incomplete));
  const ledger = new InMemoryShadowTraceLedger();
  const result = await new ShadowOrderProcessor(ledger).process(
    decoded.input,
    1_000,
  );
  const record = await ledger.get(result.selection.trace.traceId);
  assert.ok(record !== null);
  assert.equal(record.serviceStatus, "NO_SERVICE");
  assert.deepEqual(record.selectedOperatorIds, []);
  await assert.rejects(
    () =>
      new InMemoryShadowTraceLedger().append({
        ...record,
        selectedOperatorIds: [fixtureBytes32("invalid-no-service-selection")],
      }),
    ShadowTraceConflictError,
  );
});

test("processor rejects an authority-claiming injected selector before calling its ledger", async () => {
  const fixture = await buildUnapprovedReplayFixture();
  const decoded = decodeReplayFixture(stringifyTaggedJson(fixture));
  const legitimate = await executeReplayFixture(decoded);
  const malicious = {
    ...legitimate,
    trace: {
      ...legitimate.trace,
      actionAuthorization: true,
    },
  } as unknown as ShadowSelectionResult;
  let appendCalled = false;
  const permissiveLedger: ShadowTraceLedger = {
    async append(record) {
      appendCalled = true;
      return { inserted: true, record };
    },
    async get() {
      return null;
    },
    async getByOrderSequence() {
      return null;
    },
  };
  const processor = new ShadowOrderProcessor(
    permissiveLedger,
    async () => malicious,
  );
  await assert.rejects(
    () => processor.process(decoded.input, 1_000),
    ShadowTraceConflictError,
  );
  assert.equal(appendCalled, false);
});

test("processor rejects an injected outcome detached from its replayed trace", async () => {
  const fixture = await buildUnapprovedReplayFixture();
  const decoded = decodeReplayFixture(stringifyTaggedJson(fixture));
  const legitimate = await executeReplayFixture(decoded);
  const malicious = {
    ...legitimate,
    outcome: {
      ...legitimate.outcome,
      helperBuildVersion: "detached-outcome-v2",
    },
  } as ShadowSelectionResult;
  let appendCalled = false;
  const permissiveLedger: ShadowTraceLedger = {
    async append(record) {
      appendCalled = true;
      return { inserted: true, record };
    },
    async get() {
      return null;
    },
    async getByOrderSequence() {
      return null;
    },
  };
  await assert.rejects(
    () =>
      new ShadowOrderProcessor(
        permissiveLedger,
        async () => malicious,
      ).process(decoded.input, 1_000),
    /detached from canonical witness replay/,
  );
  assert.equal(appendCalled, false);
});

async function validDecisionRecord(): Promise<ShadowTraceRecord> {
  const fixture = await buildUnapprovedReplayFixture();
  const authoritativeResults = fixture.authoritativeResults.map((entry) => ({
    ...entry,
    result: entry.result.code === "ELIGIBLE"
      ? {
          ...entry.result,
          required: fixture.input.order.usdcAmount * 2n,
        }
      : entry.result,
  }));
  const decoded = decodeReplayFixture(stringifyTaggedJson({
    ...fixture,
    authoritativeResults,
    expectedTraceId: undefined,
  }));
  const ledger = new InMemoryShadowTraceLedger();
  const result = await new ShadowOrderProcessor(ledger).process(
    decoded.input,
    1_000,
  );
  const record = await ledger.get(result.selection.trace.traceId);
  assert.ok(record !== null);
  assert.equal(record.serviceStatus, "SHADOW_DECISION");
  return record;
}

function rehashDecisionRecord(
  record: ShadowTraceRecord,
  mutate: (payload: Record<string, unknown>) => void,
): ShadowTraceRecord {
  const payload = requirePayloadRecord(
    JSON.parse(record.canonicalPayload) as unknown,
    "canonicalPayload",
  );
  mutate(payload);
  const outputRoot = canonicalMerkleRoot("p2pflow.shadow-output.v2", [
    {
      candidates: payload.candidates,
      leaseSchedule: payload.leaseSchedule,
    },
  ]);
  payload.outputRoot = outputRoot;
  const canonicalPayload = canonicalJson(payload);
  const traceId = hashCanonicalPayloadText(canonicalPayload);
  return {
    ...record,
    traceId,
    decisionId: traceId,
    outputRoot,
    canonicalPayload,
  };
}


function rehashWitnessRecord(
  record: ShadowTraceRecord,
  mutate: (witness: Record<string, unknown>) => void,
): ShadowTraceRecord {
  const witness = requirePayloadRecord(
    JSON.parse(record.canonicalWitness) as unknown,
    "canonicalWitness",
  );
  mutate(witness);
  const canonicalWitness = canonicalJson(witness);
  const witnessContentId = hashCanonicalPayloadText(canonicalWitness);
  const payload = requirePayloadRecord(
    JSON.parse(record.canonicalPayload) as unknown,
    "canonicalPayload",
  );
  payload.witnessContentId = witnessContentId;
  const canonicalPayload = canonicalJson(payload);
  const traceId = hashCanonicalPayloadText(canonicalPayload);
  return {
    ...record,
    traceId,
    decisionId: traceId,
    witnessContentId,
    canonicalWitness,
    canonicalPayload,
  };
}

function rehashEligibilityPrestateRecord(
  record: ShadowTraceRecord,
  mutate: (prestate: Record<string, unknown>) => void,
): ShadowTraceRecord {
  const witness = requirePayloadRecord(
    JSON.parse(record.canonicalWitness) as unknown,
    "canonicalWitness",
  );
  const prestates = requirePayloadObjectArray(
    witness.eligibilityPrestates,
    "witness.eligibilityPrestates",
  );
  mutate(requirePayloadEntry(prestates, 0, "witness.eligibilityPrestates"));
  const eligibilityPrestateRoot = canonicalMerkleRoot(
    "p2pflow.eligibility-prestate.v2",
    prestates,
  );
  const canonicalWitness = canonicalJson(witness);
  const witnessContentId = hashCanonicalPayloadText(canonicalWitness);
  const payload = requirePayloadRecord(
    JSON.parse(record.canonicalPayload) as unknown,
    "canonicalPayload",
  );
  payload.eligibilityPrestateRoot = eligibilityPrestateRoot;
  payload.witnessContentId = witnessContentId;
  const canonicalPayload = canonicalJson(payload);
  const traceId = hashCanonicalPayloadText(canonicalPayload);
  return {
    ...record,
    traceId,
    decisionId: traceId,
    eligibilityPrestateRoot,
    witnessContentId,
    canonicalWitness,
    canonicalPayload,
  };
}

function rehashDetachedUniverseRecord(
  record: ShadowTraceRecord,
): ShadowTraceRecord {
  const witness = requirePayloadRecord(
    JSON.parse(record.canonicalWitness) as unknown,
    "canonicalWitness",
  );
  const universeEntries = requirePayloadObjectArray(
    witness.universeEntries,
    "witness.universeEntries",
  );
  const target = requirePayloadEntry(
    universeEntries,
    0,
    "witness.universeEntries",
  );
  const targetMerchant = requirePayloadString(
    target.merchant,
    "witness.universeEntries[0].merchant",
  ).toLowerCase();
  const detachedSource = universeEntries.find((entry) => {
    const candidate = requirePayloadRecord(entry.candidate, "universe candidate");
    return requirePayloadString(candidate.merchant, "universe candidate merchant").toLowerCase() !==
      targetMerchant;
  });
  assert.ok(detachedSource !== undefined, "fixture needs two candidate merchants");
  target.candidate = detachedSource.candidate;

  const universeRoot = canonicalMerkleRoot(
    "p2pflow.candidate-universe.v1",
    universeEntries,
  );
  const canonicalWitness = canonicalJson(witness);
  const witnessContentId = hashCanonicalPayloadText(canonicalWitness);
  const payload = requirePayloadRecord(
    JSON.parse(record.canonicalPayload) as unknown,
    "canonicalPayload",
  );
  payload.universeRoot = universeRoot;
  payload.witnessContentId = witnessContentId;
  const canonicalPayload = canonicalJson(payload);
  const traceId = hashCanonicalPayloadText(canonicalPayload);
  return {
    ...record,
    traceId,
    decisionId: traceId,
    universeRoot,
    witnessContentId,
    canonicalWitness,
    canonicalPayload,
  };
}

function rehashAuthorityRecord(
  record: ShadowTraceRecord,
  chainId: number,
  diamond: `0x${string}`,
): ShadowTraceRecord {
  const witness = requirePayloadRecord(
    JSON.parse(record.canonicalWitness) as unknown,
    "canonicalWitness",
  );
  const input = requirePayloadRecord(witness.input, "witness.input");
  const order = requirePayloadRecord(input.order, "witness.input.order");
  const orderDomain = requirePayloadRecord(
    order.domain,
    "witness.input.order.domain",
  );
  order.chainId = chainId.toString();
  order.diamond = diamond;
  orderDomain.chainId = chainId.toString();
  const canonicalWitness = canonicalJson(witness);
  const witnessContentId = hashCanonicalPayloadText(canonicalWitness);

  const payload = requirePayloadRecord(
    JSON.parse(record.canonicalPayload) as unknown,
    "canonicalPayload",
  );
  const routingDomain = requirePayloadRecord(
    payload.routingDomain,
    "canonicalPayload.routingDomain",
  );
  payload.chainId = chainId.toString();
  payload.diamond = diamond;
  payload.witnessContentId = witnessContentId;
  routingDomain.chainId = chainId.toString();
  const canonicalPayload = canonicalJson(payload);
  const traceId = hashCanonicalPayloadText(canonicalPayload);
  return {
    ...record,
    chainId,
    traceId,
    decisionId: traceId,
    witnessContentId,
    canonicalWitness,
    canonicalPayload,
  };
}

function requirePayloadRecord(
  value: unknown,
  name: string,
): Record<string, unknown> {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${name} must be an object`,
  );
  return value as Record<string, unknown>;
}

function requirePayloadObjectArray(
  value: unknown,
  name: string,
): Record<string, unknown>[] {
  assert.ok(Array.isArray(value), `${name} must be an array`);
  return value.map((entry, index) =>
    requirePayloadRecord(entry, `${name}[${index}]`)
  );
}

function requirePayloadEntry(
  values: readonly Record<string, unknown>[],
  index: number,
  name: string,
): Record<string, unknown> {
  const value = values[index];
  assert.ok(value !== undefined, `${name}[${index}] must exist`);
  return value;
}

function requirePayloadString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string`);
  }
  return value;
}
