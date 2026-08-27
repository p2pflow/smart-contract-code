// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

enum OrderType { BUY, SELL }
enum OrderMode { STANDARD, SCAN_PAY }
enum OrderStatus { CREATED, ASSIGNED, ACCEPTED, FIAT_SENT, COMPLETED, CANCELLED, DISPUTED }
enum MerchantStatus { PENDING, ACTIVE, INACTIVE, BLACKLISTED, DISPUTED, UNSTAKE_PENDING, EXITED }
enum MerchantAvailability { ONLINE, OFFLINE }
enum ChannelStatus { PENDING, APPROVED, REJECTED, TERMINATED }
enum ChannelAvailability { ACTIVE, INACTIVE }
enum DisputeStatus { NONE, OPEN, RESOLVED }
enum DisputeResolution { NONE, NEUTRAL }
enum CancellationReason {
    NONE,
    USER_CANCELLED,
    NO_ELIGIBLE_MERCHANT,
    ORDER_EXPIRED,
    USER_FUNDS_UNAVAILABLE
}

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
    uint256 depositedStakeUsdc;
    uint256 reservedUsdc;
    uint256 reservedFiatE6;
    uint256 obligationCount;
    uint256 openDisputeCount;
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

struct AssignmentCandidate {
    address merchant;
    bytes32 channelId;
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
    uint256 assignedAt;
    uint256 acceptedAt;
    uint256 fiatSentAt;
    uint256 completedAt;
    uint256 cancelledAt;
    uint256 expiresAt;
    uint256 disputeDeadline;
    address cancelledBy;
    CancellationReason cancellationReason;
    bool sellEscrowed;
    bool custodyFinalized;
    OrderMode orderMode;
    bool paymentDetailsShared;
    uint256 paymentDetailsSharedAt;
}

struct DisputeV2 {
    DisputeStatus status;
    DisputeResolution resolution;
    OrderStatus priorOrderStatus;
    OrderType orderType;
    address merchant;
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
    uint256 totalDepositedStakeUsdc;
    uint256 totalReservedBuyUsdc;
    uint256 totalSellEscrowUsdc;
    mapping(bytes32 => AssignmentCandidate[]) orderCandidates;
    mapping(bytes32 => mapping(address => mapping(bytes32 => bool))) isOrderCandidate;
    mapping(bytes32 => mapping(address => mapping(bytes32 => bool))) candidateDeclined;
}
