const { expect } = require("chai");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { network, userConfig } = require("hardhat");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const {
  COUNCIL_BILL_SHA256,
  COUNCIL_VERDICT,
  assertCouncilLocalSimulation,
} = require("../scripts/councilGate");

describe("council safety gate", function () {
  it("pins the rejected bill and permits only local simulations", function () {
    expect(COUNCIL_VERDICT).to.equal("REJECT");
    expect(COUNCIL_BILL_SHA256).to.equal(
      "4295e790fd8f4e96e17fd54e033c4004bce7ed18aafc5a6c5bbda8d6f4931916",
    );
    expect(() =>
      assertCouncilLocalSimulation(
        network.name,
        "resolved-config test",
        network.config,
        userConfig,
      ),
    ).not.to.throw();
    expect(() =>
      assertCouncilLocalSimulation("localhost", "test", network.config, userConfig),
    ).to.throw(/Council verdict REJECT/);
    expect(() =>
      assertCouncilLocalSimulation("baseSepolia", "test", network.config, userConfig),
    ).to.throw(/Council verdict REJECT/);
    expect(() =>
      assertCouncilLocalSimulation("hardhat", "test", {
        ...network.config,
        forking: { enabled: true, url: "https://example.invalid" },
      }, userConfig),
    ).to.throw(/Council verdict REJECT/);
    expect(() =>
      assertCouncilLocalSimulation(
        "hardhat",
        "test",
        { ...network.config, accounts: ["0xdead"] },
        userConfig,
      ),
    ).to.throw(/Council verdict REJECT/);
  });

  it("rejects every customized in-process Hardhat setting", function () {
    const customConfigs = [
      { ...network.config, chainId: 84532 },
      { ...network.config, hardfork: "cancun" },
      { ...network.config, gas: 21_000_000 },
      {
        ...network.config,
        mining: { ...network.config.mining, interval: 1 },
      },
      {
        ...network.config,
        accounts: { ...network.config.accounts, path: "m/44'/60'/1'/0" },
      },
      {
        ...network.config,
        accounts: { ...network.config.accounts, initialIndex: 1 },
      },
      {
        ...network.config,
        accounts: { ...network.config.accounts, count: 1 },
      },
      {
        ...network.config,
        accounts: { ...network.config.accounts, accountsBalance: "1" },
      },
      {
        ...network.config,
        accounts: { ...network.config.accounts, passphrase: "custom" },
      },
      {
        ...network.config,
        accounts: { ...network.config.accounts, mnemonic: "not the default mnemonic" },
      },
    ];

    for (const customConfig of customConfigs) {
      expect(() =>
        assertCouncilLocalSimulation("hardhat", "test", customConfig, userConfig),
      ).to.throw(/Council verdict REJECT/);
    }

    expect(() =>
      assertCouncilLocalSimulation("hardhat", "test", network.config),
    ).to.throw(/Council verdict REJECT/);
    expect(() =>
      assertCouncilLocalSimulation("hardhat", "test", network.config, {
        ...userConfig,
        networks: { ...(userConfig.networks || {}), hardhat: {} },
      }),
    ).to.throw(/Council verdict REJECT/);
  });

  it("fails external package entrypoints without credentials", function () {
    const result = spawnSync(process.execPath, ["scripts/councilGate.js", "testnet write"], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
    });
    expect(result.status).to.equal(1);
    expect(result.stdout).to.equal("");
    expect(result.stderr).to.include(COUNCIL_BILL_SHA256);
    expect(result.stderr).to.include("testnet write is disabled");
  });

  it("does not load dotenv, private keys, RPC URLs, or remote Hardhat networks", function () {
    const config = read("hardhat.config.js");
    for (const forbidden of [
      "dotenv",
      "PRIVATE_KEY",
      "DEPLOYER_PRIVATE_KEY",
      "RPC_URL",
      "sepolia:",
      "baseSepolia:",
      "localhost:",
      "accounts:",
    ]) {
      expect(config).not.to.include(forbidden);
    }
  });

  it("routes every packaged testnet mutation to the rejection helper", function () {
    const scripts = JSON.parse(read("package.json")).scripts;
    for (const name of [
      "deploy:sepolia",
      "deploy:base-sepolia",
      "deploy:mock-usdc:base-sepolia",
      "upgrade:sepolia",
      "upgrade:base-sepolia",
    ]) {
      expect(scripts[name]).to.equal(`node scripts/councilGate.js ${name}`);
    }
  });

  it("gates direct state-changing Hardhat scripts before signer access", function () {
    for (const relative of [
      "scripts/deploy.js",
      "scripts/deployMockUsdc.js",
      "scripts/upgrade.js",
      "scripts/upgradeMerchantFacet.js",
      "scripts/setChannelDefaults.js",
    ]) {
      const source = read(relative);
      const main = source.indexOf("async function main");
      const gate = source.indexOf("assertCouncilLocalSimulation(", main);
      const signer = source.indexOf("ethers.getSigners()");
      expect(gate, `${relative} lacks the council network gate`).to.be.greaterThan(-1);
      expect(signer, `${relative} lacks signer access`).to.be.greaterThan(-1);
      expect(gate, `${relative} gates too late`).to.be.lessThan(signer);
      expect(source).not.to.include('require("dotenv").config()');
      expect(source).to.include("network.config");
      expect(source).to.include("userConfig");
    }
  });

  it("disables the legacy live smoke script before env, RPC, or payment data", function () {
    const source = read("scripts/smokeTest.js");
    expect(source).to.include("rejectExternalAction");
    for (const forbidden of [
      "dotenv",
      "process.env",
      'require("hardhat")',
      "telegramUsername",
      "bankName",
      "accountLast4",
      "upiId",
    ]) {
      expect(source).not.to.include(forbidden);
    }
  });

  it("owns and verifies a fresh loopback-only stress chain", function () {
    const source = read("scripts/stressTest.js");
    expect(source).to.include('const DEV_CHAIN_HOST = "127.0.0.1"');
    expect(source).to.include("allocateLoopbackPort");
    expect(source).to.include('"node"');
    expect(source).to.include('"--hostname", DEV_CHAIN_HOST');
    expect(source).to.include("const HARDHAT_CLI = path.join(PROJECT_ROOT");
    expect(source).to.include("process.execPath");
    expect(source).to.include("cwd: PROJECT_ROOT");
    expect(source).to.include('PATH: "/usr/local/bin:/usr/bin:/bin"');
    expect(source).not.to.include("process.env.PATH");
    expect(source).to.include("hardhat_metadata");
    expect(source).to.include("metadata.instanceId !== devChainInstanceId");
    expect(source).to.include("metadata.forkedNetwork");
    expect(source).to.include("await stopOwnedDevChain()");
    expect(source).to.include('child.kill("SIGKILL")');
    expect(source).to.include("crypto.randomInt");
    expect(source).to.include("createUniqueHardhatConfig");
    expect(source).not.to.include("const EXPECTED_CHAIN_ID");
    expect(source).to.include("EXPECTED_FIRST_ACCOUNT");
    expect(source).to.include('stdio: "ignore"');
    expect(source).not.to.include("process.env.ANVIL");
    expect(source).not.to.include("process.env.STRESS_VERBOSE");
    expect(source).not.to.include("reusing anvil");
  });
});
