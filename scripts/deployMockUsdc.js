const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying Mock USDC with account:", deployer.address);
  console.log("Network:", network.name);

  const name = process.env.MOCK_USDC_NAME || "Mock USDC";
  const symbol = process.env.MOCK_USDC_SYMBOL || "mUSDC";
  const decimals = Number(process.env.MOCK_USDC_DECIMALS || "6");

  const mock = await ethers.deployContract("MockERC20", [name, symbol, decimals]);
  await mock.waitForDeployment();
  const address = await mock.getAddress();
  const receipt = await mock.deploymentTransaction().wait();

  const mintAmount = process.env.MINT_MOCK_USDC_TO_DEPLOYER;
  if (mintAmount && BigInt(mintAmount) > 0n) {
    console.log("Minting initial mock USDC to deployer...");
    const tx = await mock.mint(deployer.address, BigInt(mintAmount));
    await tx.wait();
    console.log("Mint tx:", tx.hash);
  }

  const output = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    mockUsdc: address,
    name,
    symbol,
    decimals,
    deployedAtBlock: receipt.blockNumber,
    deployedAtTx: mock.deploymentTransaction().hash,
    deployedAt: new Date().toISOString(),
  };

  fs.mkdirSync("./deployments", { recursive: true });
  const file = path.join("./deployments", `${network.name}-mock-usdc.json`);
  fs.writeFileSync(file, JSON.stringify(output, null, 2));

  console.log("Mock USDC:", address);
  console.log("Saved:", file);
  console.log(`Use this for Diamond deploy: USDC_ADDRESS=${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});