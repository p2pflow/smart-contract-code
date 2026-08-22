// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AppStorageV2, OrderStatus, OrderType, OrderV2} from "../shared/AppStorage.sol";
import {
    InvalidAmount,
    InvalidOrderState,
    InvalidPriceValues,
    OrderNotFound,
    SlippageBoundExceeded,
    UnauthorizedOrderActor
} from "../shared/Errors.sol";
import {Modifiers} from "../shared/Modifiers.sol";
import {LibAppStorage} from "../libraries/LibAppStorage.sol";
import {LibCustody} from "../libraries/LibCustody.sol";
import {LibEligibility} from "../libraries/LibEligibility.sol";
import {LibOrders} from "../libraries/LibOrders.sol";

contract OrderFacet is Modifiers {
    event OrderCreated(
        bytes32 indexed orderId,
        address indexed user,
        OrderType indexed orderType,
        uint256 usdcAmount,
        uint256 fiatAmountE6,
        uint256 selectedPriceE6,
        uint256 createdAt,
        uint256 orderNumber
    );
    event OrderAccepted(bytes32 indexed orderId, address indexed merchant, bytes32 indexed channelId, uint256 acceptedAt);
    event FiatPaymentMarked(bytes32 indexed orderId, address indexed payer, uint256 markedAt);
    event FiatReceiptConfirmed(bytes32 indexed orderId, address indexed receiver, uint256 confirmedAt);
    event OrderCompleted(bytes32 indexed orderId, address indexed merchant, address indexed user, OrderType orderType, uint256 usdcAmount, uint256 fiatAmountE6, uint256 completedAt);
    event OrderCancelled(bytes32 indexed orderId, address indexed by, uint256 cancelledAt);

    function createBuyOrder(uint256 usdcAmount, uint256 maxPriceE6)
        external
        whenNotPaused
        nonReentrant
        returns (bytes32 orderId)
    {
        return _createOrder(OrderType.BUY, usdcAmount, maxPriceE6);
    }

    function createSellOrder(uint256 usdcAmount, uint256 minPriceE6)
        external
        whenNotPaused
        nonReentrant
        returns (bytes32 orderId)
    {
        return _createOrder(OrderType.SELL, usdcAmount, minPriceE6);
    }

    function acceptOrder(bytes32 orderId) external whenNotPaused nonReentrant {
        OrderV2 storage order = _requireOrder(orderId);
        if (order.status != OrderStatus.ASSIGNED) revert InvalidOrderState(orderId, uint8(order.status));
        if (msg.sender != order.merchant) revert UnauthorizedOrderActor(orderId, msg.sender);
        LibEligibility.enforceAssignment(order, order.merchant, order.channelId);
        LibCustody.reserveOnAcceptance(order, order.merchant, order.channelId);
        order.status = OrderStatus.ACCEPTED;
        order.acceptedAt = block.timestamp;
        emit OrderAccepted(orderId, order.merchant, order.channelId, block.timestamp);
    }

    function markFiatSent(bytes32 orderId) external nonReentrant {
        OrderV2 storage order = _requireOrder(orderId);
        if (order.status != OrderStatus.ACCEPTED) revert InvalidOrderState(orderId, uint8(order.status));
        address payer = order.orderType == OrderType.BUY ? order.user : order.merchant;
        if (msg.sender != payer) revert UnauthorizedOrderActor(orderId, msg.sender);
        order.status = OrderStatus.FIAT_SENT;
        order.fiatSentAt = block.timestamp;
        emit FiatPaymentMarked(orderId, msg.sender, block.timestamp);
    }

    function confirmFiatReceived(bytes32 orderId) external nonReentrant {
        OrderV2 storage order = _requireOrder(orderId);
        if (order.status != OrderStatus.FIAT_SENT) revert InvalidOrderState(orderId, uint8(order.status));
        address receiver = order.orderType == OrderType.BUY ? order.merchant : order.user;
        if (msg.sender != receiver) revert UnauthorizedOrderActor(orderId, msg.sender);
        emit FiatReceiptConfirmed(orderId, msg.sender, block.timestamp);
        LibCustody.complete(order);
        emit OrderCompleted(orderId, order.merchant, order.user, order.orderType, order.usdcAmount, order.fiatAmountE6, order.completedAt);
    }

    function cancelOrder(bytes32 orderId) external nonReentrant {
        OrderV2 storage order = _requireOrder(orderId);
        if (msg.sender != order.user) revert UnauthorizedOrderActor(orderId, msg.sender);
        if (order.status != OrderStatus.CREATED && order.status != OrderStatus.ASSIGNED) {
            revert InvalidOrderState(orderId, uint8(order.status));
        }
        LibCustody.cancel(order, OrderStatus.CANCELLED);
        emit OrderCancelled(orderId, msg.sender, order.cancelledAt);
    }

    function getOrder(bytes32 orderId) external view onlyInitialized returns (OrderV2 memory) {
        return _requireOrder(orderId);
    }

    function _createOrder(OrderType orderType, uint256 usdcAmount, uint256 boundPriceE6)
        private
        returns (bytes32 orderId)
    {
        if (usdcAmount == 0 || boundPriceE6 == 0) revert InvalidAmount();
        AppStorageV2 storage s = LibAppStorage.appStorage();
        uint256 selectedPriceE6 = orderType == OrderType.BUY ? s.latestPrice.buyPriceE6 : s.latestPrice.sellPriceE6;
        if (selectedPriceE6 == 0) revert InvalidPriceValues();
        if ((orderType == OrderType.BUY && selectedPriceE6 > boundPriceE6) || (orderType == OrderType.SELL && selectedPriceE6 < boundPriceE6)) {
            revert SlippageBoundExceeded(selectedPriceE6, boundPriceE6);
        }
        uint256 fiatAmountE6 = LibOrders.computeFiatAmountE6(usdcAmount, selectedPriceE6, orderType);
        if (fiatAmountE6 == 0) revert InvalidAmount();
        s.orderNonce += 1;
        orderId = LibOrders.generateOrderId(address(this), msg.sender, s.orderNonce, block.chainid);
        OrderV2 storage order = s.orders[orderId];
        order.orderId = orderId;
        order.orderNumber = s.orderNonce;
        order.orderType = orderType;
        order.status = OrderStatus.CREATED;
        order.user = msg.sender;
        order.usdcAmount = usdcAmount;
        order.fiatAmountE6 = fiatAmountE6;
        order.selectedPriceE6 = selectedPriceE6;
        order.createdAt = block.timestamp;
        if (orderType == OrderType.SELL) {
            s.totalSellEscrowUsdc += usdcAmount;
            LibCustody.pullExact(msg.sender, usdcAmount);
        }
        emit OrderCreated(orderId, msg.sender, orderType, usdcAmount, fiatAmountE6, selectedPriceE6, block.timestamp, order.orderNumber);
    }

    function _requireOrder(bytes32 orderId) private view returns (OrderV2 storage order) {
        order = LibAppStorage.appStorage().orders[orderId];
        if (order.orderId == bytes32(0)) revert OrderNotFound(orderId);
    }
}
