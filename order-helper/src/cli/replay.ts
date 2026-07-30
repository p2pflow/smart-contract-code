import { readFile, stat } from "node:fs/promises";
import { executeReplayDocument } from "../replay/document";
import { stringifyTaggedJson } from "../replay/fixture-codec";

const MAX_FIXTURE_BYTES = 64 * 1024 * 1024;

interface ReplayCliOptions {
  readonly inputPath: string;
  readonly pretty: boolean;
}

function parseArguments(arguments_: readonly string[]): ReplayCliOptions {
  let inputPath: string | null = null;
  let pretty = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--pretty") {
      pretty = true;
      continue;
    }
    if (argument === "--input") {
      const value = arguments_[index + 1];
      if (value === undefined || value.length === 0) {
        throw new TypeError("--input requires a file path");
      }
      inputPath = value;
      index += 1;
      continue;
    }
    throw new TypeError("Unsupported replay argument");
  }
  if (inputPath === null) {
    throw new TypeError("--input is required");
  }
  return { inputPath, pretty };
}

export async function runReplayCli(
  arguments_: readonly string[],
): Promise<void> {
  const options = parseArguments(arguments_);
  const metadata = await stat(options.inputPath);
  if (!metadata.isFile() || metadata.size > MAX_FIXTURE_BYTES) {
    throw new RangeError("Replay fixture is absent, not a file, or too large");
  }
  const source = await readFile(options.inputPath, "utf8");
  const replay = await executeReplayDocument(source);
  const selection = replay.selection;
  const output = {
    schema: "p2pflow.shadow-selection-replay-result.v1",
    capability: selection.trace.capability,
    actionAuthorization: false,
    traceId: selection.trace.traceId,
    expectedTraceMatched: replay.expectedTraceMatched,
    selection,
  };
  process.stdout.write(`${stringifyTaggedJson(output, options.pretty)}\n`);
}

if (require.main === module) {
  void runReplayCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({
        event: "replay_failed",
        errorCategory:
          error instanceof Error ? error.name : "UnknownError",
      })}\n`,
    );
    process.exitCode = 1;
  });
}
