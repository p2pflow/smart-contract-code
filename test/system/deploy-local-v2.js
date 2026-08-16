const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { ethers, network } = require("hardhat");

const {
  deployV2,
  getSelectors,
  publishRound,
  setupMerchant,
} = require("../helpers/v2-fixture");

const OFFICIAL_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

async function codeHash(address) {
  return ethers.keccak256(await ethers.provider.getCode(address));
}

async function main() {
  const outputDirectory = process.env.P2PFLOW_SYSTEM_RUNTIME_DIR;
  if (!outputDirectory || !path.isAbsolute(outputDirectory)) {
    throw new Error("P2PFLOW_SYSTEM_RUNTIME_DIR must be an absolute disposable directory");
  }
  if (network.name !== "localhost" || (await ethers.provider.getNetwork()).chainId !== 84_532n) {
    throw new Error("system deployment requires the isolated localhost chainId 84532");
  }

  const temporaryToken = await ethers.deployContract("MockERC20", ["USD Coin", "USDC", 6]);
  await temporaryToken.waitForDeployment();
  const tokenRuntimeCode = await ethers.provider.getCode(await temporaryToken.getAddress());
  await network.provider.send("hardhat_setCode", [OFFICIAL_USDC, tokenRuntimeCode]);
  const usdc = await ethers.getContractAt("MockERC20", OFFICIAL_USDC);
  if (await usdc.decimals() !== 6n) throw new Error("test-only official-address token must expose six decimals");

  const fixture = await deployV2({ usdc, leavePaused: true, safety: { acceptedRecoverySeconds: 60 } });
  const diamondReceipt = await fixture.diamond.deploymentTransaction().wait();
  if (!diamondReceipt || !fixture.initReceipt) throw new Error("deployment receipts are required");

  const template = JSON.parse(await fs.readFile(
    path.resolve(__dirname, "../../packages/protocol/fixtures/local-base-sepolia.manifest.input.json"),
    "utf8",
  ));
  const facetContracts = new Map([
    ["DiamondCutFacet", fixture.diamondCutFacet],
    ...Object.entries(fixture.facetDeployments),
  ]);
  const facets = [];
  for (const name of template.facets.map((facet) => facet.name)) {
    const contract = facetContracts.get(name);
    if (!contract) throw new Error(`missing deployed facet ${name}`);
    const address = await contract.getAddress();
    facets.push({
      name,
      address,
      codeHash: await codeHash(address),
      functionSelectors: getSelectors(contract),
    });
  }

  const roleAddress = {
    DEFAULT_ADMIN_ROLE: fixture.initInput.roles.defaultAdmin,
    OPERATOR_ROLE: fixture.initInput.roles.operator,
    UPGRADER_ROLE: fixture.initInput.roles.upgrader,
    PAUSER_ROLE: fixture.initInput.roles.pauser,
    PRICE_UPDATER_ROLE: fixture.initInput.roles.priceUpdater,
    ORDER_ASSIGNER_ROLE: fixture.initInput.roles.orderAssigner,
    DISPUTE_RESOLVER_ROLE: fixture.initInput.roles.disputeResolver,
  };
  const roles = Object.fromEntries(Object.entries(template.roles).map(([name, role]) => [
    name,
    { id: role.id, expectedAddress: roleAddress[name] },
  ]));

  const initializerAddress = await fixture.initializer.getAddress();
  const manifest = {
    ...template,
    kind: "base-sepolia-deployment",
    deployed: true,
    safeForSharedEnvironment: true,
    network: "base-sepolia",
    createdAt: new Date().toISOString(),
    diamond: {
      address: fixture.diamondAddress,
      owner: fixture.owner.address,
      codeHash: await codeHash(fixture.diamondAddress),
      deploymentTransactionHash: diamondReceipt.hash,
      deploymentBlock: diamondReceipt.blockNumber,
      startBlock: diamondReceipt.blockNumber,
    },
    initialization: {
      initialized: true,
      initialPaused: true,
      initializerAddress,
      initializerCodeHash: await codeHash(initializerAddress),
      calldataHash: ethers.keccak256(fixture.initCalldata),
      transactionHash: fixture.initReceipt.hash,
      block: fixture.initReceipt.blockNumber,
      protocolInitializedTopic0: template.initialization.protocolInitializedTopic0,
    },
    usdc: {
      address: OFFICIAL_USDC,
      decimals: 6,
      codeHash: await codeHash(OFFICIAL_USDC),
    },
    facets,
    roles,
    manifestSha256: ethers.ZeroHash,
  };
  const protocolModule = await import(pathToFileURL(path.resolve(
    __dirname,
    "../../packages/protocol/dist/index.js",
  )).href);
  manifest.abiSha256 = protocolModule.LOCAL_BASE_SEPOLIA_FIXTURE.abiSha256;
  manifest.usdcAbiSha256 = protocolModule.LOCAL_BASE_SEPOLIA_FIXTURE.usdcAbiSha256;
  manifest.manifestSha256 = protocolModule.sha256Canonical(protocolModule.manifestDigestInput(manifest));
  protocolModule.parseDeploymentManifest(manifest);

  await fixture.config.connect(fixture.pauser).unpausePlatform();
  await publishRound(fixture);
  const merchant = await setupMerchant(fixture, fixture.merchantOne, {
    liquidity: 10_000n * 1_000_000n,
    fiatCapacityE6: 1_000_000n * 1_000_000n,
  });
  await fixture.usdc.mint(fixture.user.address, 10_000n * 1_000_000n);

  const descriptor = {
    chainId: 84_532,
    diamond: fixture.diamondAddress,
    usdc: OFFICIAL_USDC,
    manifestPath: path.join(outputDirectory, "deployment-manifest.json"),
    deploymentBlock: diamondReceipt.blockNumber,
    accounts: {
      owner: fixture.owner.address,
      admin: fixture.admin.address,
      operator: fixture.operator.address,
      pauser: fixture.pauser.address,
      priceUpdater: fixture.priceUpdater.address,
      orderAssigner: fixture.orderAssigner.address,
      disputeResolver: fixture.disputeResolver.address,
      user: fixture.user.address,
      merchant: fixture.merchantOne.address,
    },
    merchant: { channelId: merchant.channelId },
  };
  await fs.mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await fs.writeFile(descriptor.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await fs.writeFile(
    path.join(outputDirectory, "deployment.json"),
    `${JSON.stringify(descriptor, null, 2)}\n`,
    { mode: 0o600 },
  );
  process.stdout.write(`P2PFLOW_LOCAL_V2=${JSON.stringify(descriptor)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
