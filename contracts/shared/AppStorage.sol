// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

enum OrderType { BUY, SELL }
enum OrderStatus { CREATED, ASSIGNED, ACCEPTED, FIAT_SENT, COMPLETED, CANCELLED, DISPUTED }
enum MerchantStatus { PENDING, ACTIVE, INACTIVE, BLACKLISTED, DISPUTED, UNSTAKE_PENDING, EXITED }
enum MerchantAvailability { ONLINE, OFFLINE }
enum ChannelStatus { PENDING, APPROVED, REJECTED, TERMINATED }
enum ChannelAvailability { ACTIVE, INACTIVE }
enum DisputeStatus { NONE, OPEN, RESOLVED }
enum DisputeResolution { CANCEL_TRADE, SETTLE_TRADE }

struct PlatformConfig {
    address usdcToken;
    address executor;
    bool paused;
    uint256 minMerchantStakeUsdc;
}

struct LatestPrice {
    uint256 buyPriceE6;
    uint256 sellPriceE6;
    uint256 updatedAt;
}

struct MerchantV2 {
    address wallet;
    MerchantStatus status;
    MerchantAvailability availability;
    uint256 stakeUsdc;
    uint256 liquidityUsdc;
    uint256 reservedUsdc;
    uint256 disputeLockedUsdc;
    uint256 reservedFiatE6;
    uint256 obligationCount;
    uint256 registeredAt;
    uint256 reviewedAt;
    uint256 channelNonce;
}

struct PaymentChannelV2 {
    bytes32 channelId;
    address merchant;
    ChannelStatus status;
    ChannelAvailability availability;
    uint8 sideMask;
    uint256 fiatCapacityE6;
    uint256 reservedFiatE6;
    uint256 obligationCount;
    uint256 registeredAt;
    uint256 reviewedAt;
    uint256 updatedAt;
}

struct OrderV2 {
    bytes32 orderId;
    uint256 orderNumber;
    OrderType orderType;
    OrderStatus status;
    address user;
    address merchant;
    bytes32 channelId;
    uint256 usdcAmount;
    uint256 fiatAmountE6;
    uint256 selectedPriceE6;
    uint256 createdAt;
    uint256 acceptedAt;
    uint256 fiatSentAt;
    uint256 completedAt;
    uint256 cancelledAt;
    bool custodyFinalized;
}

struct DisputeV2 {
    DisputeStatus status;
    DisputeResolution resolution;
    OrderStatus priorOrderStatus;
    address openedBy;
    address resolver;
    uint256 openedAt;
    uint256 resolvedAt;
}

struct AppStorageV2 {
    bytes32 initializedMagic;
    PlatformConfig config;
    uint256 reentrancyStatus;
    LatestPrice latestPrice;
    mapping(address => MerchantV2) merchants;
    mapping(bytes32 => PaymentChannelV2) channels;
    uint256 orderNonce;
    mapping(bytes32 => OrderV2) orders;
    mapping(bytes32 => DisputeV2) disputes;
    uint256 totalMerchantStakeUsdc;
    uint256 totalMerchantLiquidityUsdc;
    uint256 totalReservedBuyUsdc;
    uint256 totalSellEscrowUsdc;
}
