// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// =============================================================================
// AppStorage — merchant + platform config only (Diamond delegatecall slot 0)
// =============================================================================

/// @notice Merchant account standing — admin only (not self-service), except
///         INACTIVE which is set when the merchant has a pending USDC unstake request.
enum MerchantAccountStatus {
    ACTIVE,
    INACTIVE, // unstake requested; waiting for admin approve / reject
    BLACKLISTED,
    DISPUTED
}

/// @notice Merchant presence — merchant toggles when account is ACTIVE
enum MerchantAvailability {
    ONLINE,
    OFFLINE
}

/// @notice Channel lifecycle — admin sets APPROVED / REJECTED / TERMINATED
enum ChannelStatus {
    PENDING,
    APPROVED,
    REJECTED,
    TERMINATED
}

/// @notice When APPROVED, merchant toggles ACTIVE / INACTIVE for taking orders
enum ChannelAvailability {
    ACTIVE,
    INACTIVE
}

// ── Order model ──────────────────────────────────────────────────────────────

/// @notice Direction of the trade from the USER's perspective.
enum OrderType {
    BUY, // user pays INR to receive USDC
    SELL // user gives USDC to receive INR
}

enum OrderStatus {
    CREATED, // assigned to merchants, waiting for one to accept
    ACCEPTED, // one merchant took it; funds/fiat reserved
    PAID, // BUY: user has marked INR sent; SELL: reached via COMPLETED path
    COMPLETED, // USDC swap effected
    CANCELLED
}

enum DisputeStatus {
    NONE,
    OPEN,
    SETTLED
}

enum DisputeResult {
    NONE,
    USER_WINS,
    MERCHANT_WINS
}

struct Order {
    bytes32 orderId;
    OrderType orderType;
    OrderStatus status;
    address user;
    address merchant; // 0x0 until acceptance
    bytes32 channelId; // 0x0 until acceptance
    uint256 usdcAmount; // 6-decimal USDC atoms
    uint256 fiatAmount; // usdcAmount * price (implicitly 6-dec INR-equivalent)
    uint256 price; // INR per whole USDC (integer)
    uint256 createdAt;
    uint256 acceptedAt;
    uint256 paidAt;
    uint256 completedAt;
    uint256 cancelledAt;
    uint256 disputeExpiresAt; // 0 unless SELL COMPLETED; window during which raiseDispute is allowed
    DisputeStatus disputeStatus;
    address disputeResolver;
    DisputeResult disputeResult;
    address[] assignedMerchants;
    bool riskReleased; // true once risk_usdc has been released (SELL only)
}

struct Merchant {
    address wallet;
    MerchantAccountStatus accountStatus;
    MerchantAvailability availability;
    uint256 usdcLiquidity; // total_usdc — USDC custodied for this merchant (incl. stake)
    /// @dev Full-liquidity snapshot when `withdrawStake()` request is raised; cleared on approve/reject.
    bool unstakePending;
    uint256 unstakeRequestedAmount;
    string telegramUsername;
    uint256 registeredAt;
    bytes32[] channelIds;
    /// @notice reserved_usdc — sum of USDC committed to ACCEPTED/PAID BUY orders,
    ///         released on COMPLETED / CANCELLED / dispute.
    uint256 reservedUsdc;
    /// @notice risk_usdc — USDC credited to this merchant from COMPLETED SELL orders
    ///         that are still inside the dispute window. Unusable until settled.
    uint256 riskUsdc;
}

struct PaymentChannel {
    bytes32 channelId;
    address merchant;
    string bankName;
    string accountLast4;
    string upiId;
    string label;
    ChannelStatus status;
    ChannelAvailability availability;
    uint256 fiatBalance; // total_inr for this channel (6-decimal INR-equivalent units)
    uint256 appliedAt;
    uint256 reviewedAt;
    /// @dev DEPRECATED (v1.2, 2026-07-05). Per-channel volume overrides were removed;
    ///      every channel now inherits `PlatformConfig.defaultChannelDaily/MonthlyLimitUsdc`
    ///      unconditionally. Slots kept so downstream usage fields don't shift addresses.
    uint256 __deprecated_dailyLimitUsdc;
    uint256 __deprecated_monthlyLimitUsdc;
    /// @notice Rolling-window usage; `windowStart` is the unix timestamp at which the
    ///         current bucket was opened. The next order past `windowStart + windowLen`
    ///         auto-rolls the bucket and zeroes `used`.
    uint256 dailyVolumeUsed;
    uint256 dailyWindowStart;
    uint256 monthlyVolumeUsed;
    uint256 monthlyWindowStart;
    /// @notice reserved_inr — fiat committed to ACCEPTED SELL orders on this channel,
    ///         released on COMPLETED / CANCELLED.
    uint256 reservedFiat;
}

