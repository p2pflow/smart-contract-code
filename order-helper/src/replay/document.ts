import { ShadowSelectionResult } from "../selection";
import {
  decodeReplayFixture,
  executeReplayFixture,
  ReplayFixtureError,
} from "./fixture-codec";
import {
  decodeWitnessReplay,
  executeWitnessReplay,
  SHADOW_WITNESS_SCHEMA,
} from "./witness-codec";

const REPLAY_FIXTURE_SCHEMA = "p2pflow.shadow-selection-replay.v1";

export interface ExecutedReplayDocument {
  readonly kind: "fixture" | "witness";
  readonly selection: ShadowSelectionResult;
  readonly expectedTraceMatched: boolean;
}

export async function executeReplayDocument(
  source: string,
): Promise<ExecutedReplayDocument> {
  const schema = readDocumentSchema(source);
  if (schema === SHADOW_WITNESS_SCHEMA) {
    const replay = decodeWitnessReplay(source);
    return {
      kind: "witness",
      selection: await executeWitnessReplay(replay),
      expectedTraceMatched: true,
    };
  }
  if (schema === REPLAY_FIXTURE_SCHEMA) {
    const fixture = decodeReplayFixture(source);
    return {
      kind: "fixture",
      selection: await executeReplayFixture(fixture),
      expectedTraceMatched: fixture.expectedTraceId !== null,
    };
  }
  throw new ReplayFixtureError("Unsupported replay document schema");
}

function readDocumentSchema(source: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    throw new ReplayFixtureError("Replay document is not valid JSON");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new ReplayFixtureError("Replay document must be an object");
  }
  return (parsed as Record<string, unknown>).schema;
}
