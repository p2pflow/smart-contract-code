const COUNCIL_VERDICT = "REJECT";
const COUNCIL_BILL_SHA256 =
  "4295e790fd8f4e96e17fd54e033c4004bce7ed18aafc5a6c5bbda8d6f4931916";

function blockedMessage(action) {
  return `Council verdict ${COUNCIL_VERDICT} (${COUNCIL_BILL_SHA256}); ${action} is disabled`;
}

function assertCouncilLocalSimulation(networkName, action) {
  if (networkName !== "hardhat" && networkName !== "localhost") {
    throw new Error(blockedMessage(`${action} on network ${networkName || "unknown"}`));
  }
}

function rejectExternalAction(action) {
  throw new Error(blockedMessage(action));
}

if (require.main === module) {
  const action = process.argv.slice(2).join(" ") || "external state change";
  try {
    rejectExternalAction(action);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  COUNCIL_BILL_SHA256,
  COUNCIL_VERDICT,
  assertCouncilLocalSimulation,
  rejectExternalAction,
};
