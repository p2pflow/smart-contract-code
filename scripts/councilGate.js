const COUNCIL_VERDICT = "REJECT";
const COUNCIL_BILL_SHA256 =
  "4295e790fd8f4e96e17fd54e033c4004bce7ed18aafc5a6c5bbda8d6f4931916";
const { isDeepStrictEqual } = require("node:util");

function blockedMessage(action) {
  return `Council verdict ${COUNCIL_VERDICT} (${COUNCIL_BILL_SHA256}); ${action} is disabled`;
}

const DEFAULT_HARDHAT_MNEMONIC =
  "test test test test test test test test test test test junk";

const DEFAULT_HARDHAT_NETWORK_CONFIG = Object.freeze({
  hardfork: "osaka",
  blockGasLimit: 60_000_000,
  gasPrice: "auto",
  chainId: 31_337,
  throwOnTransactionFailures: true,
  throwOnCallFailures: true,
  allowUnlimitedContractSize: false,
  mining: Object.freeze({
    auto: true,
    interval: 0,
    mempool: Object.freeze({ order: "priority" }),
  }),
  accounts: Object.freeze({
    initialIndex: 0,
    count: 20,
    path: "m/44'/60'/0'/0",
    passphrase: "",
    mnemonic: DEFAULT_HARDHAT_MNEMONIC,
    accountsBalance: "10000000000000000000000",
  }),
  loggingEnabled: false,
  gasMultiplier: 1,
  minGasPrice: 0n,
  chains: "<hardhat-defaults>",
  gas: 16_777_216,
  initialDate: "<runtime-generated>",
  ignition: "<hardhat-defaults>",
});

function normalizeResolvedHardhatConfig(networkConfig) {
  if (
    !networkConfig ||
    typeof networkConfig !== "object" ||
    Array.isArray(networkConfig) ||
    typeof networkConfig.initialDate !== "string" ||
    Number.isNaN(Date.parse(networkConfig.initialDate)) ||
    new Date(networkConfig.initialDate).toISOString() !== networkConfig.initialDate
  ) {
    return null;
  }
  if (!(networkConfig.chains instanceof Map) || !networkConfig.ignition) {
    return null;
  }

  return {
    ...networkConfig,
    chains: "<hardhat-defaults>",
    initialDate: "<runtime-generated>",
    ignition: "<hardhat-defaults>",
  };
}

function assertCouncilLocalSimulation(
  networkName,
  action,
  networkConfig,
  userConfig,
) {
  if (networkName !== "hardhat") {
    throw new Error(blockedMessage(`${action} on network ${networkName || "unknown"}`));
  }

  if (
    !userConfig ||
    typeof userConfig !== "object" ||
    Array.isArray(userConfig) ||
    Object.prototype.hasOwnProperty.call(userConfig.networks || {}, "hardhat") ||
    Object.prototype.hasOwnProperty.call(userConfig, "ignition")
  ) {
    throw new Error(blockedMessage(`${action} with a configured Hardhat network`));
  }

  const normalizedConfig = normalizeResolvedHardhatConfig(networkConfig);
  if (!isDeepStrictEqual(normalizedConfig, DEFAULT_HARDHAT_NETWORK_CONFIG)) {
    throw new Error(blockedMessage(`${action} with non-default Hardhat settings`));
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