/// @notice Bare platform configuration (initialized in DiamondInit)
struct PlatformConfig {
    address admin;
    address usdcToken;
    bool paused;
    uint256 minMerchantStakeUsdc;
    /// @dev Set once by DiamondInit; later upgrades must NOT re-initialize.
    bool initialized;
}

struct AppStorage {
    PlatformConfig config;
    mapping(address => Merchant) merchants;
    address[] merchantList;
    mapping(bytes32 => PaymentChannel) channels;
    /// key = keccak256(abi.encodePacked(wallet, normalizedBankName, accountLast4))
    mapping(bytes32 => bool) channelDuplicateGuard;
    /// @dev Diamond-safe reentrancy lock. 0 = unset (treated as not entered), 1 = not entered, 2 = entered.
    uint256 _reentrancyStatus;
    // ── Upgrade-safe additions must be APPENDED below this line; never inserted
    //    into `PlatformConfig` or any other nested struct (that would shift every
    //    downstream slot on live diamonds).
    /// @notice Default per-channel daily volume ceiling in USDC (6 decimals),
    ///         applied when a channel's own `dailyLimitUsdc` is 0. `0` = unlimited.
    uint256 defaultChannelDailyLimitUsdc;
    /// @notice Default per-channel monthly (30-day rolling) volume ceiling in USDC.
    uint256 defaultChannelMonthlyLimitUsdc;
    // ── Order engine (v1.3, 2026-07-06) ─────────────────────────────────────
    /// @notice Hardcoded oracle price (INR per whole USDC) for BUY orders.
    uint256 buyPriceInrPerUsdc;
    /// @notice Hardcoded oracle price (INR per whole USDC) for SELL orders.
    uint256 sellPriceInrPerUsdc;
    /// @notice Dispute window seconds. During this window after a SELL COMPLETED
    ///         the merchant's newly-credited USDC sits in risk_usdc and cannot be reused.
    uint256 disputeWindowSeconds;
    /// @notice Monotonic counter used to derive deterministic order IDs.
    uint256 orderNonce;
    mapping(bytes32 => Order) orders;
    bytes32[] orderIds;
    mapping(address => bytes32[]) userOrderIds;
    mapping(address => bytes32[]) merchantOrderIds;
    /// @notice orderId => (merchant => true) — O(1) membership lookup for assignedMerchants.
    mapping(bytes32 => mapping(address => bool)) orderAssignmentIndex;
    // ── Merchant eligibility whitelist (v1.4, 2026-07-06) ────────────────────
    /// @notice Ordered list of merchant wallets that the order router will
    ///         consider when assigning up to 4 merchants. When empty (length 0)
    ///         the router falls back to iterating `merchantList` — i.e. every
    ///         registered merchant is eligible. Admin managed via ConfigFacet.
    address[] eligibleMerchants;
    /// @notice O(1) presence lookup for `eligibleMerchants`. Value is the 1-based
    ///         index into the array so removal can swap-pop.
    mapping(address => uint256) eligibleMerchantIndex;
}

contract Modifiers {
    AppStorage internal s;

    modifier onlyAdmin() {
        require(msg.sender == s.config.admin, "Not admin");
        _;
    }

    modifier notPaused() {
        require(!s.config.paused, "Platform is paused");
        _;
    }

    /// @notice Diamond-safe reentrancy guard. Backed by an AppStorage slot so all facets
    ///         that delegatecall into the Diamond share the same lock.
    modifier nonReentrant() {
        require(s._reentrancyStatus != 2, "ReentrancyGuard: reentrant call");
        s._reentrancyStatus = 2;
        _;
        s._reentrancyStatus = 1;
    }
}
