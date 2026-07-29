const { ethers } = require("hardhat");

const FacetCutAction = Object.freeze({
  Add: 0,
  Replace: 1,
  Remove: 2,
});

const INIT_VALUES = Object.freeze({
  minStake: 100_000_000n,
  dailyLimit: 600_000_000n,
  monthlyLimit: 6_200_000_000n,
  buyPrice: 95n,
  sellPrice: 90n,
  disputeWindow: 600n,
});

function getSelectors(contract) {
  return contract.interface.fragments
    .filter((fragment) => fragment.type === "function")
    .map((fragment) => ethers.id(fragment.format("sighash")).slice(0, 10));
}

async function deploy(name, args = []) {
  const contract = await ethers.deployContract(name, args);
  await contract.waitForDeployment();
  return contract;
}

async function deployBaselineDiamond() {
  const [owner, user, merchant, other] = await ethers.getSigners();

  const usdc = await deploy("MockERC20", ["Baseline USDC", "bUSDC", 6]);
  const diamondCutFacet = await deploy("DiamondCutFacet");
  const diamondLoupeFacet = await deploy("DiamondLoupeFacet");
  const ownershipFacet = await deploy("OwnershipFacet");
  const configFacet = await deploy("ConfigFacet");
  const merchantFacet = await deploy("MerchantFacet");
  const orderFacet = await deploy("OrderFacet");
  const diamondInit = await deploy("DiamondInit");

  const diamond = await deploy("Diamond", [
    owner.address,
    await diamondCutFacet.getAddress(),
  ]);
  const diamondAddress = await diamond.getAddress();

  const initialCut = [
    diamondLoupeFacet,
    ownershipFacet,
    configFacet,
    merchantFacet,
    orderFacet,
  ].map((facet) => ({
    facetAddress: facet.target,
    action: FacetCutAction.Add,
    functionSelectors: getSelectors(facet),
  }));

  const initCalldata = diamondInit.interface.encodeFunctionData("init", [
    await usdc.getAddress(),
    INIT_VALUES.minStake,
    INIT_VALUES.dailyLimit,
    INIT_VALUES.monthlyLimit,
    INIT_VALUES.buyPrice,
    INIT_VALUES.sellPrice,
    INIT_VALUES.disputeWindow,
  ]);

  const diamondCut = await ethers.getContractAt("IDiamondCut", diamondAddress);
  await (
    await diamondCut.diamondCut(
      initialCut,
      await diamondInit.getAddress(),
      initCalldata
    )
  ).wait();

  return {
    owner,
    user,
    merchant,
    other,
    usdc,
    diamond,
    diamondAddress,
    diamondCutFacet,
    diamondLoupeFacet,
    ownershipFacet,
    configFacet,
    merchantFacet,
    orderFacet,
    diamondInit,
    initCalldata,
    diamondCut,
    loupe: await ethers.getContractAt("IDiamondLoupe", diamondAddress),
    ownership: await ethers.getContractAt("OwnershipFacet", diamondAddress),
    config: await ethers.getContractAt("ConfigFacet", diamondAddress),
    merchants: await ethers.getContractAt("MerchantFacet", diamondAddress),
    orders: await ethers.getContractAt("OrderFacet", diamondAddress),
  };
}

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

function mappingEntrySlot(keyType, key, rootSlot) {
  return BigInt(
    ethers.keccak256(
      abiCoder.encode([keyType, "uint256"], [key, BigInt(rootSlot)])
    )
  );
}

function dynamicArrayDataSlot(lengthSlot) {
  return BigInt(
    ethers.keccak256(abiCoder.encode(["uint256"], [BigInt(lengthSlot)]))
  );
}

function asStorageWord(value) {
  if (typeof value === "string" && ethers.isHexString(value, 32)) {
    return value;
  }
  return ethers.zeroPadValue(ethers.toBeHex(BigInt(value)), 32);
}

async function setStorageWord(contractAddress, slot, value) {
  await ethers.provider.send("hardhat_setStorageAt", [
    contractAddress,
    ethers.toBeHex(BigInt(slot), 32),
    asStorageWord(value),
  ]);
}

async function getStorageBigInt(contractAddress, slot) {
  return BigInt(await ethers.provider.getStorage(contractAddress, BigInt(slot)));
}

module.exports = {
  FacetCutAction,
  INIT_VALUES,
  getSelectors,
  deploy,
  deployBaselineDiamond,
  mappingEntrySlot,
  dynamicArrayDataSlot,
  asStorageWord,
  setStorageWord,
  getStorageBigInt,
};
