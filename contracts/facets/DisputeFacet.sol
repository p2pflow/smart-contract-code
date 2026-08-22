// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {
    DisputeResolution,
    DisputeStatus,
    DisputeV2,
    OrderStatus,
    OrderType,
    OrderV2
} from "../shared/AppStorage.sol";
import {
    DisputeNotAllowed,
    DisputeNotOpen,
    OrderNotFound,
    UnauthorizedOrderActor
} from "../shared/Errors.sol";
import {Modifiers} from "../shared/Modifiers.sol";
import {LibAppStorage} from "../libraries/LibAppStorage.sol";
import {LibCustody} from "../libraries/LibCustody.sol";

contract DisputeFacet is Modifiers {
    event DisputeRaised(
        bytes32 indexed orderId,
        address indexed by,
        OrderStatus priorOrderStatus,
        uint256 raisedAt
    );
    event DisputeResolved(
        bytes32 indexed orderId,
        address indexed resolver,
        DisputeResolution resolution,
        OrderStatus finalOrderStatus,
        uint256 resolvedAt
    );
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

    function openDispute(bytes32 orderId) external nonReentrant {
        OrderV2 storage order = _requireOrder(orderId);
        if (order.status != OrderStatus.ACCEPTED && order.status != OrderStatus.FIAT_SENT) {
            revert DisputeNotAllowed(orderId);
        }
        if (msg.sender != order.user && msg.sender != order.merchant) {
            revert UnauthorizedOrderActor(orderId, msg.sender);
        }
        DisputeV2 storage dispute = LibAppStorage.appStorage().disputes[orderId];
        if (dispute.status != DisputeStatus.NONE) revert DisputeNotAllowed(orderId);

        OrderStatus priorStatus = order.status;
        if (order.orderType == OrderType.BUY) {
            LibCustody.lockBuyReservationForDispute(order);
        }
        dispute.status = DisputeStatus.OPEN;
        dispute.priorOrderStatus = priorStatus;
        dispute.openedBy = msg.sender;
        dispute.openedAt = block.timestamp;
        order.status = OrderStatus.DISPUTED;

        emit DisputeRaised(orderId, msg.sender, priorStatus, block.timestamp);
    }

    function resolveDispute(bytes32 orderId, DisputeResolution resolution)
        external
        onlyDiamondOwner
        nonReentrant
    {
        OrderV2 storage order = _requireOrder(orderId);
        DisputeV2 storage dispute = LibAppStorage.appStorage().disputes[orderId];
        if (dispute.status != DisputeStatus.OPEN || order.status != OrderStatus.DISPUTED) {
            revert DisputeNotOpen(orderId);
        }

        if (resolution == DisputeResolution.SETTLE_TRADE) {
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
        } else {
            LibCustody.cancel(order, OrderStatus.CANCELLED);
            emit OrderCancelled(orderId, msg.sender, order.cancelledAt);
        }

        dispute.status = DisputeStatus.RESOLVED;
        dispute.resolution = resolution;
        dispute.resolver = msg.sender;
        dispute.resolvedAt = block.timestamp;
        emit DisputeResolved(orderId, msg.sender, resolution, order.status, block.timestamp);
    }

    function getDispute(bytes32 orderId) external view onlyInitialized returns (DisputeV2 memory) {
        _requireOrder(orderId);
        return LibAppStorage.appStorage().disputes[orderId];
    }

    function _requireOrder(bytes32 orderId) private view returns (OrderV2 storage order) {
        order = LibAppStorage.appStorage().orders[orderId];
        if (order.orderId == bytes32(0)) revert OrderNotFound(orderId);
    }
}
