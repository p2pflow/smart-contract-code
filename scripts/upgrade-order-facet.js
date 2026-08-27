const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const ROOT = path.resolve(__dirname, "..");
const CHAIN_ID = 84532n;
const ZERO_ADDRESS = ethers.ZeroAddress;

function artifact(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts/contracts", relative), "utf8"));
}

function facetSelectors(abi) {
  const iface = new ethers.Interface(abi);
  return iface.fragments
    .filter((fragment) => fragment.type === "function")
    .map((fragment) => fragment.selector)
    .sort();
}

async function stableSnapshot(provider, diamond) {
  const calls = [
    "owner()",
    "executor()",
    "getConfig()",
    "getCustodyTotals()",
    "getProtocolTimings()",
    "getLatestPrice()",
  ];
  return Object.fromEntries(await Promise.all(calls.map(async (signature) => {
    const data = new ethers.Interface([`function ${signature} view returns (bytes)`]).getFunction(signature.split("(")[0]).selector;
    // Return raw ABI bytes. The selector is sufficient for eth_call and exact
    // byte equality proves the existing protocol state was not modified.
    return [signature, await provider.call({ to: diamond, data })];
  })));
}

async function main() {
  const broadcast = process.argv.includes("--broadcast");
  const rpc = process.env.BASE_SEPOLIA_RPC_URL;
  const key = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!rpc || !key) throw new Error("BASE_SEPOLIA_RPC_URL and DEPLOYER_PRIVATE_KEY are required");

  const summaryPath = path.join(ROOT, "deployments/base-sepolia/deployment-summary.json");
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const diamond = ethers.getAddress(process.env.P2PFLOW_DIAMOND_ADDRESS || summary.diamond);
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { cacheTimeout: -1 });
  const network = await provider.getNetwork();
  if (network.chainId !== CHAIN_ID) throw new Error(`Expected Base Sepolia ${CHAIN_ID}, got ${network.chainId}`);
  const wallet = new ethers.Wallet(key, provider);

  const loupeArtifact = artifact("facets/DiamondLoupeFacet.sol/DiamondLoupeFacet.json");
  const cutArtifact = artifact("facets/DiamondCutFacet.sol/DiamondCutFacet.json");
  const orderArtifact = artifact("facets/OrderFacet.sol/OrderFacet.json");
  const ownerArtifact = artifact("facets/OwnershipFacet.sol/OwnershipFacet.json");
  const loupe = new ethers.Contract(diamond, loupeArtifact.abi, provider);
  const owner = new ethers.Contract(diamond, ownerArtifact.abi, provider);
  const onchainOwner = await owner.owner();
  if (onchainOwner.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`Connected deployer ${wallet.address} is not Diamond owner ${onchainOwner}`);
  }

  const orderInterface = new ethers.Interface(orderArtifact.abi);
  const getOrderSelector = orderInterface.getFunction("getOrder").selector;
  const currentOrderFacet = await loupe.facetAddress(getOrderSelector);
  if (currentOrderFacet === ZERO_ADDRESS) throw new Error("Current OrderFacet could not be resolved through the loupe");

  const desiredSelectors = facetSelectors(orderArtifact.abi);
  const currentSelectors = (await loupe.facetFunctionSelectors(currentOrderFacet)).map((value) => value.toLowerCase());
  const desiredSet = new Set(desiredSelectors.map((value) => value.toLowerCase()));
  const selectorOwners = await Promise.all(desiredSelectors.map((selector) => loupe.facetAddress(selector)));
  const addSelectors = [];
  const replaceSelectors = [];
  for (let index = 0; index < desiredSelectors.length; index += 1) {
    const selector = desiredSelectors[index];
    const selectorOwner = selectorOwners[index];
    if (selectorOwner === ZERO_ADDRESS) addSelectors.push(selector);
    else if (selectorOwner.toLowerCase() === currentOrderFacet.toLowerCase()) replaceSelectors.push(selector);
    else throw new Error(`Selector ${selector} belongs to unrelated facet ${selectorOwner}; refusing upgrade`);
  }
  const removeSelectors = currentSelectors.filter((selector) => !desiredSet.has(selector));

  console.log(`chainId=${network.chainId}`);
  console.log(`diamond=${diamond}`);
  console.log(`owner=${onchainOwner}`);
  console.log(`currentOrderFacet=${currentOrderFacet}`);
  console.log(`selectors add=${addSelectors.length} replace=${replaceSelectors.length} remove=${removeSelectors.length}`);
  if (!broadcast) {
    console.log("Upgrade check passed. Use --broadcast to deploy and cut the new OrderFacet.");
    return;
  }

  const before = await stableSnapshot(provider, diamond);
  const nonce = await provider.getTransactionCount(wallet.address, "pending");
  const factory = new ethers.ContractFactory(orderArtifact.abi, orderArtifact.bytecode, wallet);
  const newFacet = await factory.deploy({ nonce, gasLimit: 8_000_000 });
  const deploymentTransaction = newFacet.deploymentTransaction();
  console.log(`submitted OrderFacet=${deploymentTransaction.hash}`);
  const deploymentReceipt = await deploymentTransaction.wait(1);
  const newFacetAddress = await newFacet.getAddress();

  const cuts = [];
  if (addSelectors.length) cuts.push({ facetAddress: newFacetAddress, action: 0, functionSelectors: addSelectors });
  if (replaceSelectors.length) cuts.push({ facetAddress: newFacetAddress, action: 1, functionSelectors: replaceSelectors });
  if (removeSelectors.length) cuts.push({ facetAddress: ZERO_ADDRESS, action: 2, functionSelectors: removeSelectors });
  if (!cuts.length) throw new Error("No selector changes were found");

  const cutter = new ethers.Contract(diamond, cutArtifact.abi, wallet);
  const cutTransaction = await cutter.diamondCut(cuts, ZERO_ADDRESS, "0x", {
    nonce: nonce + 1,
    gasLimit: 8_000_000,
  });
  console.log(`submitted diamondCut=${cutTransaction.hash}`);
  const cutReceipt = await cutTransaction.wait(1);

  const after = await stableSnapshot(provider, diamond);
  for (const [name, value] of Object.entries(before)) {
    if (after[name] !== value) throw new Error(`Protocol state changed unexpectedly for ${name}`);
  }
  for (const functionName of ["getOrder", "createScanPayOrder", "markScanPayDetailsShared"]) {
    const selector = orderInterface.getFunction(functionName).selector;
    const installed = await loupe.facetAddress(selector);
    if (installed.toLowerCase() !== newFacetAddress.toLowerCase()) {
      throw new Error(`${functionName} selector did not resolve to the new OrderFacet`);
    }
  }

  console.log(`newOrderFacet=${newFacetAddress}`);
  console.log(`deploymentBlock=${deploymentReceipt.blockNumber}`);
  console.log(`upgradeBlock=${cutReceipt.blockNumber}`);
  console.log(`RESULT_JSON=${JSON.stringify({
    diamond,
    previousOrderFacet: currentOrderFacet,
    orderFacet: newFacetAddress,
    orderFacetDeploymentTransactionHash: deploymentReceipt.hash,
    orderFacetUpgradeTransactionHash: cutReceipt.hash,
    orderFacetUpgradeBlock: cutReceipt.blockNumber,
  })}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
