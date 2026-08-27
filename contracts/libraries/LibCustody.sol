// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    AppStorageV2,
    MerchantV2,
    OrderStatus,
    OrderType,
    OrderV2,
    PaymentChannelV2
} from "../shared/AppStorage.sol";
import {
    CustodyAlreadyFinalized,
    InboundBalanceMismatch,
    InsufficientAvailableStake,
    InsufficientFiatCapacity,
    InvalidOrderState,
    InvalidOrderType,
    OutboundBalanceMismatch
} from "../shared/Errors.sol";
import {LibAppStorage} from "./LibAppStorage.sol";
import {LibMerchants} from "./LibMerchants.sol";

library LibCustody {
    using SafeERC20 for IERC20;

    function pullExact(address from, uint256 amount) internal {
        IERC20 token = IERC20(LibAppStorage.appStorage().config.usdcToken);
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(from, address(this), amount);
        uint256 afterBalance = token.balanceOf(address(this));
        uint256 received = afterBalance >= beforeBalance ? afterBalance - beforeBalance : 0;
        if (received != amount) revert InboundBalanceMismatch(amount, received);
    }

    function pushExact(address to, uint256 amount) internal {
        IERC20 token = IERC20(LibAppStorage.appStorage().config.usdcToken);
        uint256 senderBefore = token.balanceOf(address(this));
        uint256 recipientBefore = token.balanceOf(to);
        token.safeTransfer(to, amount);
        uint256 senderAfter = token.balanceOf(address(this));
        uint256 recipientAfter = token.balanceOf(to);
        uint256 debited = senderBefore >= senderAfter ? senderBefore - senderAfter : 0;
        uint256 received = recipientAfter >= recipientBefore ? recipientAfter - recipientBefore : 0;
        if (debited != amount || received != amount) {
            revert OutboundBalanceMismatch(amount, debited, received);
        }
    }

    function canEscrowSell(address user, uint256 amount) internal view returns (bool) {
        IERC20 token = IERC20(LibAppStorage.appStorage().config.usdcToken);
        return token.balanceOf(user) >= amount && token.allowance(user, address(this)) >= amount;
    }

    function usdcBalanceOf(address account) internal view returns (uint256) {
        return IERC20(LibAppStorage.appStorage().config.usdcToken).balanceOf(account);
    }

    function escrowSell(OrderV2 storage order) internal {
        if (order.orderType != OrderType.SELL) {
            revert InvalidOrderType(order.orderId, uint8(order.orderType));
        }
        if (order.sellEscrowed) return;
        pullExact(order.user, order.usdcAmount);
        order.sellEscrowed = true;
        LibAppStorage.appStorage().totalSellEscrowUsdc += order.usdcAmount;
    }

    function reserveOnAcceptance(OrderV2 storage order, address merchantAddress, bytes32 channelId)
        internal
    {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        MerchantV2 storage merchant = s.merchants[merchantAddress];
        PaymentChannelV2 storage channel = s.channels[channelId];

        if (order.orderType == OrderType.BUY) {
            uint256 available = LibMerchants.availableUsdc(merchant);
            if (available < order.usdcAmount) {
                revert InsufficientAvailableStake(available, order.usdcAmount);
            }
            merchant.reservedUsdc += order.usdcAmount;
            s.totalReservedBuyUsdc += order.usdcAmount;
        } else {
            uint256 available = LibMerchants.availableFiatE6(channel);
            if (available < order.fiatAmountE6) {
                revert InsufficientFiatCapacity(available, order.fiatAmountE6);
            }
            channel.reservedFiatE6 += order.fiatAmountE6;
            merchant.reservedFiatE6 += order.fiatAmountE6;
        }

        merchant.obligationCount += 1;
        channel.obligationCount += 1;
    }

    function releaseWinningReservation(OrderV2 storage order) internal {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        MerchantV2 storage merchant = s.merchants[order.merchant];
        PaymentChannelV2 storage channel = s.channels[order.channelId];
        if (order.orderType == OrderType.BUY) {
            merchant.reservedUsdc -= order.usdcAmount;
            s.totalReservedBuyUsdc -= order.usdcAmount;
        } else {
            channel.reservedFiatE6 -= order.fiatAmountE6;
            merchant.reservedFiatE6 -= order.fiatAmountE6;
        }
        merchant.obligationCount -= 1;
        channel.obligationCount -= 1;
    }

    function complete(OrderV2 storage order) internal {
        if (order.custodyFinalized) revert CustodyAlreadyFinalized(order.orderId);
        if (order.status != OrderStatus.FIAT_SENT) {
            revert InvalidOrderState(order.orderId, uint8(order.status));
        }
        AppStorageV2 storage s = LibAppStorage.appStorage();
        MerchantV2 storage merchant = s.merchants[order.merchant];
        PaymentChannelV2 storage channel = s.channels[order.channelId];

        if (order.orderType == OrderType.BUY) {
            merchant.reservedUsdc -= order.usdcAmount;
            s.totalReservedBuyUsdc -= order.usdcAmount;
            merchant.stakeUsdc -= order.usdcAmount;
            s.totalMerchantStakeUsdc -= order.usdcAmount;
            channel.fiatCapacityE6 += order.fiatAmountE6;
        } else {
            channel.reservedFiatE6 -= order.fiatAmountE6;
            merchant.reservedFiatE6 -= order.fiatAmountE6;
            channel.fiatCapacityE6 -= order.fiatAmountE6;
            s.totalSellEscrowUsdc -= order.usdcAmount;
            order.sellEscrowed = false;
            merchant.stakeUsdc += order.usdcAmount;
            s.totalMerchantStakeUsdc += order.usdcAmount;
        }

        merchant.obligationCount -= 1;
        channel.obligationCount -= 1;
        order.custodyFinalized = true;
        order.status = OrderStatus.COMPLETED;
        order.completedAt = block.timestamp;
        order.expiresAt = 0;

        if (order.orderType == OrderType.BUY) pushExact(order.user, order.usdcAmount);
    }

    function cancelFinal(OrderV2 storage order) internal {
        if (order.custodyFinalized) revert CustodyAlreadyFinalized(order.orderId);
        if (order.status == OrderStatus.ACCEPTED || order.status == OrderStatus.FIAT_SENT) {
            releaseWinningReservation(order);
        }
        if (order.orderType == OrderType.SELL && order.sellEscrowed) {
            LibAppStorage.appStorage().totalSellEscrowUsdc -= order.usdcAmount;
            order.sellEscrowed = false;
            pushExact(order.user, order.usdcAmount);
        }
        order.custodyFinalized = true;
    }
}
