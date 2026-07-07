// scripts/deploy.js
//
// Deploy Diamond + core EIP-2535 facets + MerchantFacet; init via DiamondInit.
// Run: npx hardhat run scripts/deploy.js --network localhost

const { ethers } = require("hardhat");

function getSelectors(contract) {
  const signatures = contract.interface.fragments
    .filter((f) => f.type === "function")
    .map((f) => f.format("sighash"));

  return signatures.map((sig) => ethers.id(sig).slice(0, 10));
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  console.log("\n── Deploying facets...");

  const DiamondCutFacet = await ethers.deployContract("DiamondCutFacet");
  await DiamondCutFacet.waitForDeployment();
  console.log("DiamondCutFacet:  ", await DiamondCutFacet.getAddress());

  const DiamondLoupeFacet = await ethers.deployContract("DiamondLoupeFacet");
  await DiamondLoupeFacet.waitForDeployment();
  console.log("DiamondLoupeFacet:", await DiamondLoupeFacet.getAddress());

  const OwnershipFacet = await ethers.deployContract("OwnershipFacet");
  await OwnershipFacet.waitForDeployment();
  console.log("OwnershipFacet:   ", await OwnershipFacet.getAddress());

  const ConfigFacet = await ethers.deployContract("ConfigFacet");
  await ConfigFacet.waitForDeployment();
  console.log("ConfigFacet:      ", await ConfigFacet.getAddress());

  const MerchantFacet = await ethers.deployContract("MerchantFacet");
  await MerchantFacet.waitForDeployment();
  console.log("MerchantFacet:    ", await MerchantFacet.getAddress());

  const OrderFacet = await ethers.deployContract("OrderFacet");
  await OrderFacet.waitForDeployment();
  console.log("OrderFacet:       ", await OrderFacet.getAddress());

  console.log("\n── Deploying Diamond proxy...");
  const Diamond = await ethers.deployContract("Diamond", [
    deployer.address,
    await DiamondCutFacet.getAddress(),
  ]);
  await Diamond.waitForDeployment();
  const diamondAddress = await Diamond.getAddress();
  console.log("Diamond:          ", diamondAddress);

  const diamondCut = await ethers.getContractAt("IDiamondCut", diamondAddress);

  const DiamondInit = await ethers.deployContract("DiamondInit");
  await DiamondInit.waitForDeployment();
  console.log("DiamondInit:      ", await DiamondInit.getAddress());

  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };

  const cut = [
    {
      facetAddress: await DiamondLoupeFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(DiamondLoupeFacet),
    },
    {
      facetAddress: await OwnershipFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(OwnershipFacet),
    },
    {
      facetAddress: await ConfigFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(ConfigFacet),
    },
    {
      facetAddress: await MerchantFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(MerchantFacet),
    },
    {
      facetAddress: await OrderFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(OrderFacet),
    },
  ];

  const USDC_ADDRESS =
    process.env.USDC_ADDRESS || "0x052FA28895F1dd4A8fdF7c373c9dB6F35F1604e9";
  const MIN_MERCHANT_STAKE = process.env.MIN_MERCHANT_STAKE_USDC || "300000000"; // 1 USDC if 6 decimals
  // Default per-channel volume ceilings (USDC 6d). Overridable via env; `0` on both
  // means unlimited. `600 * 1e6` and `6200 * 1e6`.
  const DEFAULT_CHANNEL_DAILY_LIMIT_USDC =
    process.env.DEFAULT_CHANNEL_DAILY_LIMIT_USDC || "600000000";
  const DEFAULT_CHANNEL_MONTHLY_LIMIT_USDC =
    process.env.DEFAULT_CHANNEL_MONTHLY_LIMIT_USDC || "6200000000";
  // Order-engine hardcoded oracle prices (INR per whole USDC).
  const BUY_PRICE_INR_PER_USDC = process.env.BUY_PRICE_INR_PER_USDC || "95";
  const SELL_PRICE_INR_PER_USDC = process.env.SELL_PRICE_INR_PER_USDC || "90";
  // Dispute window for SELL orders (default 10 min).
  const DISPUTE_WINDOW_SECONDS =
    process.env.DISPUTE_WINDOW_SECONDS || "600";

  const initCalldata = DiamondInit.interface.encodeFunctionData("init", [
    USDC_ADDRESS,
    MIN_MERCHANT_STAKE,
    DEFAULT_CHANNEL_DAILY_LIMIT_USDC,
    DEFAULT_CHANNEL_MONTHLY_LIMIT_USDC,
    BUY_PRICE_INR_PER_USDC,
    SELL_PRICE_INR_PER_USDC,
    DISPUTE_WINDOW_SECONDS,
  ]);

  console.log("\n── Running initial diamondCut...");
  const tx = await diamondCut.diamondCut(
    cut,
    await DiamondInit.getAddress(),
    initCalldata
  );
  const receipt = await tx.wait();
  if (!receipt.status) throw new Error("diamondCut failed");
  console.log("DiamondCut completed. Tx:", tx.hash);

  console.log("\n✅ Deployment complete");
  console.log("─────────────────────────────────────────");
  console.log("Diamond (proxy):  ", diamondAddress);
  console.log("DiamondCutFacet:  ", await DiamondCutFacet.getAddress());
  console.log("DiamondLoupeFacet:", await DiamondLoupeFacet.getAddress());
  console.log("OwnershipFacet:   ", await OwnershipFacet.getAddress());
  console.log("ConfigFacet:      ", await ConfigFacet.getAddress());
  console.log("MerchantFacet:    ", await MerchantFacet.getAddress());
  console.log("OrderFacet:       ", await OrderFacet.getAddress());
  console.log("─────────────────────────────────────────");
  console.log("Diamond owner:   ", deployer.address);
  console.log("Platform admin:  ", deployer.address, "(set in DiamondInit)");
  console.log("USDC:            ", USDC_ADDRESS);
  console.log("BUY price (INR): ", BUY_PRICE_INR_PER_USDC);
  console.log("SELL price (INR):", SELL_PRICE_INR_PER_USDC);
  console.log("Dispute window:  ", DISPUTE_WINDOW_SECONDS, "seconds");

  const addresses = {
    diamond: diamondAddress,
    diamondCutFacet: await DiamondCutFacet.getAddress(),
    diamondLoupeFacet: await DiamondLoupeFacet.getAddress(),
    ownershipFacet: await OwnershipFacet.getAddress(),
    configFacet: await ConfigFacet.getAddress(),
    merchantFacet: await MerchantFacet.getAddress(),
    orderFacet: await OrderFacet.getAddress(),
    diamondInit: await DiamondInit.getAddress(),
  };

  const fs = require("fs");
  fs.writeFileSync(
    "./deployed-addresses.json",
    JSON.stringify(addresses, null, 2)
  );
  console.log("\nAddresses saved to deployed-addresses.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
