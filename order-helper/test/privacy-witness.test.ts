import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeReplayFixture,
  executeReplayFixture,
  stringifyTaggedJson,
} from "../src/replay/fixture-codec";
import { buildUnapprovedReplayFixture } from "../src/replay/unapproved-fixture";

test("provider prose cannot enter a canonical witness or decision payload", async () => {
  const fixture = await buildUnapprovedReplayFixture();
  const sentinel = "SENSITIVE_PAYMENT_IDENTIFIER_SENTINEL";
  const authoritativeResults = fixture.authoritativeResults.map(
    (entry, index) => ({
      ...entry,
      result: index === 0
        ? {
            ...entry.result,
            code: "AUTHORITATIVE_CHECK_UNAVAILABLE" as const,
            required: 0n,
            available: 0n,
            detail: sentinel,
          }
        : { ...entry.result, detail: sentinel },
    }),
  );
  const replayed = await executeReplayFixture(
    decodeReplayFixture(
      stringifyTaggedJson({
        ...fixture,
        authoritativeResults,
        expectedTraceId: undefined,
      }),
    ),
  );

  assert.ok(replayed.outcome.excluded.length > 0);
  assert.doesNotMatch(replayed.trace.canonicalWitness, /detail/);
  assert.doesNotMatch(replayed.trace.canonicalWitness, new RegExp(sentinel));
  assert.doesNotMatch(replayed.trace.canonicalPayload, new RegExp(sentinel));
  assert.doesNotMatch(
    stringifyTaggedJson(replayed.outcome),
    new RegExp(sentinel),
  );
});
