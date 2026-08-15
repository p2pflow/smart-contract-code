// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {
    AppStorageV2,
    ChannelAvailability,
    ChannelStatus,
    MerchantAvailability,
    MerchantStatus,
    MerchantV2,
    PaymentChannelV2
} from "../shared/AppStorage.sol";
import {
    CapacityBelowReserved,
    ChannelHasObligations,
    ChannelNotFound,
    InsufficientAvailableLiquidity,
    InvalidAmount,
    InvalidChannelStatus,
    InvalidMerchantStatus,
    InvalidSideMask,
    MerchantAlreadyRegistered,
    MerchantHasObligations,
    MerchantNotActive,
    MerchantNotFound,
    MerchantStakeBelowMinimum,
    PageLimitInvalid,
    PlatformIsPaused
} from "../shared/Errors.sol";
import {Modifiers} from "../shared/Modifiers.sol";
import {LibAccess} from "../libraries/LibAccess.sol";
import {LibAppStorage} from "../libraries/LibAppStorage.sol";
import {LibCustody} from "../libraries/LibCustody.sol";
import {LibMerchants} from "../libraries/LibMerchants.sol";

/// @notice Privacy-safe merchant, stake, liquidity and opaque channel management.
contract MerchantFacet is Modifiers {
    event MerchantRegistered(address indexed wallet, uint256 stakeUsdc, uint256 registeredAt);
    event MerchantApproved(address indexed wallet, address indexed operator, uint256 reviewedAt);
    event MerchantStatusUpdated(
        address indexed wallet,
        MerchantStatus previousStatus,
        MerchantStatus newStatus,
        address indexed operator
    );
    event MerchantAvailabilityUpdated(
        address indexed wallet,
        MerchantAvailability availability,
        uint256 updatedAt
    );
    event MerchantStakeDeposited(address indexed wallet, uint256 amount, uint256 totalStakeUsdc);
    event MerchantExitRequested(address indexed wallet, uint256 requestedAt);
    event MerchantStakeWithdrawn(address indexed wallet, uint256 amount);
    event MerchantLiquidityDeposited(address indexed wallet, uint256 amount, uint256 totalLiquidityUsdc);
    event MerchantLiquidityWithdrawn(address indexed wallet, uint256 amount, uint256 totalLiquidityUsdc);
    event PaymentChannelRegistered(
        bytes32 indexed channelId,
        address indexed merchant,
        uint8 sideMask,
        uint256 fiatCapacityE6,
        uint256 registeredAt
    );
    event PaymentChannelReviewed(
        bytes32 indexed channelId,
        address indexed merchant,
        ChannelStatus status,
        address indexed operator,
        uint256 reviewedAt
    );
    event PaymentChannelAvailabilityUpdated(
        bytes32 indexed channelId,
        address indexed merchant,
        ChannelAvailability availability,
        uint256 updatedAt
    );
    event PaymentChannelCapacityUpdated(
        bytes32 indexed channelId,
        address indexed merchant,
        uint256 fiatCapacityE6,
        uint256 updatedAt
    );
    event PaymentChannelTerminated(bytes32 indexed channelId, address indexed merchant, uint256 terminatedAt);

    function registerMerchant(uint256 stakeAmount)
        external
        whenNotPaused
        nonReentrant
    {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        if (s.merchants[msg.sender].wallet != address(0)) revert MerchantAlreadyRegistered();
        if (stakeAmount < s.config.minMerchantStakeUsdc) revert InvalidAmount();

        MerchantV2 storage merchant = s.merchants[msg.sender];
        merchant.wallet = msg.sender;
        merchant.status = MerchantStatus.PENDING;
        merchant.availability = MerchantAvailability.OFFLINE;
        merchant.stakeUsdc = stakeAmount;
        merchant.registeredAt = block.timestamp;
        s.merchantIndex.push(msg.sender);
        s.totalMerchantStakeUsdc += stakeAmount;

        LibCustody.pullExact(msg.sender, stakeAmount);
        emit MerchantRegistered(msg.sender, stakeAmount, block.timestamp);
    }

    function approveMerchant(address wallet)
        external
        onlyRole(LibAccess.OPERATOR_ROLE)
        whenNotPaused
        nonReentrant
    {
        MerchantV2 storage merchant = _requireMerchant(wallet);
        if (merchant.status != MerchantStatus.PENDING) revert InvalidMerchantStatus();
        _enforceMinimumStake(merchant);
        merchant.status = MerchantStatus.ACTIVE;
        merchant.reviewedAt = block.timestamp;
        emit MerchantApproved(wallet, msg.sender, block.timestamp);
    }

    function setMerchantStatus(address wallet, MerchantStatus newStatus)
        external
        onlyRole(LibAccess.OPERATOR_ROLE)
        nonReentrant
    {
        if (
            newStatus == MerchantStatus.PENDING ||
            newStatus == MerchantStatus.EXITING ||
            newStatus == MerchantStatus.EXITED
        ) revert InvalidMerchantStatus();
        MerchantV2 storage merchant = _requireMerchant(wallet);
        if (merchant.status == MerchantStatus.EXITING || merchant.status == MerchantStatus.EXITED) {
            revert InvalidMerchantStatus();
        }
        MerchantStatus previous = merchant.status;
        if (!_isAllowedStatusTransition(previous, newStatus)) revert InvalidMerchantStatus();
        if (newStatus == MerchantStatus.ACTIVE) _enforceMinimumStake(merchant);
        merchant.status = newStatus;
        merchant.reviewedAt = block.timestamp;
        if (newStatus != MerchantStatus.ACTIVE) {
            merchant.availability = MerchantAvailability.OFFLINE;
        }
        emit MerchantStatusUpdated(wallet, previous, newStatus, msg.sender);
    }

    function depositStake(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert InvalidAmount();
        AppStorageV2 storage s = LibAppStorage.appStorage();
        MerchantV2 storage merchant = _requireMerchant(msg.sender);
        if (merchant.status == MerchantStatus.EXITING || merchant.status == MerchantStatus.EXITED) {
            revert InvalidMerchantStatus();
        }
        merchant.stakeUsdc += amount;
        s.totalMerchantStakeUsdc += amount;
        LibCustody.pullExact(msg.sender, amount);
        emit MerchantStakeDeposited(msg.sender, amount, merchant.stakeUsdc);
    }

    function requestMerchantExit() external nonReentrant {
        MerchantV2 storage merchant = _requireMerchant(msg.sender);
        if (
            merchant.status != MerchantStatus.PENDING &&
            merchant.status != MerchantStatus.ACTIVE &&
            merchant.status != MerchantStatus.INACTIVE
        ) {
            revert InvalidMerchantStatus();
        }
        _enforceNoObligations(merchant);
        if (merchant.liquidityUsdc != 0) {
            revert InsufficientAvailableLiquidity(0, merchant.liquidityUsdc);
        }
        merchant.status = MerchantStatus.EXITING;
        merchant.availability = MerchantAvailability.OFFLINE;
        emit MerchantExitRequested(msg.sender, block.timestamp);
    }

    function withdrawStake() external nonReentrant {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        MerchantV2 storage merchant = _requireMerchant(msg.sender);
        if (merchant.status != MerchantStatus.EXITING) revert InvalidMerchantStatus();
        _enforceNoObligations(merchant);
        if (merchant.liquidityUsdc != 0) {
            revert InsufficientAvailableLiquidity(0, merchant.liquidityUsdc);
        }
        uint256 amount = merchant.stakeUsdc;
        if (amount == 0) revert InvalidAmount();

        merchant.stakeUsdc = 0;
        merchant.status = MerchantStatus.EXITED;
        s.totalMerchantStakeUsdc -= amount;
        LibCustody.pushExact(msg.sender, amount);
        emit MerchantStakeWithdrawn(msg.sender, amount);
    }

    function depositLiquidity(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert InvalidAmount();
        AppStorageV2 storage s = LibAppStorage.appStorage();
        MerchantV2 storage merchant = _requireMerchant(msg.sender);
        if (merchant.status != MerchantStatus.ACTIVE) revert MerchantNotActive(msg.sender);
        merchant.liquidityUsdc += amount;
        s.totalMerchantLiquidityUsdc += amount;
        LibCustody.pullExact(msg.sender, amount);
        emit MerchantLiquidityDeposited(msg.sender, amount, merchant.liquidityUsdc);
    }

    function withdrawLiquidity(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        AppStorageV2 storage s = LibAppStorage.appStorage();
        MerchantV2 storage merchant = _requireMerchant(msg.sender);
        if (merchant.status == MerchantStatus.EXITED) revert InvalidMerchantStatus();
        uint256 available = LibMerchants.availableUsdc(merchant);
        if (available < amount) revert InsufficientAvailableLiquidity(available, amount);

        merchant.liquidityUsdc -= amount;
        s.totalMerchantLiquidityUsdc -= amount;
        LibCustody.pushExact(msg.sender, amount);
        emit MerchantLiquidityWithdrawn(msg.sender, amount, merchant.liquidityUsdc);
    }

    function setAvailability(MerchantAvailability availability) external nonReentrant {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        MerchantV2 storage merchant = _requireMerchant(msg.sender);
        if (availability == MerchantAvailability.ONLINE) {
            if (s.config.paused) revert PlatformIsPaused();
            if (merchant.status != MerchantStatus.ACTIVE) revert MerchantNotActive(msg.sender);
        }
        merchant.availability = availability;
        emit MerchantAvailabilityUpdated(msg.sender, availability, block.timestamp);
    }

    function registerPaymentChannel(uint8 sideMask, uint256 fiatCapacityE6)
        external
        whenNotPaused
        nonReentrant
        returns (bytes32 channelId)
    {
        if (sideMask == 0 || sideMask > LibMerchants.SIDE_BOTH) revert InvalidSideMask(sideMask);
        if (fiatCapacityE6 == 0) revert InvalidAmount();
        AppStorageV2 storage s = LibAppStorage.appStorage();
        MerchantV2 storage merchant = _requireMerchant(msg.sender);
        if (merchant.status != MerchantStatus.ACTIVE) revert MerchantNotActive(msg.sender);

        merchant.channelNonce += 1;
        channelId = LibMerchants.generateChannelId(
            address(this),
            msg.sender,
            merchant.channelNonce,
            block.chainid
        );
        PaymentChannelV2 storage channel = s.channels[channelId];
        channel.channelId = channelId;
        channel.merchant = msg.sender;
        channel.status = ChannelStatus.PENDING;
        channel.availability = ChannelAvailability.INACTIVE;
        channel.sideMask = sideMask;
        channel.fiatCapacityE6 = fiatCapacityE6;
        channel.registeredAt = block.timestamp;
        channel.updatedAt = block.timestamp;
        s.merchantChannelIndex[msg.sender].push(channelId);

        emit PaymentChannelRegistered(channelId, msg.sender, sideMask, fiatCapacityE6, block.timestamp);
    }

    function reviewPaymentChannel(bytes32 channelId, ChannelStatus status)
        external
        onlyRole(LibAccess.OPERATOR_ROLE)
        nonReentrant
    {
        if (status != ChannelStatus.APPROVED && status != ChannelStatus.REJECTED) {
            revert InvalidChannelStatus();
        }
        AppStorageV2 storage s = LibAppStorage.appStorage();
        if (status == ChannelStatus.APPROVED && s.config.paused) revert PlatformIsPaused();
        PaymentChannelV2 storage channel = _requireChannel(channelId);
        if (channel.status != ChannelStatus.PENDING) revert InvalidChannelStatus();
        if (status == ChannelStatus.APPROVED) {
            MerchantV2 storage merchant = _requireMerchant(channel.merchant);
            if (merchant.status != MerchantStatus.ACTIVE) revert MerchantNotActive(channel.merchant);
        }
        channel.status = status;
        channel.availability = ChannelAvailability.INACTIVE;
        channel.reviewedAt = block.timestamp;
        channel.updatedAt = block.timestamp;
        emit PaymentChannelReviewed(channelId, channel.merchant, status, msg.sender, block.timestamp);
    }

    function setChannelAvailability(bytes32 channelId, ChannelAvailability availability)
        external
        nonReentrant
    {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        PaymentChannelV2 storage channel = _requireOwnedChannel(channelId);
        if (channel.status != ChannelStatus.APPROVED) revert InvalidChannelStatus();
        if (availability == ChannelAvailability.ACTIVE) {
            if (s.config.paused) revert PlatformIsPaused();
            MerchantV2 storage merchant = _requireMerchant(msg.sender);
            if (merchant.status != MerchantStatus.ACTIVE) revert MerchantNotActive(msg.sender);
        }
        channel.availability = availability;
        channel.updatedAt = block.timestamp;
        emit PaymentChannelAvailabilityUpdated(channelId, msg.sender, availability, block.timestamp);
    }

    function setChannelFiatCapacity(bytes32 channelId, uint256 fiatCapacityE6)
        external
        nonReentrant
    {
        PaymentChannelV2 storage channel = _requireOwnedChannel(channelId);
        if (channel.status != ChannelStatus.APPROVED) revert InvalidChannelStatus();
        if (fiatCapacityE6 < channel.reservedFiatE6) {
            revert CapacityBelowReserved(fiatCapacityE6, channel.reservedFiatE6);
        }
        channel.fiatCapacityE6 = fiatCapacityE6;
        channel.updatedAt = block.timestamp;
        emit PaymentChannelCapacityUpdated(channelId, msg.sender, fiatCapacityE6, block.timestamp);
    }

    function terminatePaymentChannel(bytes32 channelId) external nonReentrant {
        PaymentChannelV2 storage channel = _requireOwnedChannel(channelId);
        if (
            channel.status != ChannelStatus.PENDING &&
            channel.status != ChannelStatus.APPROVED &&
            channel.status != ChannelStatus.REJECTED
        ) {
            revert InvalidChannelStatus();
        }
        if (channel.reservedFiatE6 != 0) {
            revert CapacityBelowReserved(0, channel.reservedFiatE6);
        }
        if (channel.obligationCount != 0) {
            revert ChannelHasObligations(channelId, channel.obligationCount);
        }
        channel.status = ChannelStatus.TERMINATED;
        channel.availability = ChannelAvailability.INACTIVE;
        channel.updatedAt = block.timestamp;
        emit PaymentChannelTerminated(channelId, msg.sender, block.timestamp);
    }

    function getMerchant(address wallet) external view onlyInitialized returns (MerchantV2 memory) {
        return _requireMerchant(wallet);
    }

    function getChannel(bytes32 channelId) external view onlyInitialized returns (PaymentChannelV2 memory) {
        return _requireChannel(channelId);
    }

    function getMerchantPage(uint256 cursor, uint256 limit)
        external
        view
        onlyInitialized
        returns (MerchantV2[] memory items, uint256 nextCursor)
    {
        _validatePageLimit(limit);
        AppStorageV2 storage s = LibAppStorage.appStorage();
        uint256 length = s.merchantIndex.length;
        if (cursor >= length) return (new MerchantV2[](0), length);
        uint256 end = cursor + limit;
        if (end > length) end = length;
        items = new MerchantV2[](end - cursor);
        for (uint256 i = cursor; i < end; ++i) {
            items[i - cursor] = s.merchants[s.merchantIndex[i]];
        }
        return (items, end);
    }

    function getMerchantChannelPage(address wallet, uint256 cursor, uint256 limit)
        external
        view
        onlyInitialized
        returns (PaymentChannelV2[] memory items, uint256 nextCursor)
    {
        _requireMerchant(wallet);
        _validatePageLimit(limit);
        AppStorageV2 storage s = LibAppStorage.appStorage();
        bytes32[] storage ids = s.merchantChannelIndex[wallet];
        if (cursor >= ids.length) return (new PaymentChannelV2[](0), ids.length);
        uint256 end = cursor + limit;
        if (end > ids.length) end = ids.length;
        items = new PaymentChannelV2[](end - cursor);
        for (uint256 i = cursor; i < end; ++i) {
            items[i - cursor] = s.channels[ids[i]];
        }
        return (items, end);
    }

    function getMerchantBalances(address wallet)
        external
        view
        onlyInitialized
        returns (
            uint256 stakeUsdc,
            uint256 liquidityUsdc,
            uint256 reservedUsdc,
            uint256 disputeLockedUsdc,
            uint256 availableUsdc,
            uint256 reservedFiatE6,
            uint256 obligationCount
        )
    {
        MerchantV2 storage merchant = _requireMerchant(wallet);
        return (
            merchant.stakeUsdc,
            merchant.liquidityUsdc,
            merchant.reservedUsdc,
            merchant.disputeLockedUsdc,
            LibMerchants.availableUsdc(merchant),
            merchant.reservedFiatE6,
            merchant.obligationCount
        );
    }

    function getChannelCapacity(bytes32 channelId)
        external
        view
        onlyInitialized
        returns (uint256 capacityE6, uint256 reservedE6, uint256 availableE6)
    {
        PaymentChannelV2 storage channel = _requireChannel(channelId);
        return (
            channel.fiatCapacityE6,
            channel.reservedFiatE6,
            LibMerchants.availableFiatE6(channel)
        );
    }

    function _requireMerchant(address wallet) private view returns (MerchantV2 storage merchant) {
        merchant = LibAppStorage.appStorage().merchants[wallet];
        if (merchant.wallet == address(0)) revert MerchantNotFound(wallet);
    }

    function _requireChannel(bytes32 channelId) private view returns (PaymentChannelV2 storage channel) {
        channel = LibAppStorage.appStorage().channels[channelId];
        if (channel.channelId == bytes32(0)) revert ChannelNotFound(channelId);
    }

    function _requireOwnedChannel(bytes32 channelId) private view returns (PaymentChannelV2 storage channel) {
        channel = _requireChannel(channelId);
        if (channel.merchant != msg.sender) revert ChannelNotFound(channelId);
    }

    function _enforceNoObligations(MerchantV2 storage merchant) private view {
        if (
            merchant.obligationCount != 0 ||
            merchant.reservedUsdc != 0 ||
            merchant.disputeLockedUsdc != 0 ||
            merchant.reservedFiatE6 != 0
        ) revert MerchantHasObligations(merchant.wallet);
    }

    function _validatePageLimit(uint256 limit) private pure {
        if (limit == 0 || limit > LibMerchants.MAX_PAGE_SIZE) revert PageLimitInvalid(limit);
    }

    function _enforceMinimumStake(MerchantV2 storage merchant) private view {
        uint256 minimum = LibAppStorage.appStorage().config.minMerchantStakeUsdc;
        if (merchant.stakeUsdc < minimum) {
            revert MerchantStakeBelowMinimum(merchant.wallet, merchant.stakeUsdc, minimum);
        }
    }

    function _isAllowedStatusTransition(MerchantStatus from, MerchantStatus to)
        private
        pure
        returns (bool)
    {
        if (from == to) return false;
        if (from == MerchantStatus.ACTIVE) {
            return
                to == MerchantStatus.INACTIVE ||
                to == MerchantStatus.BLACKLISTED ||
                to == MerchantStatus.DISPUTED;
        }
        if (from == MerchantStatus.INACTIVE) {
            return
                to == MerchantStatus.ACTIVE ||
                to == MerchantStatus.BLACKLISTED ||
                to == MerchantStatus.DISPUTED;
        }
        if (from == MerchantStatus.BLACKLISTED || from == MerchantStatus.DISPUTED) {
            return to == MerchantStatus.INACTIVE;
        }
        return false;
    }
}
