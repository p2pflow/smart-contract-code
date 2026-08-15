// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {
    AppStorageV2,
    Candidate,
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
    InsufficientAvailableLiquidity,
    InsufficientFiatCapacity,
    InvalidCandidate,
    MerchantNotActive,
    MerchantNotFound,
    MerchantNotOnline,
    MerchantStakeBelowMinimum
} from "../shared/Errors.sol";
import {LibAppStorage} from "./LibAppStorage.sol";
import {LibMerchants} from "./LibMerchants.sol";

library LibEligibility {
    function enforceCandidate(OrderV2 storage order, Candidate memory candidate, uint256 index) internal view {
        if (candidate.merchant == address(0) || candidate.channelId == bytes32(0)) {
            revert InvalidCandidate(index);
        }
        if (candidate.merchant == order.user) revert InvalidCandidate(index);
        AppStorageV2 storage s = LibAppStorage.appStorage();
        MerchantV2 storage merchant = s.merchants[candidate.merchant];
        if (merchant.wallet == address(0)) revert MerchantNotFound(candidate.merchant);
        if (merchant.status != MerchantStatus.ACTIVE) revert MerchantNotActive(candidate.merchant);
        if (merchant.stakeUsdc < s.config.minMerchantStakeUsdc) {
            revert MerchantStakeBelowMinimum(
                candidate.merchant,
                merchant.stakeUsdc,
                s.config.minMerchantStakeUsdc
            );
        }
        if (merchant.availability != MerchantAvailability.ONLINE) {
            revert MerchantNotOnline(candidate.merchant);
        }

        PaymentChannelV2 storage channel = s.channels[candidate.channelId];
        if (channel.channelId == bytes32(0)) revert ChannelNotFound(candidate.channelId);
        if (!LibMerchants.isEligibleChannel(channel, candidate.merchant, order.orderType)) {
            revert ChannelNotEligible(candidate.channelId);
        }

        if (order.orderType == OrderType.BUY) {
            uint256 availableUsdc = LibMerchants.availableUsdc(merchant);
            if (availableUsdc < order.usdcAmount) {
                revert InsufficientAvailableLiquidity(availableUsdc, order.usdcAmount);
            }
        } else {
            uint256 availableFiatE6 = LibMerchants.availableFiatE6(channel);
            if (availableFiatE6 < order.fiatAmountE6) {
                revert InsufficientFiatCapacity(availableFiatE6, order.fiatAmountE6);
            }
        }
    }
}
