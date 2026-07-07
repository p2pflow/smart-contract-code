// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {
    Modifiers,
    Merchant,
    MerchantAccountStatus,
    MerchantAvailability,
    PaymentChannel,
    ChannelStatus,
    ChannelAvailability
} from "../shared/AppStorage.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { LibMerchants } from "../libraries/LibMerchants.sol";

/// @notice Merchant registration, USDC liquidity, payment channels, and merchant-facing admin actions.
contract MerchantFacet is Modifiers {
    using SafeERC20 for IERC20;
    event MerchantRegistered(address indexed wallet, uint256 usdcLiquidity);
    event UsdcDeposited(address indexed wallet, uint256 amount);
    event UsdcWithdrawn(address indexed wallet, uint256 amount);
    event UnstakeRequested(address indexed wallet, uint256 amount);
    event UnstakeRequestRejected(address indexed wallet);
    event AvailabilityChanged(address indexed wallet, MerchantAvailability availability);
    event ChannelAdded(bytes32 indexed channelId, address indexed wallet);
    event ChannelApproved(bytes32 indexed channelId, address indexed wallet);
    event ChannelRejected(bytes32 indexed channelId, address indexed wallet);
    event ChannelAvailabilityChanged(
        bytes32 indexed channelId,
        address indexed wallet,
        ChannelAvailability availability
    );
    event FiatMigrated(
        bytes32 indexed fromChannelId,
        bytes32 indexed toChannelId,
        address indexed wallet,
        uint256 amount
    );
    event ChannelTerminated(bytes32 indexed channelId, address indexed wallet);
    event MerchantBlacklisted(address indexed wallet);
    event MerchantDisputed(address indexed wallet);
    event MerchantDisputeCleared(address indexed wallet);

    // ── Registration & USDC liquidity ─────────────────────────────────────────

    function registerMerchant(uint256 stakeAmount, string calldata telegramUsername) external notPaused nonReentrant {
        require(s.merchants[msg.sender].wallet == address(0), "Already registered");
        require(stakeAmount >= s.config.minMerchantStakeUsdc, "Below minimum stake");
        require(bytes(telegramUsername).length > 0, "Telegram required");

        IERC20(s.config.usdcToken).safeTransferFrom(msg.sender, address(this), stakeAmount);

        Merchant storage m = s.merchants[msg.sender];
        m.wallet = msg.sender;
        m.accountStatus = MerchantAccountStatus.ACTIVE;
        m.availability = MerchantAvailability.ONLINE;
        m.usdcLiquidity = stakeAmount;
        m.telegramUsername = telegramUsername;
        m.registeredAt = block.timestamp;

        s.merchantList.push(msg.sender);

        emit MerchantRegistered(msg.sender, stakeAmount);
    }

    function depositStake(uint256 amount) external notPaused nonReentrant {
        Merchant storage m = s.merchants[msg.sender];
        require(m.wallet != address(0), "Not a merchant");
        require(m.accountStatus == MerchantAccountStatus.ACTIVE, "Account not active");
        require(!m.unstakePending, "Unstake pending");
        require(amount > 0, "Amount must be > 0");

        IERC20(s.config.usdcToken).safeTransferFrom(msg.sender, address(this), amount);
        m.usdcLiquidity += amount;

        emit UsdcDeposited(msg.sender, amount);
    }

    /// @notice Raise a request to withdraw full current USDC liquidity. No amount argument —
    ///         the snapshot is all of `usdcLiquidity` at request time. Account becomes INACTIVE
    ///         and OFFLINE until admin approves or rejects.
    function withdrawStake() external {
        Merchant storage m = s.merchants[msg.sender];
        require(m.wallet != address(0), "Not a merchant");
        require(m.accountStatus == MerchantAccountStatus.ACTIVE, "Not active");
        require(!m.unstakePending, "Already pending");
        require(m.usdcLiquidity > 0, "No liquidity");

        m.unstakePending = true;
        m.unstakeRequestedAmount = m.usdcLiquidity;
        m.accountStatus = MerchantAccountStatus.INACTIVE;
        m.availability = MerchantAvailability.OFFLINE;

        emit UnstakeRequested(msg.sender, m.unstakeRequestedAmount);
    }

    // ── Merchant availability (ACTIVE account only) ───────────────────────────

    function goOnline() external notPaused {
        Merchant storage m = s.merchants[msg.sender];
        require(m.wallet != address(0), "Not a merchant");
        require(m.accountStatus == MerchantAccountStatus.ACTIVE, "Account not active");
        require(m.usdcLiquidity >= s.config.minMerchantStakeUsdc, "Below min USDC liquidity");
        m.availability = MerchantAvailability.ONLINE;
        emit AvailabilityChanged(msg.sender, MerchantAvailability.ONLINE);
    }

    function goOffline() external {
        require(s.merchants[msg.sender].wallet != address(0), "Not a merchant");
        s.merchants[msg.sender].availability = MerchantAvailability.OFFLINE;
        emit AvailabilityChanged(msg.sender, MerchantAvailability.OFFLINE);
    }

    // ── Payment channels ───────────────────────────────────────────────────────

    function addPaymentChannel(
        string calldata bankName,
        string calldata accountLast4,
        string calldata upiId,
        string calldata label
    ) external notPaused {
        Merchant storage m = s.merchants[msg.sender];
        require(m.wallet != address(0), "Not a merchant");
        require(m.accountStatus == MerchantAccountStatus.ACTIVE, "Account not active");
        require(bytes(bankName).length > 0, "bankName required");
        require(bytes(accountLast4).length == 4, "accountLast4 must be 4 chars");
        require(LibMerchants.isAllAsciiDigits(accountLast4), "accountLast4 must be digits");
        require(bytes(upiId).length > 0, "upiId required");
        require(bytes(label).length > 0, "label required");

        bytes memory normName = LibMerchants.normalizeBankName(bankName);
        require(normName.length > 0, "bankName required");
        bytes32 dupKey = keccak256(abi.encodePacked(msg.sender, normName, accountLast4));
        require(!s.channelDuplicateGuard[dupKey], "Channel already exists");
        s.channelDuplicateGuard[dupKey] = true;

        bytes32 channelId = LibMerchants.generateChannelId(msg.sender, m.channelIds.length, block.chainid);

        PaymentChannel storage ch = s.channels[channelId];
        ch.channelId = channelId;
        ch.merchant = msg.sender;
        ch.bankName = bankName;
        ch.accountLast4 = accountLast4;
        ch.upiId = upiId;
        ch.label = label;
        ch.status = ChannelStatus.PENDING;
        ch.availability = ChannelAvailability.INACTIVE;
        ch.fiatBalance = 0;
        ch.appliedAt = block.timestamp;

        m.channelIds.push(channelId);
        emit ChannelAdded(channelId, msg.sender);
    }

    function setPaymentChannelActive(bytes32 channelId) external notPaused {
        PaymentChannel storage ch = _requireOwnedApprovedChannel(channelId);
        ch.availability = ChannelAvailability.ACTIVE;
        emit ChannelAvailabilityChanged(channelId, msg.sender, ChannelAvailability.ACTIVE);
    }

    function setPaymentChannelInactive(bytes32 channelId) external {
        PaymentChannel storage ch = _requireOwnedApprovedChannel(channelId);
        ch.availability = ChannelAvailability.INACTIVE;
        emit ChannelAvailabilityChanged(channelId, msg.sender, ChannelAvailability.INACTIVE);
    }

    function migrateAndTerminate(bytes32 fromChannelId, bytes32 toChannelId) external notPaused {
        Merchant storage m = s.merchants[msg.sender];
        require(m.wallet != address(0), "Not a merchant");
        require(m.accountStatus == MerchantAccountStatus.ACTIVE, "Account not active");
        require(fromChannelId != toChannelId, "Same channel");

        PaymentChannel storage chFrom = s.channels[fromChannelId];
        PaymentChannel storage chTo = s.channels[toChannelId];
        require(chFrom.merchant == msg.sender && chTo.merchant == msg.sender, "Not your channel");
        require(chFrom.status == ChannelStatus.APPROVED, "From not APPROVED");
        require(chTo.status == ChannelStatus.APPROVED, "To not APPROVED");

        uint256 amt = chFrom.fiatBalance;
        if (amt > 0) {
            chTo.fiatBalance += amt;
            chFrom.fiatBalance = 0;
            emit FiatMigrated(fromChannelId, toChannelId, msg.sender, amt);
        }

        chFrom.status = ChannelStatus.TERMINATED;
        chFrom.availability = ChannelAvailability.INACTIVE;

        bytes32 dupKey = keccak256(abi.encodePacked(
            chFrom.merchant,
            LibMerchants.normalizeBankName(chFrom.bankName),
            chFrom.accountLast4
        ));
        s.channelDuplicateGuard[dupKey] = false;

        emit ChannelTerminated(fromChannelId, msg.sender);
    }

    function _requireOwnedApprovedChannel(bytes32 channelId) internal view returns (PaymentChannel storage ch) {
        Merchant storage m = s.merchants[msg.sender];
        require(m.wallet != address(0), "Not a merchant");
        require(m.accountStatus == MerchantAccountStatus.ACTIVE, "Account not active");
        ch = s.channels[channelId];
        require(ch.merchant == msg.sender, "Not your channel");
        require(ch.status == ChannelStatus.APPROVED, "Channel not APPROVED");
    }

    // ── Admin: channels & merchants ───────────────────────────────────────────

    function approveChannel(bytes32 channelId) external onlyAdmin {
        PaymentChannel storage ch = s.channels[channelId];
        require(ch.channelId != bytes32(0), "Channel not found");
        require(ch.status == ChannelStatus.PENDING, "Not pending");
        ch.status = ChannelStatus.APPROVED;
        ch.availability = ChannelAvailability.ACTIVE;
        ch.reviewedAt = block.timestamp;
        emit ChannelApproved(channelId, ch.merchant);
    }

    function rejectChannel(bytes32 channelId) external onlyAdmin {
        PaymentChannel storage ch = s.channels[channelId];
        require(ch.channelId != bytes32(0), "Channel not found");
        require(ch.status == ChannelStatus.PENDING, "Not pending");
        ch.status = ChannelStatus.REJECTED;
        ch.reviewedAt = block.timestamp;
        ch.availability = ChannelAvailability.INACTIVE;
        bytes32 dupKey = keccak256(abi.encodePacked(
            ch.merchant,
            LibMerchants.normalizeBankName(ch.bankName),
            ch.accountLast4
        ));
        s.channelDuplicateGuard[dupKey] = false;
        emit ChannelRejected(channelId, ch.merchant);
    }

    function approveMerchantUnstake(address wallet) external onlyAdmin nonReentrant {
        Merchant storage m = s.merchants[wallet];
        require(m.wallet != address(0), "Not found");
        require(m.unstakePending, "No unstake request");
        require(m.accountStatus == MerchantAccountStatus.INACTIVE, "Not awaiting unstake");

        uint256 amount = m.unstakeRequestedAmount;
        require(amount > 0 && m.usdcLiquidity >= amount, "Liquidity mismatch");

        m.usdcLiquidity -= amount;
        m.unstakePending = false;
        m.unstakeRequestedAmount = 0;
        m.accountStatus = MerchantAccountStatus.ACTIVE;

        IERC20(s.config.usdcToken).safeTransfer(wallet, amount);
        emit UsdcWithdrawn(wallet, amount);
    }

    function rejectMerchantUnstake(address wallet) external onlyAdmin {
        Merchant storage m = s.merchants[wallet];
        require(m.wallet != address(0), "Not found");
        require(m.unstakePending, "No unstake request");

        m.unstakePending = false;
        m.unstakeRequestedAmount = 0;
        m.accountStatus = MerchantAccountStatus.ACTIVE;
        emit UnstakeRequestRejected(wallet);
    }

    function blacklistMerchant(address wallet) external onlyAdmin {
        Merchant storage m = s.merchants[wallet];
        require(m.wallet != address(0), "Not found");
        require(m.accountStatus != MerchantAccountStatus.BLACKLISTED, "Already blacklisted");
        if (m.unstakePending) {
            m.unstakePending = false;
            m.unstakeRequestedAmount = 0;
        }
        m.accountStatus = MerchantAccountStatus.BLACKLISTED;
        m.availability = MerchantAvailability.OFFLINE;
        emit MerchantBlacklisted(wallet);
    }

    function setMerchantDisputed(address wallet) external onlyAdmin {
        Merchant storage m = s.merchants[wallet];
        require(m.wallet != address(0), "Not found");
        require(m.accountStatus == MerchantAccountStatus.ACTIVE, "Must be ACTIVE");
        m.accountStatus = MerchantAccountStatus.DISPUTED;
        m.availability = MerchantAvailability.OFFLINE;
        emit MerchantDisputed(wallet);
    }

    function clearMerchantDispute(address wallet) external onlyAdmin {
        Merchant storage m = s.merchants[wallet];
        require(m.wallet != address(0), "Not found");
        require(m.accountStatus == MerchantAccountStatus.DISPUTED, "Not under dispute");
        m.accountStatus = MerchantAccountStatus.ACTIVE;
        emit MerchantDisputeCleared(wallet);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function getMyProfile() external view returns (Merchant memory) {
        return s.merchants[msg.sender];
    }

    function getMerchant(address wallet) external view returns (Merchant memory) {
        return s.merchants[wallet];
    }

    function getAllMerchants() external view returns (address[] memory) {
        return s.merchantList;
    }

    function getChannel(bytes32 channelId) external view returns (PaymentChannel memory) {
        return s.channels[channelId];
    }

    /// @notice Effective limits + current window usage for a channel. Resolves platform
    ///         defaults if the channel has no override, and auto-projects the next reset
    ///         boundary. Useful for UI badges and off-chain quote pre-flight.
    function getChannelLimits(bytes32 channelId)
        external
        view
        returns (
            uint256 dailyLimitUsdc,
            uint256 dailyVolumeUsed,
            uint256 dailyResetsAt,
            uint256 monthlyLimitUsdc,
            uint256 monthlyVolumeUsed,
            uint256 monthlyResetsAt
        )
    {
        PaymentChannel storage ch = s.channels[channelId];
        require(ch.channelId != bytes32(0), "Channel not found");
        return LibMerchants.windowStatus(ch, s.defaultChannelDailyLimitUsdc, s.defaultChannelMonthlyLimitUsdc);
    }

    function getMerchantChannels(address wallet) external view returns (PaymentChannel[] memory) {
        bytes32[] storage ids = s.merchants[wallet].channelIds;
        PaymentChannel[] memory result = new PaymentChannel[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            result[i] = s.channels[ids[i]];
        }
        return result;
    }

    function getMyChannels() external view returns (PaymentChannel[] memory) {
        return this.getMerchantChannels(msg.sender);
    }

    function getPendingChannels() external view returns (bytes32[] memory) {
        uint256 total;
        for (uint256 i = 0; i < s.merchantList.length; i++) {
            bytes32[] storage ids = s.merchants[s.merchantList[i]].channelIds;
            for (uint256 j = 0; j < ids.length; j++) {
                if (s.channels[ids[j]].status == ChannelStatus.PENDING) total++;
            }
        }
        bytes32[] memory result = new bytes32[](total);
        uint256 idx;
        for (uint256 i = 0; i < s.merchantList.length; i++) {
            bytes32[] storage ids = s.merchants[s.merchantList[i]].channelIds;
            for (uint256 j = 0; j < ids.length; j++) {
                if (s.channels[ids[j]].status == ChannelStatus.PENDING) result[idx++] = ids[j];
            }
        }
        return result;
    }
}
