// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Direction of the trade from the user's perspective.
enum OrderType {
    BUY,
    SELL
}

/// @dev Ordinals are part of the v2 protocol and must match @p2pflow/protocol.
enum OrderStatus {
    CREATED,
    ASSIGNED,
    ACCEPTED,
    FIAT_SENT,
    COMPLETED,
    CANCELLED,
    EXPIRED,
    DISPUTED
}

enum MerchantStatus {
    PENDING,
    ACTIVE,
    INACTIVE,
    BLACKLISTED,
    DISPUTED,
    EXITING,
    EXITED
}

enum MerchantAvailability {
    ONLINE,
    OFFLINE
}

enum ChannelStatus {
    PENDING,
    APPROVED,
    REJECTED,
    TERMINATED
}

enum ChannelAvailability {
    ACTIVE,
    INACTIVE
}

enum DisputeStatus {
    NONE,
    OPEN,
    RESOLVED
}

enum DisputeResolution {
    CANCEL_TRADE,
    SETTLE_TRADE
}

enum CandidateStatus {
    NONE,
    ASSIGNED,
    REJECTED,
    ACCEPTED,
    EXPIRED,
    RELEASED
}

enum PublicationKind {
    AUTOMATED,
    EMERGENCY
}

struct SafetyConfig {
    uint256 orderLifetimeSeconds;
    uint256 assignmentLifetimeSeconds;
    uint256 acceptedRecoverySeconds;
    uint256 maxQuoteValiditySeconds;
}

struct PlatformConfigV2 {
    bytes32 protocolId;
    uint256 protocolVersion;
    uint256 layoutVersion;
    address usdcToken;
    bool paused;
    uint256 minMerchantStakeUsdc;
    SafetyConfig safety;
}

struct PricePolicy {
    uint256 sourceQuorum;
    uint256 maxAgeSeconds;
    uint256 maxDeviationBps;
}

struct PriceRound {
    uint256 roundId;
    uint256 buyPriceE6;
    uint256 sellPriceE6;
    uint256 sourceObservedAt;
    uint256 publishedAt;
    uint256 sourceCount;
    /// @notice Commitment to normalized source identities, observations and policy inputs.
    bytes32 evidenceDigest;
    PublicationKind publicationKind;
}

struct MerchantV2 {
    address wallet;
    MerchantStatus status;
    MerchantAvailability availability;
    uint256 stakeUsdc;
    uint256 liquidityUsdc;
    uint256 reservedUsdc;
    uint256 disputeLockedUsdc;
    /// @notice Aggregate of reservedFiatE6 across this merchant's channels.
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

struct Candidate {
    address merchant;
    bytes32 channelId;
}

struct AssignmentState {
    uint256 assignedAt;
    uint256 deadline;
    /// @notice Executor decision/evidence commitment and idempotency key.
    bytes32 decisionDigest;
    uint8 candidateCount;
    Candidate[4] candidates;
    CandidateStatus[4] candidateStatuses;
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
    uint256 roundId;
    uint256 createdAt;
    uint256 orderDeadline;
    uint256 acceptedAt;
    uint256 acceptedRecoveryDeadline;
    uint256 fiatSentAt;
    uint256 completedAt;
    uint256 cancelledAt;
    uint256 expiredAt;
    uint256 assignmentEpoch;
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

struct RoleData {
    mapping(address => bool) members;
    uint256 memberCount;
}

/// @notice Fresh v2 application state. It is stored at a dedicated namespace by
///         LibAppStorage and is never overlaid on the legacy slot-zero layout.
/// @dev Append fields only after a shared v2 deployment. Never reorder this struct.
struct AppStorageV2 {
    bytes32 initializedMagic;
    PlatformConfigV2 config;
    uint256 reentrancyStatus;
    mapping(bytes32 => RoleData) roles;
    PricePolicy pricePolicy;
    uint256 latestPriceRoundId;
    mapping(uint256 => PriceRound) priceRounds;
    mapping(address => MerchantV2) merchants;
    address[] merchantIndex;
    mapping(bytes32 => PaymentChannelV2) channels;
    mapping(address => bytes32[]) merchantChannelIndex;
    uint256 orderNonce;
    mapping(bytes32 => OrderV2) orders;
    bytes32[] orderIndex;
    mapping(address => bytes32[]) userOrderIndex;
    mapping(address => bytes32[]) merchantOrderIndex;
    mapping(bytes32 => AssignmentState) assignments;
    mapping(bytes32 => bool) usedDecisionDigests;
    mapping(bytes32 => DisputeV2) disputes;
    uint256 totalMerchantStakeUsdc;
    uint256 totalMerchantLiquidityUsdc;
    uint256 totalReservedBuyUsdc;
    uint256 totalSellEscrowUsdc;
}
