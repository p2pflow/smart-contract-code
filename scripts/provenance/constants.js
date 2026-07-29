"use strict";

const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const CHAIN_ID = 84532n;
const DIAMOND_ADDRESS = "0xF40AD901CCfB5E5EdC5162D6Ac7DDd5Ed5899F3A";
const OFFICIAL_RPC_URL = "https://sepolia.base.org";

const BASELINE_CONTRACTS = Object.freeze([
  Object.freeze({
    contractName: "Diamond",
    sourceName: "contracts/Diamond.sol",
    artifact: "artifacts/contracts/Diamond.sol/Diamond.json",
    address: DIAMOND_ADDRESS,
    runtimeHash:
      "0x054daffcd2719790d6adf588677a3d33d1fed526c9f7df652982639c082fb2ac",
    routed: false,
  }),
  Object.freeze({
    contractName: "DiamondCutFacet",
    sourceName: "contracts/facets/DiamondCutFacet.sol",
    artifact:
      "artifacts/contracts/facets/DiamondCutFacet.sol/DiamondCutFacet.json",
    address: "0x13E3B3C63362B1cad5430c3745dC96130E7a5117",
    runtimeHash:
      "0x2424f646578e3de36e604b7e34216ce8897386fa839098c3c5b3ea673bc45882",
    selectorCount: 1,
    routed: true,
  }),
  Object.freeze({
    contractName: "DiamondLoupeFacet",
    sourceName: "contracts/facets/DiamondLoupeFacet.sol",
    artifact:
      "artifacts/contracts/facets/DiamondLoupeFacet.sol/DiamondLoupeFacet.json",
    address: "0x3D50E8DF96e7F43a8570A9e54C42F8b559fffB58",
    runtimeHash:
      "0x5014f72ae8c67eb0e572ea963fb29fa738ac907030beb07fc05ec4a2ae9d9fa2",
    selectorCount: 5,
    routed: true,
  }),
  Object.freeze({
    contractName: "OwnershipFacet",
    sourceName: "contracts/facets/OwnershipFacet.sol",
    artifact:
      "artifacts/contracts/facets/OwnershipFacet.sol/OwnershipFacet.json",
    address: "0x2c63a6234D1a587D7b160FF96fF703c1097f7b30",
    runtimeHash:
      "0x17ec3cbff6f1fc9cee7a73c2088afd37c239942643991f82bf5c915983e2cca9",
    selectorCount: 2,
    routed: true,
  }),
  Object.freeze({
    contractName: "ConfigFacet",
    sourceName: "contracts/facets/ConfigFacet.sol",
    artifact: "artifacts/contracts/facets/ConfigFacet.sol/ConfigFacet.json",
    address: "0xcF9510e42511014FaB632238Dbf5250562C61D83",
    runtimeHash:
      "0xcfcc9996adf72d0bebab17b5695c21a14aa325057a3255ad4764b3242dde5a27",
    selectorCount: 15,
    routed: true,
  }),
  Object.freeze({
    contractName: "MerchantFacet",
    sourceName: "contracts/facets/MerchantFacet.sol",
    artifact: "artifacts/contracts/facets/MerchantFacet.sol/MerchantFacet.json",
    address: "0x2C1e028064c18aD316Fa8Fa69d1B328cC219E97D",
    runtimeHash:
      "0x30cc890cbb1341416dd68abfdf11802579ababd6a56ffdd0601dc96d0cfa2541",
    selectorCount: 24,
    routed: true,
  }),
  Object.freeze({
    contractName: "OrderFacet",
    sourceName: "contracts/facets/OrderFacet.sol",
    artifact: "artifacts/contracts/facets/OrderFacet.sol/OrderFacet.json",
    address: "0xCCA73B72b83FDccfBFe4294224c32ccc305df4Fb",
    runtimeHash:
      "0xa31a0fef91f6d951ef4aff395a1273e6331248aff54bdd82342570168df354a6",
    selectorCount: 16,
    routed: true,
  }),
]);

const BASELINE_BY_NAME = new Map(
  BASELINE_CONTRACTS.map((entry) => [entry.contractName, entry])
);

const ROUTED_BASELINE = BASELINE_CONTRACTS.filter((entry) => entry.routed);

const AA6_FUNCTION_SIGNATURES = Object.freeze({
  DiamondCutFacet: Object.freeze([
    "diamondCut((address,uint8,bytes4[])[],address,bytes)",
  ]),
  DiamondLoupeFacet: Object.freeze([
    "facetAddress(bytes4)",
    "facetAddresses()",
    "facetFunctionSelectors(address)",
    "facets()",
    "supportsInterface(bytes4)",
  ]),
  OwnershipFacet: Object.freeze(["owner()", "transferOwnership(address)"]),
  ConfigFacet: Object.freeze([
    "addEligibleMerchant(address)",
    "clearEligibleMerchants()",
    "getChannelLimitDefaults()",
    "getConfig()",
    "getEligibleMerchants()",
    "getOrderPricing()",
    "isEligibleMerchant(address)",
    "pausePlatform()",
    "removeEligibleMerchant(address)",
    "setDefaultChannelLimits(uint256,uint256)",
    "setDisputeWindow(uint256)",
    "setMinMerchantStake(uint256)",
    "setOrderPricing(uint256,uint256)",
    "transferPlatformAdmin(address)",
    "unpausePlatform()",
  ]),
  MerchantFacet: Object.freeze([
    "addPaymentChannel(string,string,string,string)",
    "approveChannel(bytes32)",
    "approveMerchantUnstake(address)",
    "blacklistMerchant(address)",
    "clearMerchantDispute(address)",
    "depositStake(uint256)",
    "getAllMerchants()",
    "getChannel(bytes32)",
    "getChannelLimits(bytes32)",
    "getMerchant(address)",
    "getMerchantChannels(address)",
    "getMyChannels()",
    "getMyProfile()",
    "getPendingChannels()",
    "goOffline()",
    "goOnline()",
    "migrateAndTerminate(bytes32,bytes32)",
    "registerMerchant(uint256,string)",
    "rejectChannel(bytes32)",
    "rejectMerchantUnstake(address)",
    "setMerchantDisputed(address)",
    "setPaymentChannelActive(bytes32)",
    "setPaymentChannelInactive(bytes32)",
    "withdrawStake()",
  ]),
  OrderFacet: Object.freeze([
    "acceptOrder(bytes32,bytes32)",
    "cancelOrder(bytes32)",
    "confirmPayment(bytes32)",
    "createBuyOrder(uint256)",
    "createSellOrder(uint256)",
    "getAssignedMerchants(bytes32)",
    "getChannelFiat(bytes32)",
    "getMerchantBalances(address)",
    "getMerchantOrders(address)",
    "getOrder(bytes32)",
    "getOrderIds()",
    "getUserOrders(address)",
    "markPaymentSent(bytes32)",
    "raiseDispute(bytes32)",
    "resolveDispute(bytes32,uint8)",
    "settleOrder(bytes32)",
  ]),
});

module.exports = {
  AA6_FUNCTION_SIGNATURES,
  BASELINE_BY_NAME,
  BASELINE_CONTRACTS,
  CHAIN_ID,
  DIAMOND_ADDRESS,
  OFFICIAL_RPC_URL,
  PROJECT_ROOT,
  ROUTED_BASELINE,
};
