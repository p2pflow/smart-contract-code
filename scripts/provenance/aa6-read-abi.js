"use strict";

// Immutable, payment-value-free ABI fragments for reads against the exact aa6
// generation. These remain valid after a later local compile produces v2 artifacts.
const AA6_READ_ABI = Object.freeze({
  DiamondLoupeFacet: Object.freeze([
    "function facets() view returns ((address facetAddress,bytes4[] functionSelectors)[] facets_)",
  ]),
  OwnershipFacet: Object.freeze([
    "function owner() view returns (address owner_)",
  ]),
  ConfigFacet: Object.freeze([
    "function getConfig() view returns ((address admin,address usdcToken,bool paused,uint256 minMerchantStakeUsdc,bool initialized))",
    "function getChannelLimitDefaults() view returns (uint256 dailyUsdc,uint256 monthlyUsdc)",
    "function getOrderPricing() view returns (uint256 buyPriceInrPerUsdc,uint256 sellPriceInrPerUsdc,uint256 disputeWindowSeconds)",
    "function getEligibleMerchants() view returns (address[])",
  ]),
  MerchantFacet: Object.freeze([
    "function getAllMerchants() view returns (address[])",
    "function getMerchant(address wallet) view returns ((address wallet,uint8 accountStatus,uint8 availability,uint256 usdcLiquidity,bool unstakePending,uint256 unstakeRequestedAmount,string telegramUsername,uint256 registeredAt,bytes32[] channelIds,uint256 reservedUsdc,uint256 riskUsdc))",
    "function getChannel(bytes32 channelId) view returns ((bytes32 channelId,address merchant,string bankName,string accountLast4,string upiId,string label,uint8 status,uint8 availability,uint256 fiatBalance,uint256 appliedAt,uint256 reviewedAt,uint256 __deprecated_dailyLimitUsdc,uint256 __deprecated_monthlyLimitUsdc,uint256 dailyVolumeUsed,uint256 dailyWindowStart,uint256 monthlyVolumeUsed,uint256 monthlyWindowStart,uint256 reservedFiat))",
  ]),
  OrderFacet: Object.freeze([
    "function getOrderIds() view returns (bytes32[])",
    "function getOrder(bytes32 orderId) view returns ((bytes32 orderId,uint8 orderType,uint8 status,address user,address merchant,bytes32 channelId,uint256 usdcAmount,uint256 fiatAmount,uint256 price,uint256 createdAt,uint256 acceptedAt,uint256 paidAt,uint256 completedAt,uint256 cancelledAt,uint256 disputeExpiresAt,uint8 disputeStatus,address disputeResolver,uint8 disputeResult,address[] assignedMerchants,bool riskReleased))",
    "event OrderCreated(bytes32 indexed orderId,address indexed user,uint8 orderType,uint256 usdcAmount,uint256 fiatAmount,uint256 price,uint256 createdAt)",
  ]),
  ERC20: Object.freeze([
    "function balanceOf(address account) view returns (uint256)",
  ]),
});

module.exports = { AA6_READ_ABI };
