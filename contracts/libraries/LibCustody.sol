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
    InsufficientAvailableLiquidity,
    InsufficientFiatCapacity,
    InvalidOrderState,
    InvalidOrderType,
    InvalidTerminalStatus,
    OutboundBalanceMismatch
} from "../shared/Errors.sol";
import {LibAppStorage} from "./LibAppStorage.sol";
import {LibMerchants} from "./LibMerchants.sol";

library LibCustody {
    using SafeERC20 for IERC20;

    function pullExact(address from, uint256 amount) internal {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        IERC20 token = IERC20(s.config.usdcToken);
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(from, address(this), amount);
        uint256 afterBalance = token.balanceOf(address(this));
        uint256 received = afterBalance >= beforeBalance ? afterBalance - beforeBalance : 0;
        if (received != amount) revert InboundBalanceMismatch(amount, received);
    }

    function pushExact(address to, uint256 amount) internal {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        IERC20 token = IERC20(s.config.usdcToken);
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

    function reserveOnAcceptance(OrderV2 storage order, address merchant, bytes32 channelId) internal {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        MerchantV2 storage account = s.merchants[merchant];
        PaymentChannelV2 storage channel = s.channels[channelId];

        if (order.orderType == OrderType.BUY) {
            uint256 available = LibMerchants.availableUsdc(account);
            if (available < order.usdcAmount) {
                revert InsufficientAvailableLiquidity(available, order.usdcAmount);
            }
            account.reservedUsdc += order.usdcAmount;
            s.totalReservedBuyUsdc += order.usdcAmount;
        } else {
            uint256 available = LibMerchants.availableFiatE6(channel);
            if (available < order.fiatAmountE6) {
                revert InsufficientFiatCapacity(available, order.fiatAmountE6);
            }
            channel.reservedFiatE6 += order.fiatAmountE6;
            account.reservedFiatE6 += order.fiatAmountE6;
        }

        account.obligationCount += 1;
        channel.obligationCount += 1;
        order.merchant = merchant;
        order.channelId = channelId;
    }

    function lockBuyReservationForDispute(OrderV2 storage order) internal {
        if (order.orderType != OrderType.BUY) {
            revert InvalidOrderType(order.orderId, uint8(order.orderType));
        }
        MerchantV2 storage merchant = LibAppStorage.appStorage().merchants[order.merchant];
        merchant.reservedUsdc -= order.usdcAmount;
        merchant.disputeLockedUsdc += order.usdcAmount;
    }

    function complete(OrderV2 storage order) internal {
        if (order.custodyFinalized) revert CustodyAlreadyFinalized(order.orderId);
        if (order.status != OrderStatus.FIAT_SENT && order.status != OrderStatus.DISPUTED) {
            revert InvalidOrderState(order.orderId, uint8(order.status));
        }
        AppStorageV2 storage s = LibAppStorage.appStorage();
        MerchantV2 storage merchant = s.merchants[order.merchant];
        PaymentChannelV2 storage channel = s.channels[order.channelId];

        if (order.orderType == OrderType.BUY) {
            if (order.status == OrderStatus.DISPUTED) {
                merchant.disputeLockedUsdc -= order.usdcAmount;
            } else {
                merchant.reservedUsdc -= order.usdcAmount;
            }
            s.totalReservedBuyUsdc -= order.usdcAmount;
            merchant.liquidityUsdc -= order.usdcAmount;
            s.totalMerchantLiquidityUsdc -= order.usdcAmount;
        } else {
            channel.reservedFiatE6 -= order.fiatAmountE6;
            merchant.reservedFiatE6 -= order.fiatAmountE6;
            channel.fiatCapacityE6 -= order.fiatAmountE6;
            s.totalSellEscrowUsdc -= order.usdcAmount;
            merchant.liquidityUsdc += order.usdcAmount;
            s.totalMerchantLiquidityUsdc += order.usdcAmount;
        }

        merchant.obligationCount -= 1;
        channel.obligationCount -= 1;
        order.custodyFinalized = true;
        order.status = OrderStatus.COMPLETED;
        order.completedAt = block.timestamp;

        if (order.orderType == OrderType.BUY) {
            pushExact(order.user, order.usdcAmount);
        }
    }

    function cancel(OrderV2 storage order, OrderStatus terminalStatus) internal {
        if (order.custodyFinalized) revert CustodyAlreadyFinalized(order.orderId);
        if (terminalStatus != OrderStatus.CANCELLED && terminalStatus != OrderStatus.EXPIRED) {
            revert InvalidTerminalStatus(uint8(terminalStatus));
        }
        AppStorageV2 storage s = LibAppStorage.appStorage();

        if (order.merchant != address(0)) {
            MerchantV2 storage merchant = s.merchants[order.merchant];
            PaymentChannelV2 storage channel = s.channels[order.channelId];
            if (order.orderType == OrderType.BUY) {
                if (order.status == OrderStatus.DISPUTED) {
                    merchant.disputeLockedUsdc -= order.usdcAmount;
                } else {
                    merchant.reservedUsdc -= order.usdcAmount;
                }
                s.totalReservedBuyUsdc -= order.usdcAmount;
            } else {
                channel.reservedFiatE6 -= order.fiatAmountE6;
                merchant.reservedFiatE6 -= order.fiatAmountE6;
            }
            merchant.obligationCount -= 1;
            channel.obligationCount -= 1;
        }

        bool refundSell = order.orderType == OrderType.SELL;
        if (refundSell) s.totalSellEscrowUsdc -= order.usdcAmount;

        order.custodyFinalized = true;
        order.status = terminalStatus;
        if (terminalStatus == OrderStatus.CANCELLED) {
            order.cancelledAt = block.timestamp;
        } else {
            order.expiredAt = block.timestamp;
        }

        if (refundSell) {
            pushExact(order.user, order.usdcAmount);
        }
    }
}
