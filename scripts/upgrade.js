// scripts/upgrade.js
//
// Redeploy and re-attach only the facets listed in REPLACE_FACETS env var.
// Usage:
//   REPLACE_FACETS=MerchantFacet,ConfigFacet npx hardhat run scripts/upgrade.js --network sepolia
//   (or set REPLACE_FACETS in your .env)
//
// Supported facet names: DiamondCutFacet, DiamondLoupeFacet, OwnershipFacet, ConfigFacet, MerchantFacet

require("dotenv").config();
const { ethers } = require("hardhat");

// ── helpers ──────────────────────────────────────────────────────────────────

function getSelectors(contract) {
  return contract.interface.fragments
    .filter((f) => f.type === "function")
    .map((f) => ethers.id(f.format("sighash")).slice(0, 10));
}

// All facet names the Diamond knows about (excl. DiamondCutFacet which is baked in)
const SUPPORTED_FACETS = [
  "DiamondCutFacet",
  "DiamondLoupeFacet",
  "OwnershipFacet",
  "ConfigFacet",
  "MerchantFacet",
  "OrderFacet",
];

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  // --- resolve env vars ---
  const diamondAddress = process.env.DIAMOND_ADDRESS;
  if (!diamondAddress) {
    throw new Error("DIAMOND_ADDRESS is not set in .env");
  }

  const replaceFacetsRaw = process.env.REPLACE_FACETS || "";
  const facetsToReplace = replaceFacetsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (facetsToReplace.length === 0) {
    console.log("ℹ️  REPLACE_FACETS is empty — nothing to upgrade.");
    return;
  }

  // validate names
  for (const name of facetsToReplace) {
    if (!SUPPORTED_FACETS.includes(name)) {
      throw new Error(
        `Unknown facet "${name}". Supported: ${SUPPORTED_FACETS.join(", ")}`
      );
    }
  }

  const [deployer] = await ethers.getSigners();
  console.log("Upgrading with account:", deployer.address);
  console.log("Diamond address:       ", diamondAddress);
  console.log("Facets to replace:     ", facetsToReplace.join(", "));

  const diamondCutContract = await ethers.getContractAt(
    "IDiamondCut",
    diamondAddress
  );
  const diamondLoupe = await ethers.getContractAt(
    "IDiamondLoupe",
    diamondAddress
  );

  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
  const cut = [];

  // Read deployed-addresses.json for reference (optional, just for logging)
  let savedAddresses = {};
  try {
    const fs = require("fs");
    savedAddresses = JSON.parse(fs.readFileSync("./deployed-addresses.json", "utf8"));
  } catch {
    // not required
  }

  console.log("\n── Redeploying selected facets...");

  for (const facetName of facetsToReplace) {
    console.log(`\n  Deploying new ${facetName}...`);

    const NewFacet = await ethers.deployContract(facetName);
    await NewFacet.waitForDeployment();
    const newAddress = await NewFacet.getAddress();
    console.log(`  ${facetName}: ${newAddress}`);

    const newSelectors = getSelectors(NewFacet);

    // Find which selectors already exist in the Diamond so we can Replace them,
    // and which are brand-new so we need to Add them.
    const existingSelectors = [];
    const newOnlySelectors = [];

    for (const sel of newSelectors) {
      try {
        const facetAddr = await diamondLoupe.facetAddress(sel);
        if (facetAddr !== ethers.ZeroAddress) {
          existingSelectors.push(sel);
        } else {
          newOnlySelectors.push(sel);
        }
      } catch {
        newOnlySelectors.push(sel);
      }
    }

    if (existingSelectors.length > 0) {
      cut.push({
        facetAddress: newAddress,
        action: FacetCutAction.Replace,
        functionSelectors: existingSelectors,
      });
      console.log(`  → Replace ${existingSelectors.length} existing selector(s)`);
    }

    if (newOnlySelectors.length > 0) {
      cut.push({
        facetAddress: newAddress,
        action: FacetCutAction.Add,
        functionSelectors: newOnlySelectors,
      });
      console.log(`  → Add ${newOnlySelectors.length} new selector(s)`);
    }

    // update saved addresses
    const key = facetName.charAt(0).toLowerCase() + facetName.slice(1);
    savedAddresses[key] = newAddress;
  }

  if (cut.length === 0) {
    console.log("\nNo selectors to cut — upgrade skipped.");
    return;
  }

  console.log("\n── Executing diamondCut (upgrade)...");
  const tx = await diamondCutContract.diamondCut(
    cut,
    ethers.ZeroAddress,   // no init call needed for a plain facet upgrade
    "0x"
  );
  const receipt = await tx.wait();
  if (!receipt.status) throw new Error("diamondCut upgrade failed");
  console.log("diamondCut completed. Tx:", tx.hash);

  // ── Post-cut: initialize order-engine config if not set ────────────────
  // The diamond was originally initialized before OrderFacet existed, so
  // buyPrice / sellPrice / disputeWindow are still 0 in storage. Seed them
  // via the ConfigFacet admin setters here (idempotent — skip if already set).
  if (facetsToReplace.includes("OrderFacet") || facetsToReplace.includes("ConfigFacet")) {
    const config = await ethers.getContractAt("ConfigFacet", diamondAddress);
    let pricing;
    try {
      pricing = await config.getOrderPricing();
    } catch {
      pricing = null;
    }

    const buyPrice = pricing ? pricing[0] : 0n;
    const sellPrice = pricing ? pricing[1] : 0n;
    const disputeWindow = pricing ? pricing[2] : 0n;

    const targetBuy = BigInt(process.env.BUY_PRICE_INR_PER_USDC || "95");
    const targetSell = BigInt(process.env.SELL_PRICE_INR_PER_USDC || "90");
    const targetWindow = BigInt(process.env.DISPUTE_WINDOW_SECONDS || "600");

    if (buyPrice === 0n && sellPrice === 0n) {
      console.log(`\n── Seeding order pricing: buy=${targetBuy} sell=${targetSell}`);
      const t1 = await config.setOrderPricing(targetBuy, targetSell);
      await t1.wait();
      console.log("  setOrderPricing tx:", t1.hash);
    } else {
      console.log(`\n── Order pricing already set (buy=${buyPrice}, sell=${sellPrice}) — skipping.`);
    }

    if (disputeWindow === 0n) {
      console.log(`\n── Seeding dispute window: ${targetWindow}s`);
      const t2 = await config.setDisputeWindow(targetWindow);
      await t2.wait();
      console.log("  setDisputeWindow tx:", t2.hash);
    } else {
      console.log(`\n── Dispute window already set (${disputeWindow}s) — skipping.`);
    }
  }

  // persist updated addresses
  const fs = require("fs");
  fs.writeFileSync(
    "./deployed-addresses.json",
    JSON.stringify(savedAddresses, null, 2)
  );

  console.log("\n✅ Upgrade complete");
  console.log("─────────────────────────────────────────");
  for (const entry of cut) {
    const action = entry.action === FacetCutAction.Replace ? "Replaced" : "Added";
    console.log(`${action}: ${entry.facetAddress} (${entry.functionSelectors.length} selectors)`);
  }
  console.log("─────────────────────────────────────────");
  console.log("Addresses saved to deployed-addresses.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
