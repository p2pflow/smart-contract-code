const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { ethers } = require("ethers");

const ROOT = path.resolve(__dirname, "..");
const OFFICIAL_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const BASE_SEPOLIA_CHAIN_ID = 84_532n;
const FACET_CUT_ACTION_ADD = 0;

const FACET_NAMES = Object.freeze([
  "DiamondLoupeFacet",
  "OwnershipFacet",
  "AccessControlFacet",
  "ConfigFacet",
  "PricingFacet",
  "MerchantFacet",
  "AssignmentFacet",
  "OrderFacet",
  "DisputeFacet",
]);

const ROLE_ENV = Object.freeze([
  ["DEFAULT_ADMIN_ROLE", "defaultAdmin", ["P2PFLOW_DEFAULT_ADMIN_ADDR", "DEFAULT_ADMIN_ADDR", "TREASURY_ADDR"]],
  ["OPERATOR_ROLE", "operator", ["P2PFLOW_OPERATOR_ADDR", "OPERATOR_ADDR"]],
  ["UPGRADER_ROLE", "upgrader", ["P2PFLOW_UPGRADER_ADDR", "UPGRADER_ADDR"]],
  ["PAUSER_ROLE", "pauser", ["P2PFLOW_PAUSER_ADDR", "PAUSER_ADDR"]],
  ["PRICE_UPDATER_ROLE", "priceUpdater", ["P2PFLOW_PRICE_UPDATER_ADDR", "PRICE_UPDATER_ADDR"]],
  ["ORDER_ASSIGNER_ROLE", "orderAssigner", ["P2PFLOW_ORDER_ASSIGNER_ADDR", "ORDER_ASSIGNER_ADDR"]],
  ["DISPUTE_RESOLVER_ROLE", "disputeResolver", ["P2PFLOW_DISPUTE_RESOLVER_ADDR", "DISPUTE_RESOLVER_ADDR"]],
]);

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function positiveBigInt(value, name) {
  if (!/^[1-9][0-9]*$/u.test(String(value))) throw new Error(`${name} must be a positive integer string`);
  return BigInt(value);
}

function positiveNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive safe integer`);
  return parsed;
}

function readArtifact(relativePath) {
  const artifactPath = path.join(ROOT, "artifacts", "contracts", relativePath);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  if (typeof artifact.bytecode !== "string" || artifact.bytecode.length <= 2) {
    throw new Error(`Artifact is missing bytecode: ${relativePath}`);
  }
  return artifact;
}

function artifactFor(name) {
  if (name === "Diamond") return readArtifact("Diamond.sol/Diamond.json");
  if (name === "DiamondInitV2") return readArtifact("upgradeInitializers/DiamondInitV2.sol/DiamondInitV2.json");
  return readArtifact(`facets/${name}.sol/${name}.json`);
}

function selectorsFor(artifact) {
  const contractInterface = new ethers.Interface(artifact.abi);
  return contractInterface.fragments
    .filter((fragment) => fragment.type === "function")
    .map((fragment) => fragment.selector)
    .sort();
}

async function codeHash(provider, address) {
  return ethers.keccak256(await provider.getCode(address));
}

async function deployContract(wallet, name, args = []) {
  const artifact = artifactFor(name);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(...args);
  const tx = contract.deploymentTransaction();
  console.log(`submitted ${name}: ${tx.hash}`);
  await contract.waitForDeployment();
  const receipt = await tx.wait(1);
  if (!receipt) throw new Error(`Missing deployment receipt for ${name}`);
  const address = await contract.getAddress();
  console.log(`deployed ${name}: ${address} block=${receipt.blockNumber}`);
  return { name, artifact, contract, address, receipt };
}

function resolveRoles(environment, ownerAddress) {
  const roles = {};
  const missing = [];
  for (const [, field, names] of ROLE_ENV) {
    const rawValue = names.map((name) => environment[name]).find((value) => typeof value === "string" && value.trim());
    if (!rawValue) {
      missing.push(names.join(" or "));
      continue;
    }
    roles[field] = ethers.getAddress(rawValue.trim());
  }
  if (missing.length > 0) {
    throw new Error(`Missing required public role address variables:\n- ${missing.join("\n- ")}`);
  }

  const seen = new Map([[ownerAddress.toLowerCase(), "diamond owner/deployer"]]);
  for (const [roleName, field] of ROLE_ENV.map(([roleName, field]) => [roleName, field])) {
    const address = roles[field];
    const key = address.toLowerCase();
    if (seen.has(key)) throw new Error(`${roleName} address overlaps with ${seen.get(key)}: ${address}`);
    seen.set(key, roleName);
  }
  return roles;
}

function buildInitInput(environment, roles) {
  return {
    usdcToken: OFFICIAL_USDC,
    minMerchantStakeUsdc: positiveBigInt(environment.P2PFLOW_MIN_MERCHANT_STAKE_USDC_ATOMS ?? "100000000", "P2PFLOW_MIN_MERCHANT_STAKE_USDC_ATOMS"),
    safety: {
      orderLifetimeSeconds: positiveBigInt(environment.P2PFLOW_ORDER_LIFETIME_SECONDS ?? "600", "P2PFLOW_ORDER_LIFETIME_SECONDS"),
      assignmentLifetimeSeconds: positiveBigInt(environment.P2PFLOW_ASSIGNMENT_LIFETIME_SECONDS ?? "300", "P2PFLOW_ASSIGNMENT_LIFETIME_SECONDS"),
      acceptedRecoverySeconds: positiveBigInt(environment.P2PFLOW_ACCEPTED_RECOVERY_SECONDS ?? "1800", "P2PFLOW_ACCEPTED_RECOVERY_SECONDS"),
      maxQuoteValiditySeconds: positiveBigInt(environment.P2PFLOW_MAX_QUOTE_VALIDITY_SECONDS ?? "300", "P2PFLOW_MAX_QUOTE_VALIDITY_SECONDS"),
    },
    pricePolicy: {
      sourceQuorum: positiveBigInt(environment.P2PFLOW_PRICE_SOURCE_QUORUM ?? "2", "P2PFLOW_PRICE_SOURCE_QUORUM"),
      maxAgeSeconds: positiveBigInt(environment.P2PFLOW_PRICE_MAX_AGE_SECONDS ?? "300", "P2PFLOW_PRICE_MAX_AGE_SECONDS"),
      maxDeviationBps: positiveBigInt(environment.P2PFLOW_PRICE_MAX_DEVIATION_BPS ?? "300", "P2PFLOW_PRICE_MAX_DEVIATION_BPS"),
    },
    roles,
  };
}

function reviewTemplate(manifestSha256) {
  return {
    decision: "pending",
    environment: "base-sepolia",
    reviewer: "",
    reviewedAt: "",
    manifestFileSha256: manifestSha256,
  };
}

async function main() {
  const environment = process.env;
  const checkOnly = process.argv.includes("--check") || !process.argv.includes("--broadcast");
  const outputDirectory = path.resolve(ROOT, option("--output", "deployments/base-sepolia"));
  const rpcUrl = environment.BASE_SEPOLIA_RPC_URL || environment.SEPOLIA_RPC_URL;
  const privateKey = environment.PRIVATE_KEY || environment.DEPLOYER_PRIVATE_KEY;
  if (!rpcUrl) throw new Error("BASE_SEPOLIA_RPC_URL or SEPOLIA_RPC_URL is required");
  if (!privateKey) throw new Error("PRIVATE_KEY or DEPLOYER_PRIVATE_KEY is required");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(`Expected Base Sepolia chainId ${BASE_SEPOLIA_CHAIN_ID}, got ${network.chainId}`);
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  const ownerAddress = ethers.getAddress(wallet.address);
  const balance = await provider.getBalance(ownerAddress);
  const roles = resolveRoles(environment, ownerAddress);

  const usdc = new ethers.Contract(OFFICIAL_USDC, ["function decimals() view returns (uint8)"], provider);
  const usdcDecimals = await usdc.decimals();
  if (usdcDecimals !== 6n) throw new Error(`Official Base Sepolia USDC decimals mismatch: ${usdcDecimals}`);
  const usdcCodeHash = await codeHash(provider, OFFICIAL_USDC);

  for (const name of ["Diamond", "DiamondInitV2", "DiamondCutFacet", ...FACET_NAMES]) artifactFor(name);
  console.log(`chainId=${network.chainId}`);
  console.log(`deployer=${ownerAddress}`);
  console.log(`deployerBalanceEth=${ethers.formatEther(balance)}`);
  console.log(`officialUsdc=${OFFICIAL_USDC}`);
  console.log(`officialUsdcCodeHash=${usdcCodeHash}`);
  console.log(`roles=${Object.keys(roles).length}`);
  if (checkOnly) {
    console.log("Base Sepolia deployment check passed. Re-run npm run deploy:base-sepolia to broadcast.");
    return;
  }

  const diamondCutFacet = await deployContract(wallet, "DiamondCutFacet");
  const diamond = await deployContract(wallet, "Diamond", [ownerAddress, diamondCutFacet.address]);
  const facetDeployments = [];
  const seenSelectors = new Map();
  for (const name of FACET_NAMES) {
    const deployment = await deployContract(wallet, name);
    const selectors = selectorsFor(deployment.artifact);
    for (const selector of selectors) {
      if (seenSelectors.has(selector)) throw new Error(`Duplicate selector ${selector}: ${seenSelectors.get(selector)} and ${name}`);
      seenSelectors.set(selector, name);
    }
    facetDeployments.push({ ...deployment, selectors });
  }
  const initializer = await deployContract(wallet, "DiamondInitV2");

  const cut = facetDeployments.map((facet) => ({
    facetAddress: facet.address,
    action: FACET_CUT_ACTION_ADD,
    functionSelectors: facet.selectors,
  }));
  const initializerInterface = new ethers.Interface(initializer.artifact.abi);
  const initInput = buildInitInput(environment, roles);
  const initCalldata = initializerInterface.encodeFunctionData("initV2", [initInput]);
  const diamondCut = new ethers.Contract(diamond.address, diamondCutFacet.artifact.abi, wallet);
  const initTx = await diamondCut.diamondCut(cut, initializer.address, initCalldata);
  console.log(`submitted diamondCut/initV2: ${initTx.hash}`);
  const initReceipt = await initTx.wait(1);
  if (!initReceipt) throw new Error("Missing initialization receipt");
  console.log(`initialized Diamond: ${diamond.address} block=${initReceipt.blockNumber}`);

  const template = JSON.parse(fs.readFileSync(
    path.join(ROOT, "packages", "protocol", "fixtures", "local-base-sepolia.manifest.input.json"),
    "utf8",
  ));
  const facetContracts = new Map([
    ["DiamondCutFacet", diamondCutFacet],
    ...facetDeployments.map((facet) => [facet.name, facet]),
  ]);
  const manifestFacets = [];
  for (const facet of template.facets) {
    const deployment = facetContracts.get(facet.name);
    if (!deployment) throw new Error(`Missing deployed facet ${facet.name}`);
    manifestFacets.push({
      name: facet.name,
      address: deployment.address,
      codeHash: await codeHash(provider, deployment.address),
      functionSelectors: selectorsFor(deployment.artifact),
    });
  }
  const roleAddress = {
    DEFAULT_ADMIN_ROLE: roles.defaultAdmin,
    OPERATOR_ROLE: roles.operator,
    UPGRADER_ROLE: roles.upgrader,
    PAUSER_ROLE: roles.pauser,
    PRICE_UPDATER_ROLE: roles.priceUpdater,
    ORDER_ASSIGNER_ROLE: roles.orderAssigner,
    DISPUTE_RESOLVER_ROLE: roles.disputeResolver,
  };
  const manifestRoles = Object.fromEntries(Object.entries(template.roles).map(([name, role]) => [
    name,
    { id: role.id, expectedAddress: roleAddress[name] },
  ]));
  const protocolModule = await import(pathToFileURL(path.join(ROOT, "packages", "protocol", "dist", "index.js")).href);
  const fixtureModule = await import(pathToFileURL(path.join(ROOT, "packages", "protocol", "dist", "test-fixture.js")).href);
  const diamondDeploymentBlock = await provider.getBlock(diamond.receipt.blockNumber);
  if (!diamondDeploymentBlock) throw new Error("Missing Diamond deployment block");
  const manifest = {
    ...template,
    kind: "base-sepolia-deployment",
    deployed: true,
    safeForSharedEnvironment: true,
    network: "base-sepolia",
    createdAt: new Date(diamondDeploymentBlock.timestamp * 1_000).toISOString(),
    diamond: {
      address: diamond.address,
      owner: ownerAddress,
      codeHash: await codeHash(provider, diamond.address),
      deploymentTransactionHash: diamond.receipt.hash,
      deploymentBlock: diamond.receipt.blockNumber,
      startBlock: diamond.receipt.blockNumber,
    },
    initialization: {
      initialized: true,
      initialPaused: true,
      initializerAddress: initializer.address,
      initializerCodeHash: await codeHash(provider, initializer.address),
      calldataHash: ethers.keccak256(initCalldata),
      transactionHash: initReceipt.hash,
      block: initReceipt.blockNumber,
      protocolInitializedTopic0: template.initialization.protocolInitializedTopic0,
    },
    usdc: {
      address: OFFICIAL_USDC,
      decimals: 6,
      codeHash: usdcCodeHash,
    },
    facets: manifestFacets,
    roles: manifestRoles,
    abiSha256: fixtureModule.LOCAL_BASE_SEPOLIA_FIXTURE.abiSha256,
    usdcAbiSha256: fixtureModule.LOCAL_BASE_SEPOLIA_FIXTURE.usdcAbiSha256,
    manifestSha256: ethers.ZeroHash,
  };
  manifest.manifestSha256 = protocolModule.sha256Canonical(protocolModule.manifestDigestInput(manifest));
  protocolModule.parseDeploymentManifest(manifest);

  await fsp.mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const manifestPath = path.join(outputDirectory, "deployment-manifest.json");
  const summaryPath = path.join(outputDirectory, "deployment-summary.json");
  const reviewPath = path.join(outputDirectory, "deployment-review.pending.json");
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  await fsp.writeFile(manifestPath, manifestBytes, { mode: 0o600 });
  const manifestFileSha256 = ethers.sha256(ethers.toUtf8Bytes(manifestBytes)).slice(2);
  await fsp.writeFile(reviewPath, `${JSON.stringify(reviewTemplate(manifestFileSha256), null, 2)}\n`, { mode: 0o600 });
  await fsp.writeFile(summaryPath, `${JSON.stringify({
    chainId: Number(BASE_SEPOLIA_CHAIN_ID),
    diamond: diamond.address,
    deploymentBlock: diamond.receipt.blockNumber,
    deploymentTransactionHash: diamond.receipt.hash,
    initializationTransactionHash: initReceipt.hash,
    manifestPath,
    reviewPath,
    roles: roleAddress,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log(`manifest=${manifestPath}`);
  console.log(`reviewTemplate=${reviewPath}`);
  console.log(`summary=${summaryPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
