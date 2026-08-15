// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {
    AppStorageV2,
    AssignmentState,
    Candidate,
    CandidateStatus,
    OrderStatus,
    OrderType,
    OrderV2,
    PriceRound
} from "../shared/AppStorage.sol";
import {
    AssignmentExpired,
    CandidateAlreadyRejected,
    CandidateNotAcceptable,
    AcceptedRecoveryDeadlineElapsed,
    CandidateNotAssigned,
    InvalidAmount,
    InvalidOrderState,
    InvalidPriceRound,
    OrderNotExpired,
    OrderNotFound,
    PageLimitInvalid,
    QuoteExpired,
    QuoteValidityTooLong,
    SlippageBoundExceeded,
    StalePrice,
    UnauthorizedOrderActor
} from "../shared/Errors.sol";
import {Modifiers} from "../shared/Modifiers.sol";
import {LibAccess} from "../libraries/LibAccess.sol";
import {LibAppStorage} from "../libraries/LibAppStorage.sol";
import {LibCustody} from "../libraries/LibCustody.sol";
import {LibEligibility} from "../libraries/LibEligibility.sol";
import {LibMerchants} from "../libraries/LibMerchants.sol";
import {LibOrders} from "../libraries/LibOrders.sol";

contract OrderFacet is Modifiers {
    event OrderCreated(
        bytes32 indexed orderId,
        address indexed user,
        OrderType indexed orderType,
        uint256 usdcAmount,
        uint256 fiatAmountE6,
        uint256 selectedPriceE6,
        uint256 roundId,
        uint256 deadline,
        uint256 createdAt,
        uint256 orderNumber
    );
    event OrderCandidateRejected(
        bytes32 indexed orderId,
        uint256 indexed assignmentEpoch,
        address indexed merchant,
        bytes32 channelId,
        uint256 rejectedAt
    );
    event OrderCandidatesExhausted(
        bytes32 indexed orderId,
        uint256 indexed exhaustedEpoch,
        uint256 nextEpoch,
        uint256 exhaustedAt
    );
    event OrderAccepted(
        bytes32 indexed orderId,
        uint256 indexed assignmentEpoch,
        address indexed merchant,
        bytes32 channelId,
        uint256 acceptedAt,
        uint256 recoveryDeadline
    );
    event FiatPaymentMarked(bytes32 indexed orderId, address indexed payer, uint256 markedAt);
    event FiatReceiptConfirmed(bytes32 indexed orderId, address indexed receiver, uint256 confirmedAt);
    event OrderCompleted(
        bytes32 indexed orderId,
        address indexed merchant,
        address indexed user,
        OrderType orderType,
        uint256 usdcAmount,
        uint256 fiatAmountE6,
        uint256 completedAt
    );
    event OrderCancelled(bytes32 indexed orderId, address indexed by, uint256 cancelledAt);
    event OrderExpired(bytes32 indexed orderId, address indexed by, uint256 expiredAt);

    function createBuyOrder(
        uint256 usdcAmount,
        uint256 expectedRoundId,
        uint256 maxPriceE6,
        uint256 quoteValidUntil
    ) external whenNotPaused nonReentrant returns (bytes32 orderId) {
        return _createOrder(
            OrderType.BUY,
            usdcAmount,
            expectedRoundId,
            maxPriceE6,
            quoteValidUntil
        );
    }

    function createSellOrder(
        uint256 usdcAmount,
        uint256 expectedRoundId,
        uint256 minPriceE6,
        uint256 quoteValidUntil
    ) external whenNotPaused nonReentrant returns (bytes32 orderId) {
        return _createOrder(
            OrderType.SELL,
            usdcAmount,
            expectedRoundId,
            minPriceE6,
            quoteValidUntil
        );
    }

    function acceptOrder(bytes32 orderId, bytes32 channelId)
        external
        whenNotPaused
        nonReentrant
    {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        OrderV2 storage order = _requireOrder(orderId);
        if (order.status != OrderStatus.ASSIGNED) {
            revert InvalidOrderState(orderId, uint8(order.status));
        }
        AssignmentState storage assignment = s.assignments[orderId];
        if (block.timestamp >= assignment.deadline) {
            revert AssignmentExpired(orderId, assignment.deadline);
        }

        (uint256 candidateIndex, bool found) = _findCandidate(assignment, msg.sender, channelId);
        if (!found) revert CandidateNotAssigned(msg.sender, channelId);
        if (assignment.candidateStatuses[candidateIndex] != CandidateStatus.ASSIGNED) {
            revert CandidateNotAcceptable(
                msg.sender,
                channelId,
                uint8(assignment.candidateStatuses[candidateIndex])
            );
        }

        Candidate memory candidate = assignment.candidates[candidateIndex];
        LibEligibility.enforceCandidate(order, candidate, candidateIndex);
        LibCustody.reserveOnAcceptance(order, msg.sender, channelId);

        assignment.candidateStatuses[candidateIndex] = CandidateStatus.ACCEPTED;
        for (uint256 i; i < assignment.candidateCount; ++i) {
            if (i != candidateIndex && assignment.candidateStatuses[i] == CandidateStatus.ASSIGNED) {
                assignment.candidateStatuses[i] = CandidateStatus.RELEASED;
            }
        }
        order.status = OrderStatus.ACCEPTED;
        order.acceptedAt = block.timestamp;
        order.acceptedRecoveryDeadline = block.timestamp + s.config.safety.acceptedRecoverySeconds;
        s.merchantOrderIndex[msg.sender].push(orderId);

        emit OrderAccepted(
            orderId,
            order.assignmentEpoch,
            msg.sender,
            channelId,
            block.timestamp,
            order.acceptedRecoveryDeadline
        );
    }

    function rejectAssignment(bytes32 orderId, bytes32 channelId) external nonReentrant {
        OrderV2 storage order = _requireOrder(orderId);
        if (order.status != OrderStatus.ASSIGNED) {
            revert InvalidOrderState(orderId, uint8(order.status));
        }
        AssignmentState storage assignment = LibAppStorage.appStorage().assignments[orderId];
        if (block.timestamp >= assignment.deadline) {
            revert AssignmentExpired(orderId, assignment.deadline);
        }
        (uint256 candidateIndex, bool found) = _findCandidate(assignment, msg.sender, channelId);
        if (!found) revert CandidateNotAssigned(msg.sender, channelId);
        if (assignment.candidateStatuses[candidateIndex] != CandidateStatus.ASSIGNED) {
            revert CandidateAlreadyRejected(msg.sender, channelId);
        }
        assignment.candidateStatuses[candidateIndex] = CandidateStatus.REJECTED;
        emit OrderCandidateRejected(
            orderId,
            order.assignmentEpoch,
            msg.sender,
            channelId,
            block.timestamp
        );

        if (_allCandidatesInactive(assignment)) {
            uint256 exhaustedEpoch = order.assignmentEpoch;
            order.status = OrderStatus.CREATED;
            order.assignmentEpoch += 1;
            emit OrderCandidatesExhausted(
                orderId,
                exhaustedEpoch,
                order.assignmentEpoch,
                block.timestamp
            );
            delete LibAppStorage.appStorage().assignments[orderId];
        }
    }

    function markFiatSent(bytes32 orderId) external nonReentrant {
        OrderV2 storage order = _requireOrder(orderId);
        if (order.status != OrderStatus.ACCEPTED) {
            revert InvalidOrderState(orderId, uint8(order.status));
        }
        if (block.timestamp >= order.acceptedRecoveryDeadline) {
            revert AcceptedRecoveryDeadlineElapsed(orderId, order.acceptedRecoveryDeadline);
        }
        address payer = order.orderType == OrderType.BUY ? order.user : order.merchant;
        if (msg.sender != payer) revert UnauthorizedOrderActor(orderId, msg.sender);
        order.status = OrderStatus.FIAT_SENT;
        order.fiatSentAt = block.timestamp;
        emit FiatPaymentMarked(orderId, msg.sender, block.timestamp);
    }

    function confirmFiatReceived(bytes32 orderId) external nonReentrant {
        OrderV2 storage order = _requireOrder(orderId);
        if (order.status != OrderStatus.FIAT_SENT) {
            revert InvalidOrderState(orderId, uint8(order.status));
        }
        address receiver = order.orderType == OrderType.BUY ? order.merchant : order.user;
        if (msg.sender != receiver) revert UnauthorizedOrderActor(orderId, msg.sender);

        emit FiatReceiptConfirmed(orderId, msg.sender, block.timestamp);
        LibCustody.complete(order);
        emit OrderCompleted(
            orderId,
            order.merchant,
            order.user,
            order.orderType,
            order.usdcAmount,
            order.fiatAmountE6,
            order.completedAt
        );
    }

    function cancelOrder(bytes32 orderId) external nonReentrant {
        OrderV2 storage order = _requireOrder(orderId);
        if (msg.sender != order.user) revert UnauthorizedOrderActor(orderId, msg.sender);
        if (order.status != OrderStatus.CREATED && order.status != OrderStatus.ASSIGNED) {
            revert InvalidOrderState(orderId, uint8(order.status));
        }
        bool hadAssignment = order.status == OrderStatus.ASSIGNED;
        if (hadAssignment) _releaseCurrentCandidates(orderId);
        LibCustody.cancel(order, OrderStatus.CANCELLED);
        if (hadAssignment) delete LibAppStorage.appStorage().assignments[orderId];
        emit OrderCancelled(orderId, msg.sender, order.cancelledAt);
    }

    function recoverExpiredOrder(bytes32 orderId) external nonReentrant {
        OrderV2 storage order = _requireOrder(orderId);
        uint256 deadline;
        if (order.status == OrderStatus.CREATED || order.status == OrderStatus.ASSIGNED) {
            deadline = order.orderDeadline;
            if (
                msg.sender != order.user &&
                !LibAccess.hasRole(LibAccess.OPERATOR_ROLE, msg.sender) &&
                !LibAccess.hasRole(LibAccess.ORDER_ASSIGNER_ROLE, msg.sender)
            ) revert UnauthorizedOrderActor(orderId, msg.sender);
        } else if (order.status == OrderStatus.ACCEPTED) {
            deadline = order.acceptedRecoveryDeadline;
            if (
                msg.sender != order.user &&
                msg.sender != order.merchant &&
                !LibAccess.hasRole(LibAccess.OPERATOR_ROLE, msg.sender) &&
                !LibAccess.hasRole(LibAccess.ORDER_ASSIGNER_ROLE, msg.sender)
            ) revert UnauthorizedOrderActor(orderId, msg.sender);
        } else {
            revert InvalidOrderState(orderId, uint8(order.status));
        }
        if (block.timestamp < deadline) revert OrderNotExpired(orderId, deadline);
        bool hadAssignment = order.status == OrderStatus.ASSIGNED;
        if (hadAssignment) _releaseCurrentCandidates(orderId);
        LibCustody.cancel(order, OrderStatus.EXPIRED);
        if (hadAssignment) delete LibAppStorage.appStorage().assignments[orderId];
        emit OrderExpired(orderId, msg.sender, order.expiredAt);
    }

    function getOrder(bytes32 orderId) external view onlyInitialized returns (OrderV2 memory) {
        return _requireOrder(orderId);
    }

    function getOrderIdPage(uint256 cursor, uint256 limit)
        external
        view
        onlyInitialized
        returns (bytes32[] memory items, uint256 nextCursor)
    {
        return _page(LibAppStorage.appStorage().orderIndex, cursor, limit);
    }

    function getUserOrderIdPage(address user, uint256 cursor, uint256 limit)
        external
        view
        onlyInitialized
        returns (bytes32[] memory items, uint256 nextCursor)
    {
        return _page(LibAppStorage.appStorage().userOrderIndex[user], cursor, limit);
    }

    function getMerchantOrderIdPage(address merchant, uint256 cursor, uint256 limit)
        external
        view
        onlyInitialized
        returns (bytes32[] memory items, uint256 nextCursor)
    {
        return _page(LibAppStorage.appStorage().merchantOrderIndex[merchant], cursor, limit);
    }

    function _createOrder(
        OrderType orderType,
        uint256 usdcAmount,
        uint256 expectedRoundId,
        uint256 boundPriceE6,
        uint256 quoteValidUntil
    ) private returns (bytes32 orderId) {
        if (usdcAmount == 0 || boundPriceE6 == 0) revert InvalidAmount();
        AppStorageV2 storage s = LibAppStorage.appStorage();
        if (expectedRoundId != s.latestPriceRoundId || expectedRoundId == 0) {
            revert InvalidPriceRound(s.latestPriceRoundId, expectedRoundId);
        }
        PriceRound storage round = s.priceRounds[expectedRoundId];
        if (block.timestamp - round.sourceObservedAt > s.pricePolicy.maxAgeSeconds) {
            revert StalePrice(round.sourceObservedAt, s.pricePolicy.maxAgeSeconds);
        }
        if (quoteValidUntil < block.timestamp) revert QuoteExpired(quoteValidUntil);
        if (quoteValidUntil > block.timestamp + s.config.safety.maxQuoteValiditySeconds) {
            revert QuoteValidityTooLong(quoteValidUntil);
        }

        uint256 selectedPriceE6 = orderType == OrderType.BUY
            ? round.buyPriceE6
            : round.sellPriceE6;
        if (
            (orderType == OrderType.BUY && selectedPriceE6 > boundPriceE6) ||
            (orderType == OrderType.SELL && selectedPriceE6 < boundPriceE6)
        ) revert SlippageBoundExceeded(selectedPriceE6, boundPriceE6);

        uint256 fiatAmountE6 = LibOrders.computeFiatAmountE6(
            usdcAmount,
            selectedPriceE6,
            orderType
        );
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
        order.roundId = expectedRoundId;
        order.createdAt = block.timestamp;
        order.orderDeadline = block.timestamp + s.config.safety.orderLifetimeSeconds;
        order.assignmentEpoch = 1;
        s.orderIndex.push(orderId);
        s.userOrderIndex[msg.sender].push(orderId);

        if (orderType == OrderType.SELL) {
            s.totalSellEscrowUsdc += usdcAmount;
            LibCustody.pullExact(msg.sender, usdcAmount);
        }

        emit OrderCreated(
            orderId,
            msg.sender,
            orderType,
            usdcAmount,
            fiatAmountE6,
            selectedPriceE6,
            expectedRoundId,
            order.orderDeadline,
            block.timestamp,
            order.orderNumber
        );
    }

    function _requireOrder(bytes32 orderId) private view returns (OrderV2 storage order) {
        order = LibAppStorage.appStorage().orders[orderId];
        if (order.orderId == bytes32(0)) revert OrderNotFound(orderId);
    }

    function _findCandidate(
        AssignmentState storage assignment,
        address merchant,
        bytes32 channelId
    ) private view returns (uint256 index, bool found) {
        for (uint256 i; i < assignment.candidateCount; ++i) {
            Candidate storage candidate = assignment.candidates[i];
            if (candidate.merchant == merchant && candidate.channelId == channelId) {
                return (i, true);
            }
        }
    }

    function _allCandidatesInactive(AssignmentState storage assignment) private view returns (bool) {
        for (uint256 i; i < assignment.candidateCount; ++i) {
            if (assignment.candidateStatuses[i] == CandidateStatus.ASSIGNED) return false;
        }
        return true;
    }

    function _releaseCurrentCandidates(bytes32 orderId) private {
        AssignmentState storage assignment = LibAppStorage.appStorage().assignments[orderId];
        for (uint256 i; i < assignment.candidateCount; ++i) {
            if (assignment.candidateStatuses[i] == CandidateStatus.ASSIGNED) {
                assignment.candidateStatuses[i] = CandidateStatus.RELEASED;
            }
        }
    }

    function _page(bytes32[] storage source, uint256 cursor, uint256 limit)
        private
        view
        returns (bytes32[] memory items, uint256 nextCursor)
    {
        if (limit == 0 || limit > LibMerchants.MAX_PAGE_SIZE) revert PageLimitInvalid(limit);
        if (cursor >= source.length) return (new bytes32[](0), source.length);
        uint256 end = cursor + limit;
        if (end > source.length) end = source.length;
        items = new bytes32[](end - cursor);
        for (uint256 i = cursor; i < end; ++i) items[i - cursor] = source[i];
        return (items, end);
    }
}
