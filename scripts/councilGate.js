const COUNCIL_VERDICT = "REJECT";
const COUNCIL_BILL_SHA256 =
  "4295e790fd8f4e96e17fd54e033c4004bce7ed18aafc5a6c5bbda8d6f4931916";

function blockedMessage(action) {
  return `Council verdict ${COUNCIL_VERDICT} (${COUNCIL_BILL_SHA256}); ${action} is disabled`;
}

const DEFAULT_HARDHAT_MNEMONIC =
  "test test test test test test test test test test test junk";

function assertCouncilLocalSimulation(networkName, action, networkConfig = {}) {
  if (networkName !== "hardhat") {
    throw new Error(blockedMessage(`${action} on network ${networkName || "unknown"}`));
  }
  if (networkConfig.forking && (networkConfig.forking.enabled || networkConfig.forking.url)) {
    throw new Error(blockedMessage(`${action} on a forked Hardhat network`));
  }
  if (Array.isArray(networkConfig.accounts)) {
    throw new Error(blockedMessage(`${action} with explicit signer accounts`));
  }
  if (
    networkConfig.accounts &&
    networkConfig.accounts.mnemonic &&
    networkConfig.accounts.mnemonic !== DEFAULT_HARDHAT_MNEMONIC
  ) {
    throw new Error(blockedMessage(`${action} with a non-development mnemonic`));
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
