// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {
    AppStorageV2,
    MerchantAvailability,
    MerchantStatus,
    MerchantV2,
    OrderType,
    OrderV2,
    PaymentChannelV2
} from "../shared/AppStorage.sol";
import {
    ChannelNotEligible,
    ChannelNotFound,
    InsufficientAvailableStake,
    InsufficientFiatCapacity,
    InvalidAssignment,
    MerchantNotActive,
    MerchantNotFound,
    MerchantNotOnline
} from "../shared/Errors.sol";
import {LibAppStorage} from "./LibAppStorage.sol";
import {LibMerchants} from "./LibMerchants.sol";

library LibEligibility {
    function enforceAssignment(OrderV2 storage order, address merchantAddress, bytes32 channelId)
        internal
        view
    {
        if (merchantAddress == address(0) || channelId == bytes32(0) || merchantAddress == order.user) {
            revert InvalidAssignment();
        }
        AppStorageV2 storage s = LibAppStorage.appStorage();
        MerchantV2 storage merchant = s.merchants[merchantAddress];
        if (merchant.wallet == address(0)) revert MerchantNotFound(merchantAddress);
        if (merchant.status != MerchantStatus.ACTIVE) revert MerchantNotActive(merchantAddress);
        if (merchant.availability != MerchantAvailability.ONLINE) revert MerchantNotOnline(merchantAddress);
        PaymentChannelV2 storage channel = s.channels[channelId];
        if (channel.channelId == bytes32(0)) revert ChannelNotFound(channelId);
        if (!LibMerchants.isEligibleChannel(channel, merchantAddress, order.orderType)) {
            revert ChannelNotEligible(channelId);
        }
        if (order.orderType == OrderType.BUY) {
            uint256 availableUsdc = LibMerchants.availableUsdc(merchant);
            if (availableUsdc < order.usdcAmount) {
                revert InsufficientAvailableStake(availableUsdc, order.usdcAmount);
            }
        } else {
            uint256 availableFiatE6 = LibMerchants.availableFiatE6(channel);
            if (availableFiatE6 < order.fiatAmountE6) {
                revert InsufficientFiatCapacity(availableFiatE6, order.fiatAmountE6);
            }
        }
    }
}
