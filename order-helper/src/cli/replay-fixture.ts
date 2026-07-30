import { stringifyTaggedJson } from "../replay/fixture-codec";
import { buildUnapprovedReplayFixture } from "../replay/unapproved-fixture";

async function main(): Promise<void> {
  const fixture = await buildUnapprovedReplayFixture();
  process.stdout.write(`${stringifyTaggedJson(fixture, true)}\n`);
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({
        event: "replay_fixture_generation_failed",
        errorCategory:
          error instanceof Error ? error.name : "UnknownError",
      })}\n`,
    );
    process.exitCode = 1;
  });
}
