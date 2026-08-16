require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 84532,
    },
    localhost: {
      url: process.env.P2PFLOW_HARDHAT_RPC_URL || "http://127.0.0.1:8545",
    },
  },
};
