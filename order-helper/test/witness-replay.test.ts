import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../src/canonical/canonical-json";
import { executeReplayDocument } from "../src/replay/document";
import {
  decodeReplayFixture,
  executeReplayFixture,
  stringifyTaggedJson,
} from "../src/replay/fixture-codec";
import { buildUnapprovedReplayFixture } from "../src/replay/unapproved-fixture";
import {
  decodeWitnessReplay,
  executeWitnessReplay,
  WitnessReplayError,
} from "../src/replay/witness-codec";
import { ShadowSelectionResult } from "../src/selection";

interface GeneratedReplayDocuments {
  readonly fixtureSource: string;
  readonly selection: ShadowSelectionResult;
  readonly witness: string;
}

async function generateReplayDocuments(): Promise<GeneratedReplayDocuments> {
  const fixture = await buildUnapprovedReplayFixture();
  const fixtureSource = stringifyTaggedJson(fixture);
  const selection = await executeReplayFixture(
    decodeReplayFixture(fixtureSource),
  );
  return {
    fixtureSource,
    selection,
    witness: selection.trace.canonicalWitness,
  };
}

function parseRecord(source: string): Record<string, unknown> {
  const parsed = JSON.parse(source) as unknown;
  return requireRecord(parsed, "document");
}

function requireRecord(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArrayField(
  record: Record<string, unknown>,
  field: string,
): unknown[] {
  const value = record[field];
  if (!Array.isArray(value)) {
    throw new TypeError(`${field} must be an array`);
  }
  return value;
}

test("persisted witness replays with identical content, trace, and evidence roots", async () => {
  const generated = await generateReplayDocuments();
  const decoded = decodeWitnessReplay(generated.witness);
  const replayed = await executeWitnessReplay(decoded);

  assert.equal(replayed.trace.traceId, generated.selection.trace.traceId);
  assert.equal(replayed.trace.traceId, decoded.expectedTraceId);
  assert.equal(
    replayed.trace.witnessContentId,
    decoded.witnessContentId,
  );
  assert.equal(replayed.trace.universeRoot, decoded.universeRoot);
  assert.equal(
    replayed.trace.eligibilityPrestateRoot,
    decoded.eligibilityPrestateRoot,
  );
  assert.equal(replayed.trace.outputRoot, decoded.outputRoot);
  assert.equal(replayed.trace.canonicalWitness, generated.witness);
  assert.equal(
    replayed.trace.canonicalPayload,
    decoded.expectedCanonicalPayload,
  );
  assert.equal(replayed.trace.actionAuthorization, false);
});

test("persisted no-service witness replays through the same decoder", async () => {
  const fixture = await buildUnapprovedReplayFixture();
  const candidates = fixture.input.candidates.slice(0, 3);
  const merchants = new Set(
    candidates.map((candidate) => candidate.merchant.toLowerCase()),
  );
  const noServiceFixture = {
    ...fixture,
    expectedTraceId: undefined,
    input: {
      ...fixture.input,
      candidates,
      operators: fixture.input.operators.filter((operator) =>
        operator.wallets.some((wallet) =>
          merchants.has(wallet.toLowerCase())
        )
      ),
      universe: {
        ...fixture.input.universe,
        expectedEntryCount: candidates.length,
      },
    },
    authoritativeResults: fixture.authoritativeResults.filter((entry) =>
      merchants.has(entry.merchant.toLowerCase())
    ),
  };
  const selected = await executeReplayFixture(
    decodeReplayFixture(stringifyTaggedJson(noServiceFixture)),
  );
  const replayed = await executeWitnessReplay(
    decodeWitnessReplay(selected.trace.canonicalWitness),
  );

  assert.equal(replayed.trace.serviceStatus, "NO_SERVICE");
  assert.equal(
    replayed.trace.noServiceReason,
    "NO_FOUR_ELIGIBLE_OPERATORS",
  );
  assert.equal(replayed.trace.traceId, selected.trace.traceId);
});

test("replay document dispatch preserves fixtures and accepts witnesses", async () => {
  const generated = await generateReplayDocuments();
  const fixtureReplay = await executeReplayDocument(
    generated.fixtureSource,
  );
  const witnessReplay = await executeReplayDocument(generated.witness);

  assert.equal(fixtureReplay.kind, "fixture");
  assert.equal(fixtureReplay.expectedTraceMatched, true);
  assert.equal(
    fixtureReplay.selection.trace.traceId,
    generated.selection.trace.traceId,
  );
  assert.equal(witnessReplay.kind, "witness");
  assert.equal(witnessReplay.expectedTraceMatched, true);
  assert.equal(
    witnessReplay.selection.trace.traceId,
    generated.selection.trace.traceId,
  );
});

test("witness decoder rejects noncanonical JSON text", async () => {
  const generated = await generateReplayDocuments();
  const pretty = JSON.stringify(JSON.parse(generated.witness), null, 2);
  assert.throws(
    () => decodeWitnessReplay(pretty),
    WitnessReplayError,
  );
});

test("witness decoder rejects incomplete eligible candidate-channel evidence", async () => {
  const generated = await generateReplayDocuments();
  const witness = parseRecord(generated.witness);
  const prestates = requireArrayField(witness, "eligibilityPrestates");
  const eligibleIndex = prestates.findIndex((value) => {
    const record = requireRecord(value, "eligibility prestate");
    return record.eligibilityCode === "ELIGIBLE";
  });
  assert.notEqual(eligibleIndex, -1);
  prestates.splice(eligibleIndex, 1);

  assert.throws(
    () => decodeWitnessReplay(canonicalJson(witness)),
    WitnessReplayError,
  );
});

test("witness decoder rejects ambiguous candidate-channel evidence", async () => {
  const generated = await generateReplayDocuments();
  const witness = parseRecord(generated.witness);
  const prestates = requireArrayField(witness, "eligibilityPrestates");
  const first = prestates[0];
  assert.ok(first !== undefined);
  prestates.push(first);

  assert.throws(
    () => decodeWitnessReplay(canonicalJson(witness)),
    WitnessReplayError,
  );
});

test("witness decoder rejects universe evidence detached from input", async () => {
  const generated = await generateReplayDocuments();
  const witness = parseRecord(generated.witness);
  const entries = requireArrayField(witness, "universeEntries");
  const firstEntry = requireRecord(entries[0], "universe entry");
  const candidate = requireRecord(firstEntry.candidate, "entry candidate");
  const observedAtBlock = candidate.observedAtBlock;
  if (typeof observedAtBlock !== "string") {
    throw new TypeError("observedAtBlock must be a string");
  }
  candidate.observedAtBlock = (BigInt(observedAtBlock) + 1n).toString(10);

  assert.throws(
    () => decodeWitnessReplay(canonicalJson(witness)),
    WitnessReplayError,
  );
});

test("witness decoder rejects a detached output root", async () => {
  const generated = await generateReplayDocuments();
  const witness = parseRecord(generated.witness);
  const output = requireRecord(witness.output, "witness output");
  output.outputRoot = `0x${"00".repeat(32)}`;

  assert.throws(
    () => decodeWitnessReplay(canonicalJson(witness)),
    WitnessReplayError,
  );
});

test("selector comparison rejects canonical witness content detached from replay", async () => {
  const generated = await generateReplayDocuments();
  const witness = parseRecord(generated.witness);
  const prestates = requireArrayField(witness, "eligibilityPrestates");
  const firstPrestate = requireRecord(prestates[0], "eligibility prestate");
  const exclusions = requireArrayField(witness, "exclusions");
  exclusions.push({
    merchant: firstPrestate.merchant,
    channelId: firstPrestate.channelId,
    result: {
      code: "ORDER_NOT_OPEN",
      required: "0",
      available: "0",
      source: "snapshot",
      checkedAtBlock: firstPrestate.checkedAtBlock,
    },
  });

  const decoded = decodeWitnessReplay(canonicalJson(witness));
  await assert.rejects(
    () => executeWitnessReplay(decoded),
    WitnessReplayError,
  );
});
