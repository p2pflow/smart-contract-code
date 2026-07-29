const { rejectExternalAction } = require("./councilGate");

try {
  rejectExternalAction(
    "legacy live smoke test (use the redacted, read-only provenance CLIs instead)",
  );
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
