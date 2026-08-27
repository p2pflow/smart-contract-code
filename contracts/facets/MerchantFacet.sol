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
    InvalidAmount,
    InvalidChannelStatus,
    InvalidMerchantStatus,
    InvalidSideMask,
    MerchantAlreadyRegistered,
    MerchantHasObligations,
    MerchantNotActive,
    MerchantNotFound,
    PlatformIsPaused
} from "../shared/Errors.sol";
import {Modifiers} from "../shared/Modifiers.sol";
import {LibAppStorage} from "../libraries/LibAppStorage.sol";
import {LibCustody} from "../libraries/LibCustody.sol";
import {LibMerchants} from "../libraries/LibMerchants.sol";

contract MerchantFacet is Modifiers {
    event MerchantRegistered(address indexed wallet, uint256 stakeUsdc, uint256 registeredAt);
    event MerchantStatusUpdated(
        address indexed wallet,
        MerchantStatus previousStatus,
        MerchantStatus newStatus,
        address indexed operator
    );
    event MerchantAvailabilityUpdated(address indexed wallet, MerchantAvailability availability, uint256 updatedAt);
    event MerchantStakeDeposited(
        address indexed wallet,
        uint256 amount,
        uint256 currentUsdc,
        uint256 totalDepositedUsdc
    );
    event MerchantUnstakeRequested(address indexed wallet, uint256 requestedAt);
    event MerchantUnstakeRejected(address indexed wallet, uint256 reviewedAt);
    event MerchantStakeWithdrawn(address indexed wallet, uint256 amount);
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
    event PaymentChannelTerminated(bytes32 indexed channelId, address indexed merchant, uint256 terminatedAt);

    function registerMerchant(uint256 stakeAmount) external whenNotPaused nonReentrant {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        if (s.merchants[msg.sender].wallet != address(0)) revert MerchantAlreadyRegistered();
        if (stakeAmount < s.config.minMerchantStakeUsdc) revert InvalidAmount();

        MerchantV2 storage merchant = s.merchants[msg.sender];
        merchant.wallet = msg.sender;
        merchant.status = MerchantStatus.ACTIVE;
        merchant.availability = MerchantAvailability.ONLINE;
        merchant.stakeUsdc = stakeAmount;
        merchant.depositedStakeUsdc = stakeAmount;
        merchant.registeredAt = block.timestamp;
        merchant.reviewedAt = block.timestamp;
        s.totalMerchantStakeUsdc += stakeAmount;
        s.totalDepositedStakeUsdc += stakeAmount;

        LibCustody.pullExact(msg.sender, stakeAmount);
        emit MerchantRegistered(msg.sender, stakeAmount, block.timestamp);
    }

    function setMerchantStatus(address wallet, MerchantStatus newStatus)
        external
        onlyDiamondOwner
        nonReentrant
    {
        if (
            newStatus == MerchantStatus.PENDING || newStatus == MerchantStatus.DISPUTED
                || newStatus == MerchantStatus.UNSTAKE_PENDING || newStatus == MerchantStatus.EXITED
        ) revert InvalidMerchantStatus();
        MerchantV2 storage merchant = _requireMerchant(wallet);
        if (
            merchant.status == MerchantStatus.DISPUTED || merchant.status == MerchantStatus.UNSTAKE_PENDING
                || merchant.status == MerchantStatus.EXITED
        ) revert InvalidMerchantStatus();
        MerchantStatus previous = merchant.status;
        if (previous == newStatus) revert InvalidMerchantStatus();
        merchant.status = newStatus;
        merchant.reviewedAt = block.timestamp;
        if (newStatus != MerchantStatus.ACTIVE) merchant.availability = MerchantAvailability.OFFLINE;
        emit MerchantStatusUpdated(wallet, previous, newStatus, msg.sender);
    }

    function depositStake(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert InvalidAmount();
        AppStorageV2 storage s = LibAppStorage.appStorage();
        MerchantV2 storage merchant = _requireMerchant(msg.sender);
        if (merchant.status != MerchantStatus.ACTIVE && merchant.status != MerchantStatus.INACTIVE) {
            revert InvalidMerchantStatus();
        }
        merchant.stakeUsdc += amount;
        merchant.depositedStakeUsdc += amount;
        s.totalMerchantStakeUsdc += amount;
        s.totalDepositedStakeUsdc += amount;
        LibCustody.pullExact(msg.sender, amount);
        emit MerchantStakeDeposited(msg.sender, amount, merchant.stakeUsdc, merchant.depositedStakeUsdc);
    }

    function requestUnstake() external nonReentrant {
        MerchantV2 storage merchant = _requireMerchant(msg.sender);
        if (merchant.status != MerchantStatus.ACTIVE && merchant.status != MerchantStatus.INACTIVE) {
            revert InvalidMerchantStatus();
        }
        _enforceNoObligations(merchant);
        merchant.status = MerchantStatus.UNSTAKE_PENDING;
        merchant.availability = MerchantAvailability.OFFLINE;
        emit MerchantUnstakeRequested(msg.sender, block.timestamp);
    }

    function approveMerchantUnstake(address wallet) external onlyDiamondOwner nonReentrant {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        MerchantV2 storage merchant = _requireMerchant(wallet);
        if (merchant.status != MerchantStatus.UNSTAKE_PENDING) revert InvalidMerchantStatus();
        _enforceNoObligations(merchant);
        uint256 currentAmount = merchant.stakeUsdc;
        if (currentAmount == 0) revert InvalidAmount();

        merchant.stakeUsdc = 0;
        merchant.status = MerchantStatus.EXITED;
        s.totalMerchantStakeUsdc -= currentAmount;
        LibCustody.pushExact(wallet, currentAmount);
        emit MerchantStakeWithdrawn(wallet, currentAmount);
    }

    function rejectMerchantUnstake(address wallet) external onlyDiamondOwner nonReentrant {
        MerchantV2 storage merchant = _requireMerchant(wallet);
        if (merchant.status != MerchantStatus.UNSTAKE_PENDING) revert InvalidMerchantStatus();
        merchant.status = MerchantStatus.INACTIVE;
        emit MerchantUnstakeRejected(wallet, block.timestamp);
    }

    function setAvailability(MerchantAvailability availability) external nonReentrant {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        MerchantV2 storage merchant = _requireMerchant(msg.sender);
        if (merchant.status != MerchantStatus.ACTIVE) revert MerchantNotActive(msg.sender);
        if (availability == MerchantAvailability.ONLINE && s.config.paused) revert PlatformIsPaused();
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
        if (fiatCapacityE6 != 0) revert InvalidAmount();
        AppStorageV2 storage s = LibAppStorage.appStorage();
        MerchantV2 storage merchant = _requireMerchant(msg.sender);
        if (merchant.status != MerchantStatus.ACTIVE) revert MerchantNotActive(msg.sender);

        merchant.channelNonce += 1;
        channelId = LibMerchants.generateChannelId(address(this), msg.sender, merchant.channelNonce, block.chainid);
        PaymentChannelV2 storage channel = s.channels[channelId];
        channel.channelId = channelId;
        channel.merchant = msg.sender;
        channel.status = ChannelStatus.PENDING;
        channel.availability = ChannelAvailability.ACTIVE;
        channel.sideMask = sideMask;
        channel.fiatCapacityE6 = 0;
        channel.registeredAt = block.timestamp;
        channel.updatedAt = block.timestamp;

        emit PaymentChannelRegistered(channelId, msg.sender, sideMask, 0, block.timestamp);
    }

    function reviewPaymentChannel(bytes32 channelId, ChannelStatus status)
        external
        onlyDiamondOwner
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
        channel.availability = status == ChannelStatus.APPROVED
            ? ChannelAvailability.ACTIVE
            : ChannelAvailability.INACTIVE;
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
        MerchantV2 storage merchant = _requireMerchant(msg.sender);
        if (merchant.status != MerchantStatus.ACTIVE) revert MerchantNotActive(msg.sender);
        if (availability == ChannelAvailability.ACTIVE && s.config.paused) revert PlatformIsPaused();
        channel.availability = availability;
        channel.updatedAt = block.timestamp;
        emit PaymentChannelAvailabilityUpdated(channelId, msg.sender, availability, block.timestamp);
    }

    function terminatePaymentChannel(bytes32 channelId) external nonReentrant {
        PaymentChannelV2 storage channel = _requireOwnedChannel(channelId);
        MerchantV2 storage merchant = _requireMerchant(msg.sender);
        if (merchant.status == MerchantStatus.DISPUTED) revert InvalidMerchantStatus();
        if (
            channel.status != ChannelStatus.PENDING && channel.status != ChannelStatus.APPROVED
                && channel.status != ChannelStatus.REJECTED
        ) revert InvalidChannelStatus();
        if (channel.reservedFiatE6 != 0) revert CapacityBelowReserved(0, channel.reservedFiatE6);
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

    function getMerchantBalances(address wallet)
        external
        view
        onlyInitialized
        returns (
            uint256 depositedStakeUsdc,
            uint256 currentUsdc,
            uint256 reservedUsdc,
            uint256 availableUsdc,
            uint256 reservedFiatE6,
            uint256 obligationCount,
            uint256 openDisputeCount
        )
    {
        MerchantV2 storage merchant = _requireMerchant(wallet);
        return (
            merchant.depositedStakeUsdc,
            merchant.stakeUsdc,
            merchant.reservedUsdc,
            LibMerchants.availableUsdc(merchant),
            merchant.reservedFiatE6,
            merchant.obligationCount,
            merchant.openDisputeCount
        );
    }

    function getChannelCapacity(bytes32 channelId)
        external
        view
        onlyInitialized
        returns (uint256 capacityE6, uint256 reservedE6, uint256 availableE6)
    {
        PaymentChannelV2 storage channel = _requireChannel(channelId);
        return (channel.fiatCapacityE6, channel.reservedFiatE6, LibMerchants.availableFiatE6(channel));
    }

    function _requireMerchant(address wallet) private view returns (MerchantV2 storage merchant) {
        merchant = LibAppStorage.appStorage().merchants[wallet];
        if (merchant.wallet == address(0)) revert MerchantNotFound(wallet);
    }

    function _requireChannel(bytes32 channelId) private view returns (PaymentChannelV2 storage channel) {
        channel = LibAppStorage.appStorage().channels[channelId];
        if (channel.channelId == bytes32(0)) revert ChannelNotFound(channelId);
    }

    function _requireOwnedChannel(bytes32 channelId)
        private
        view
        returns (PaymentChannelV2 storage channel)
    {
        channel = _requireChannel(channelId);
        if (channel.merchant != msg.sender) revert ChannelNotFound(channelId);
    }

    function _enforceNoObligations(MerchantV2 storage merchant) private view {
        if (
            merchant.obligationCount != 0 || merchant.reservedUsdc != 0
                || merchant.reservedFiatE6 != 0 || merchant.openDisputeCount != 0
        ) revert MerchantHasObligations(merchant.wallet);
    }
}
