// scripts/upgradeMerchantFacet.js
//
// Upgrade MerchantFacet on the live diamond: Replace 24 existing selectors from
// the new facet, and REMOVE the now-deleted `setChannelLimits(bytes32,uint256,uint256)`
// selector so no one can call it anymore. Stock `upgrade.js` doesn't handle removal.
//
// Usage:
//   npx hardhat run scripts/upgradeMerchantFacet.js --network sepolia

require("dotenv").config();
const { ethers } = require("hardhat");

async function main() {
  const diamondAddress = process.env.DIAMOND_ADDRESS;
  if (!diamondAddress) throw new Error("DIAMOND_ADDRESS is not set");

  const [deployer] = await ethers.getSigners();
  console.log("Signer:  ", deployer.address);
  console.log("Diamond: ", diamondAddress);

  console.log("\nDeploying new MerchantFacet...");
  const NewFacet = await ethers.deployContract("MerchantFacet");
  await NewFacet.waitForDeployment();
  const newAddress = await NewFacet.getAddress();
  console.log("MerchantFacet:", newAddress);

  const dc = await ethers.getContractAt("IDiamondCut", diamondAddress);
  const loupe = await ethers.getContractAt("IDiamondLoupe", diamondAddress);

  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };

  const newSelectors = NewFacet.interface.fragments
    .filter((f) => f.type === "function")
    .map((f) => ethers.id(f.format("sighash")).slice(0, 10));

  // The selector we deleted from the source. Removing it is REQUIRED — otherwise
  // the diamond keeps routing it to the OLD facet address and admin can still call
  // the deprecated function.
  const removedSelector = ethers.id(
    "setChannelLimits(bytes32,uint256,uint256)"
  ).slice(0, 10);
  console.log("Removing selector:", removedSelector);

  const currentOwner = await loupe.facetAddress(removedSelector);
  if (currentOwner === ethers.ZeroAddress) {
    console.log("  (already absent — nothing to remove)");
  } else {
    console.log("  currently routes to:", currentOwner);
  }

  const toReplace = [];
  const toAdd = [];
  for (const sel of newSelectors) {
    const owner = await loupe.facetAddress(sel);
    if (owner !== ethers.ZeroAddress) toReplace.push(sel);
    else toAdd.push(sel);
  }

  const cut = [];
  if (toReplace.length > 0) {
    cut.push({
      facetAddress: newAddress,
      action: FacetCutAction.Replace,
      functionSelectors: toReplace,
    });
    console.log(`  → Replace ${toReplace.length} selectors`);
  }
  if (toAdd.length > 0) {
    cut.push({
      facetAddress: newAddress,
      action: FacetCutAction.Add,
      functionSelectors: toAdd,
    });
    console.log(`  → Add ${toAdd.length} selectors`);
  }
  if (currentOwner !== ethers.ZeroAddress) {
    cut.push({
      facetAddress: ethers.ZeroAddress, // Remove requires address(0)
      action: FacetCutAction.Remove,
      functionSelectors: [removedSelector],
    });
    console.log("  → Remove 1 selector (setChannelLimits)");
  }

  console.log("\nExecuting diamondCut...");
  const tx = await dc.diamondCut(cut, ethers.ZeroAddress, "0x");
  const receipt = await tx.wait();
  if (!receipt.status) throw new Error("diamondCut failed");
  console.log("Tx:", tx.hash);

  // Verify
  const afterOwner = await loupe.facetAddress(removedSelector);
  if (afterOwner !== ethers.ZeroAddress) {
    throw new Error(
      `setChannelLimits still routes to ${afterOwner} — removal failed`
    );
  }
  console.log("✅ MerchantFacet upgraded; setChannelLimits removed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
