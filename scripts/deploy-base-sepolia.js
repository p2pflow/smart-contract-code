const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const ROOT = path.resolve(__dirname, "..");
const CHAIN_ID = 84532n;
const MOCK_USDC = "0xa50e77Ae17F290Cfb0E2F29B4F2d9D0071Cb6D63";
const FACETS = [
  "DiamondLoupeFacet", "OwnershipFacet", "AccessControlFacet", "ConfigFacet",
  "PricingFacet", "MerchantFacet", "AssignmentFacet", "OrderFacet", "DisputeFacet",
];

function artifact(name) {
  const relative = name === "Diamond" ? "Diamond.sol/Diamond.json"
    : name === "DiamondInitV2" ? "upgradeInitializers/DiamondInitV2.sol/DiamondInitV2.json"
    : `facets/${name}.sol/${name}.json`;
  return JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts/contracts", relative), "utf8"));
}

function selectors(abi) {
  const iface = new ethers.Interface(abi);
  return iface.fragments.filter((item) => item.type === "function").map((item) => item.selector).sort();
}

async function deploy(wallet, nonce, name, args = []) {
  const a = artifact(name);
  const contract = await new ethers.ContractFactory(a.abi, a.bytecode, wallet).deploy(...args, { nonce: nonce.next++, gasLimit: 8_000_000 });
  const tx = contract.deploymentTransaction();
  console.log(`submitted ${name}: ${tx.hash}`);
  const receipt = await tx.wait(1);
  const address = await contract.getAddress();
  for (let attempt = 0; attempt < 30 && await wallet.provider.getCode(address) === "0x"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (await wallet.provider.getCode(address) === "0x") throw new Error(`Bytecode not visible for ${name}: ${address}`);
  console.log(`deployed ${name}: ${address} block=${receipt.blockNumber}`);
  return { name, address, abi: a.abi, receipt, selectors: selectors(a.abi) };
}

async function main() {
  const broadcast = process.argv.includes("--broadcast");
  const outputArg = process.argv.indexOf("--output");
  const output = path.resolve(ROOT, outputArg >= 0 ? process.argv[outputArg + 1] : "deployments/base-sepolia");
  const rpc = process.env.BASE_SEPOLIA_RPC_URL;
  const key = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!rpc || !key) throw new Error("BASE_SEPOLIA_RPC_URL and DEPLOYER_PRIVATE_KEY are required");
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { cacheTimeout: -1 });
  const network = await provider.getNetwork();
  if (network.chainId !== CHAIN_ID) throw new Error(`Expected Base Sepolia ${CHAIN_ID}, got ${network.chainId}`);
  const wallet = new ethers.Wallet(key, provider);
  const executor = ethers.getAddress(process.env.P2PFLOW_EXECUTOR_ADDR || wallet.address);
  const minStake = BigInt(process.env.P2PFLOW_MIN_MERCHANT_STAKE_USDC_ATOMS || "100000000");
  const token = new ethers.Contract(MOCK_USDC, ["function decimals() view returns (uint8)"], provider);
  if (await token.decimals() !== 6n) throw new Error("mUSDC must use six decimals");
  for (const name of ["Diamond", "DiamondInitV2", "DiamondCutFacet", ...FACETS]) artifact(name);
  console.log(`chainId=${network.chainId}`);
  console.log(`deployer=${wallet.address}`);
  console.log(`executor=${executor}`);
  console.log(`mockUsdc=${MOCK_USDC}`);
  if (!broadcast) return console.log("Deployment check passed. Use --broadcast to deploy.");

  const observed = await Promise.all(Array.from({ length: 8 }, () => provider.getTransactionCount(wallet.address, "latest")));
  const nonce = { next: Math.max(...observed) };
  const cutFacet = await deploy(wallet, nonce, "DiamondCutFacet");
  const diamond = await deploy(wallet, nonce, "Diamond", [wallet.address, cutFacet.address]);
  const deployedFacets = [];
  const seen = new Set();
  for (const name of FACETS) {
    const item = await deploy(wallet, nonce, name);
    for (const selector of item.selectors) {
      if (seen.has(selector)) throw new Error(`Duplicate selector ${selector}`);
      seen.add(selector);
    }
    deployedFacets.push(item);
  }
  const initializer = await deploy(wallet, nonce, "DiamondInitV2");
  const initInterface = new ethers.Interface(initializer.abi);
  const initData = initInterface.encodeFunctionData("initV2", [{ usdcToken: MOCK_USDC, executor, minMerchantStakeUsdc: minStake }]);
  const cut = deployedFacets.map((item) => ({ facetAddress: item.address, action: 0, functionSelectors: item.selectors }));
  const diamondCut = new ethers.Contract(diamond.address, cutFacet.abi, wallet);
  const initTx = await diamondCut.diamondCut(cut, initializer.address, initData, {
    nonce: nonce.next++,
    gasLimit: 8_000_000,
  });
  const initReceipt = await initTx.wait(1);
  const config = deployedFacets.find((item) => item.name === "ConfigFacet");
  const unpauseTx = await new ethers.Contract(diamond.address, config.abi, wallet).unpausePlatform({
    nonce: nonce.next++,
    gasLimit: 200_000,
  });
  const unpauseReceipt = await unpauseTx.wait(1);

  fs.mkdirSync(output, { recursive: true });
  const facets = Object.fromEntries([[cutFacet.name, cutFacet.address], ...deployedFacets.map((item) => [item.name, item.address])]);
  const summary = {
    chainId: Number(CHAIN_ID), diamond: diamond.address, initializer: initializer.address,
    owner: wallet.address, executor, usdc: MOCK_USDC, facets,
    deploymentBlock: diamond.receipt.blockNumber, startBlock: diamond.receipt.blockNumber,
    deploymentTransactionHash: diamond.receipt.hash,
    initializationTransactionHash: initReceipt.hash, unpauseTransactionHash: unpauseReceipt.hash,
  };
  fs.writeFileSync(path.join(output, "deployment-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(output, "deployment-manifest.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  console.log("\nDeployment addresses");
  console.log(`Diamond=${diamond.address}`);
  console.log(`DiamondInitV2=${initializer.address}`);
  console.log(`USDC=${MOCK_USDC}`);
  console.log(`Executor=${executor}`);
  for (const [name, address] of Object.entries(facets)) console.log(`${name}=${address}`);
  console.log(`DeploymentBlock=${diamond.receipt.blockNumber}`);
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
