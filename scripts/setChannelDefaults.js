// scripts/setChannelDefaults.js
//
// Local simulation helper: after `upgrade.js` cuts in the new ConfigFacet, seed
// platform-wide default channel volume limits. External networks are rejected.

const { ethers, network, userConfig } = require("hardhat");
const { assertCouncilLocalSimulation } = require("./councilGate");

async function main() {
  assertCouncilLocalSimulation(
    network.name,
    "channel-default mutation",
    network.config,
    userConfig,
  );
  const diamondAddress = process.env.DIAMOND_ADDRESS;
  if (!diamondAddress) throw new Error("DIAMOND_ADDRESS is not set for the local simulation");

  const dailyHuman = process.env.DAILY_USDC || "600";
  const monthlyHuman = process.env.MONTHLY_USDC || "6200";

  const daily = ethers.parseUnits(dailyHuman, 6);
  const monthly = ethers.parseUnits(monthlyHuman, 6);

  const [signer] = await ethers.getSigners();
  console.log("Signer:          ", signer.address);
  console.log("Diamond:         ", diamondAddress);
  console.log("Target defaults: ", `${dailyHuman} USDC / day, ${monthlyHuman} USDC / month`);

  const config = await ethers.getContractAt("ConfigFacet", diamondAddress);
  const before = await config.getChannelLimitDefaults();
  console.log("Before:          ", ethers.formatUnits(before[0], 6), "/", ethers.formatUnits(before[1], 6));

  const tx = await config.setDefaultChannelLimits(daily, monthly);
  console.log("Tx submitted:    ", tx.hash);
  const receipt = await tx.wait();
  if (!receipt.status) throw new Error("setDefaultChannelLimits reverted");

  const after = await config.getChannelLimitDefaults();
  console.log("After:           ", ethers.formatUnits(after[0], 6), "/", ethers.formatUnits(after[1], 6));
  console.log("✅ Defaults updated");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
