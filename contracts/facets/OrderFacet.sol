// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {
    AppStorageV2,
    CancellationReason,
    OrderMode,
    OrderStatus,
    OrderType,
    OrderV2
} from "../shared/AppStorage.sol";
import {
    CandidateAlreadyDeclined,
    CandidateNotAssigned,
    InsufficientUserUsdcBalance,
    InvalidAmount,
    InvalidOrderState,
    InvalidOrderMode,
    InvalidOrderType,
    InvalidPriceValues,
    OrderNotExpired,
    OrderNotFound,
    PaymentDetailsNotShared,
    SlippageBoundExceeded,
    StalePrice,
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
        uint256 orderNumber,
        uint256 expiresAt
    );
    event OrderAccepted(
        bytes32 indexed orderId,
        address indexed merchant,
        bytes32 indexed channelId,
        uint256 acceptedAt,
        uint256 expiresAt
    );
    event OrderModeSelected(bytes32 indexed orderId, OrderMode indexed orderMode);
    event PaymentDetailsShared(bytes32 indexed orderId, uint256 sharedAt, uint256 expiresAt);
    event OrderCandidateLost(bytes32 indexed orderId, address indexed merchant, bytes32 indexed channelId);
    event SellOrderReopened(
        bytes32 indexed orderId,
        address indexed previousMerchant,
        bytes32 indexed previousChannelId,
        uint256 reopenedAt,
        uint256 expiresAt
    );
    event FiatPaymentMarked(bytes32 indexed orderId, address indexed payer, uint256 markedAt, uint256 expiresAt);
    event FiatReceiptConfirmed(bytes32 indexed orderId, address indexed receiver, uint256 confirmedAt);
    event OrderCompleted(
        bytes32 indexed orderId,
        address indexed merchant,
        address indexed user,
        OrderType orderType,
        uint256 usdcAmount,
        uint256 fiatAmountE6,
        uint256 completedAt,
        uint256 disputeDeadline
    );
    event OrderCancelled(
        bytes32 indexed orderId,
        address indexed by,
        CancellationReason reason,
        uint256 cancelledAt,
        uint256 disputeDeadline
    );

    function createBuyOrder(uint256 usdcAmount, uint256 maxPriceE6)
        external
        whenNotPaused
        nonReentrant
        returns (bytes32 orderId)
    {
        return _createOrder(OrderType.BUY, OrderMode.STANDARD, usdcAmount, maxPriceE6);
    }

    function createSellOrder(uint256 usdcAmount, uint256 minPriceE6)
        external
        whenNotPaused
        nonReentrant
        returns (bytes32 orderId)
    {
        return _createOrder(OrderType.SELL, OrderMode.STANDARD, usdcAmount, minPriceE6);
    }

    /// @notice Creates a SELL-backed Scan & Pay order. Payment details remain
    /// off-chain and may only be submitted after the winning merchant accepts.
    function createScanPayOrder(uint256 usdcAmount, uint256 minPriceE6)
        external
        whenNotPaused
        nonReentrant
        returns (bytes32 orderId)
    {
        return _createOrder(OrderType.SELL, OrderMode.SCAN_PAY, usdcAmount, minPriceE6);
    }

    function acceptOrder(bytes32 orderId, bytes32 channelId) external whenNotPaused nonReentrant {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        OrderV2 storage order = _requireOrder(orderId);
        if (order.status != OrderStatus.ASSIGNED) {
            revert InvalidOrderState(orderId, uint8(order.status));
        }
        if (!s.isOrderCandidate[orderId][msg.sender][channelId]) {
            revert CandidateNotAssigned(orderId, msg.sender, channelId);
        }
        if (s.candidateDeclined[orderId][msg.sender][channelId]) {
            revert CandidateAlreadyDeclined(orderId, msg.sender, channelId);
        }
        LibEligibility.enforceAssignment(order, msg.sender, channelId);

        if (order.orderType == OrderType.SELL && !order.sellEscrowed) {
            if (!LibCustody.canEscrowSell(order.user, order.usdcAmount)) {
                _cancelFinal(order, CancellationReason.USER_FUNDS_UNAVAILABLE, msg.sender, false);
                return;
            }
            LibCustody.escrowSell(order);
        }

        LibCustody.reserveOnAcceptance(order, msg.sender, channelId);
        order.merchant = msg.sender;
        order.channelId = channelId;
        order.status = OrderStatus.ACCEPTED;
        order.acceptedAt = block.timestamp;
        order.expiresAt = block.timestamp + LibOrders.ORDER_PHASE_TIMEOUT;
        emit OrderAccepted(orderId, msg.sender, channelId, block.timestamp, order.expiresAt);

        uint256 candidateCount = s.orderCandidates[orderId].length;
        for (uint256 i = 0; i < candidateCount; i++) {
            address losingMerchant = s.orderCandidates[orderId][i].merchant;
            bytes32 losingChannel = s.orderCandidates[orderId][i].channelId;
            if (losingMerchant != msg.sender || losingChannel != channelId) {
                emit OrderCandidateLost(orderId, losingMerchant, losingChannel);
            }
        }
    }

    function markFiatSent(bytes32 orderId) external nonReentrant {
        OrderV2 storage order = _requireOrder(orderId);
        if (order.status != OrderStatus.ACCEPTED) {
            revert InvalidOrderState(orderId, uint8(order.status));
        }
        address payer = order.orderType == OrderType.BUY ? order.user : order.merchant;
        if (msg.sender != payer) revert UnauthorizedOrderActor(orderId, msg.sender);
        if (order.orderMode == OrderMode.SCAN_PAY && !order.paymentDetailsShared) {
            revert PaymentDetailsNotShared(orderId);
        }
        order.status = OrderStatus.FIAT_SENT;
        order.fiatSentAt = block.timestamp;
        order.expiresAt = block.timestamp + LibOrders.ORDER_PHASE_TIMEOUT;
        emit FiatPaymentMarked(orderId, msg.sender, block.timestamp, order.expiresAt);

        if (order.orderType == OrderType.SELL) {
            LibCustody.complete(order);
            order.disputeDeadline = block.timestamp + LibOrders.DISPUTE_WINDOW;
            emit OrderCompleted(
                orderId,
                order.merchant,
                order.user,
                order.orderType,
                order.usdcAmount,
                order.fiatAmountE6,
                order.completedAt,
                order.disputeDeadline
            );
        }
    }

    /// @notice Executor acknowledgement that encrypted Scan & Pay details are
    /// durably stored off-chain and available to the accepted merchant.
    /// No payment address, QR payload, ciphertext, or payload hash is emitted.
    function markScanPayDetailsShared(bytes32 orderId) external onlyExecutor nonReentrant {
        OrderV2 storage order = _requireOrder(orderId);
        if (order.orderMode != OrderMode.SCAN_PAY) {
            revert InvalidOrderMode(orderId, uint8(order.orderMode));
        }
        if (order.status != OrderStatus.ACCEPTED) {
            revert InvalidOrderState(orderId, uint8(order.status));
        }
        if (order.paymentDetailsShared) return;
        order.paymentDetailsShared = true;
        order.paymentDetailsSharedAt = block.timestamp;
        order.expiresAt = block.timestamp + LibOrders.ORDER_PHASE_TIMEOUT;
        emit PaymentDetailsShared(orderId, block.timestamp, order.expiresAt);
    }

    function confirmFiatReceived(bytes32 orderId) external nonReentrant {
        OrderV2 storage order = _requireOrder(orderId);
        if (order.orderType != OrderType.BUY) {
            revert InvalidOrderType(orderId, uint8(order.orderType));
        }
        if (order.status != OrderStatus.FIAT_SENT) {
            revert InvalidOrderState(orderId, uint8(order.status));
        }
        if (msg.sender != order.merchant) revert UnauthorizedOrderActor(orderId, msg.sender);
        emit FiatReceiptConfirmed(orderId, msg.sender, block.timestamp);
        LibCustody.complete(order);
        emit OrderCompleted(
            orderId,
            order.merchant,
            order.user,
            order.orderType,
            order.usdcAmount,
            order.fiatAmountE6,
            order.completedAt,
            0
        );
    }

    function cancelOrder(bytes32 orderId) external nonReentrant {
        OrderV2 storage order = _requireOrder(orderId);
        if (msg.sender != order.user) revert UnauthorizedOrderActor(orderId, msg.sender);
        if (order.orderType != OrderType.BUY) {
            revert InvalidOrderType(orderId, uint8(order.orderType));
        }
        if (
            order.status != OrderStatus.CREATED && order.status != OrderStatus.ASSIGNED
                && order.status != OrderStatus.ACCEPTED
        ) revert InvalidOrderState(orderId, uint8(order.status));
        bool disputeEligible = order.status == OrderStatus.ACCEPTED;
        _cancelFinal(order, CancellationReason.USER_CANCELLED, msg.sender, disputeEligible);
    }

    function cancelAcceptedSellOrder(bytes32 orderId) external nonReentrant {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        OrderV2 storage order = _requireOrder(orderId);
        if (order.orderType != OrderType.SELL) {
            revert InvalidOrderType(orderId, uint8(order.orderType));
        }
        if (order.status != OrderStatus.ACCEPTED) {
            revert InvalidOrderState(orderId, uint8(order.status));
        }
        if (msg.sender != order.merchant) revert UnauthorizedOrderActor(orderId, msg.sender);

        address previousMerchant = order.merchant;
        bytes32 previousChannel = order.channelId;
        LibCustody.releaseWinningReservation(order);
        s.candidateDeclined[orderId][previousMerchant][previousChannel] = true;
        order.merchant = address(0);
        order.channelId = bytes32(0);
        order.status = OrderStatus.ASSIGNED;
        order.acceptedAt = 0;
        order.paymentDetailsShared = false;
        order.paymentDetailsSharedAt = 0;
        order.expiresAt = block.timestamp + LibOrders.ORDER_PHASE_TIMEOUT;
        emit SellOrderReopened(orderId, previousMerchant, previousChannel, block.timestamp, order.expiresAt);
    }

    function cancelNoEligibleMerchantOrder(bytes32 orderId) external onlyExecutor nonReentrant {
        OrderV2 storage order = _requireOrder(orderId);
        if (order.status != OrderStatus.CREATED && order.status != OrderStatus.ASSIGNED) {
            revert InvalidOrderState(orderId, uint8(order.status));
        }
        _cancelFinal(order, CancellationReason.NO_ELIGIBLE_MERCHANT, msg.sender, false);
    }

    function processExpiredOrder(bytes32 orderId) external nonReentrant {
        OrderV2 storage order = _requireOrder(orderId);
        if (
            order.status != OrderStatus.CREATED && order.status != OrderStatus.ASSIGNED
                && order.status != OrderStatus.ACCEPTED && order.status != OrderStatus.FIAT_SENT
        ) revert InvalidOrderState(orderId, uint8(order.status));
        if (order.expiresAt == 0 || block.timestamp < order.expiresAt) {
            revert OrderNotExpired(orderId, order.expiresAt, block.timestamp);
        }
        bool disputeEligible = order.orderType == OrderType.BUY
            && (order.status == OrderStatus.ACCEPTED || order.status == OrderStatus.FIAT_SENT);
        _cancelFinal(order, CancellationReason.ORDER_EXPIRED, msg.sender, disputeEligible);
    }

    function getOrder(bytes32 orderId) external view onlyInitialized returns (OrderV2 memory) {
        return _requireOrder(orderId);
    }

    function _createOrder(
        OrderType orderType,
        OrderMode orderMode,
        uint256 usdcAmount,
        uint256 boundPriceE6
    )
        private
        returns (bytes32 orderId)
    {
        if (usdcAmount == 0 || boundPriceE6 == 0) revert InvalidAmount();
        AppStorageV2 storage s = LibAppStorage.appStorage();
        if (orderType == OrderType.SELL) {
            uint256 availableUsdc = LibCustody.usdcBalanceOf(msg.sender);
            if (availableUsdc < usdcAmount) {
                revert InsufficientUserUsdcBalance(availableUsdc, usdcAmount);
            }
        }
        uint256 selectedPriceE6 = orderType == OrderType.BUY
            ? s.latestPrice.buyPriceE6
            : s.latestPrice.sellPriceE6;
        if (selectedPriceE6 == 0) revert InvalidPriceValues();
        if (block.timestamp > s.latestPrice.updatedAt + LibOrders.MAX_PRICE_AGE) {
            revert StalePrice(s.latestPrice.updatedAt, block.timestamp);
        }
        if (
            (orderType == OrderType.BUY && selectedPriceE6 > boundPriceE6)
                || (orderType == OrderType.SELL && selectedPriceE6 < boundPriceE6)
        ) revert SlippageBoundExceeded(selectedPriceE6, boundPriceE6);
        uint256 fiatAmountE6 = LibOrders.computeFiatAmountE6(usdcAmount, selectedPriceE6, orderType);
        if (fiatAmountE6 == 0) revert InvalidAmount();

        s.orderNonce += 1;
        orderId = LibOrders.generateOrderId(address(this), msg.sender, s.orderNonce, block.chainid);
        OrderV2 storage order = s.orders[orderId];
        order.orderId = orderId;
        order.orderNumber = s.orderNonce;
        order.orderType = orderType;
        order.orderMode = orderMode;
        order.status = OrderStatus.CREATED;
        order.user = msg.sender;
        order.usdcAmount = usdcAmount;
        order.fiatAmountE6 = fiatAmountE6;
        order.selectedPriceE6 = selectedPriceE6;
        order.createdAt = block.timestamp;
        order.expiresAt = block.timestamp + LibOrders.ORDER_PHASE_TIMEOUT;
        emit OrderCreated(
            orderId,
            msg.sender,
            orderType,
            usdcAmount,
            fiatAmountE6,
            selectedPriceE6,
            block.timestamp,
            order.orderNumber,
            order.expiresAt
        );
        emit OrderModeSelected(orderId, orderMode);
    }

    function _cancelFinal(
        OrderV2 storage order,
        CancellationReason reason,
        address actor,
        bool disputeEligible
    ) private {
        LibCustody.cancelFinal(order);
        order.status = OrderStatus.CANCELLED;
        order.cancelledAt = block.timestamp;
        order.cancelledBy = actor;
        order.cancellationReason = reason;
        order.expiresAt = 0;
        if (disputeEligible) order.disputeDeadline = block.timestamp + LibOrders.DISPUTE_WINDOW;
        emit OrderCancelled(order.orderId, actor, reason, block.timestamp, order.disputeDeadline);
    }

    function _requireOrder(bytes32 orderId) private view returns (OrderV2 storage order) {
        order = LibAppStorage.appStorage().orders[orderId];
        if (order.orderId == bytes32(0)) revert OrderNotFound(orderId);
    }
}
