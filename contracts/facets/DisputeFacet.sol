// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {
    AppStorageV2,
    DisputeResolution,
    DisputeStatus,
    DisputeV2,
    MerchantAvailability,
    MerchantStatus,
    MerchantV2,
    OrderStatus,
    OrderType,
    OrderV2
} from "../shared/AppStorage.sol";
import {
    DisputeNotAllowed,
    DisputeNotOpen,
    DisputeWindowClosed,
    OrderNotFound,
    UnauthorizedOrderActor
} from "../shared/Errors.sol";
import {Modifiers} from "../shared/Modifiers.sol";
import {LibAppStorage} from "../libraries/LibAppStorage.sol";

contract DisputeFacet is Modifiers {
    event DisputeRaised(
        bytes32 indexed orderId,
        address indexed merchant,
        address indexed by,
        OrderType orderType,
        OrderStatus priorOrderStatus,
        uint256 raisedAt,
        uint256 disputeDeadline
    );
    event DisputeResolvedNeutral(
        bytes32 indexed orderId,
        address indexed merchant,
        address indexed resolver,
        uint256 resolvedAt
    );

    function openDispute(bytes32 orderId) external nonReentrant {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        OrderV2 storage order = _requireOrder(orderId);
        if (msg.sender != order.user) revert UnauthorizedOrderActor(orderId, msg.sender);
        if (order.merchant == address(0) || order.disputeDeadline == 0) {
            revert DisputeNotAllowed(orderId);
        }
        if (block.timestamp >= order.disputeDeadline) {
            revert DisputeWindowClosed(orderId, order.disputeDeadline, block.timestamp);
        }
        if (order.orderType == OrderType.SELL) {
            if (order.status != OrderStatus.COMPLETED) revert DisputeNotAllowed(orderId);
        } else if (order.status != OrderStatus.CANCELLED) {
            revert DisputeNotAllowed(orderId);
        }

        DisputeV2 storage dispute = s.disputes[orderId];
        if (dispute.status != DisputeStatus.NONE) revert DisputeNotAllowed(orderId);
        MerchantV2 storage merchant = s.merchants[order.merchant];
        if (
            merchant.status == MerchantStatus.EXITED || merchant.status == MerchantStatus.UNSTAKE_PENDING
                || merchant.wallet == address(0)
        ) revert DisputeNotAllowed(orderId);

        dispute.status = DisputeStatus.OPEN;
        dispute.resolution = DisputeResolution.NONE;
        dispute.priorOrderStatus = order.status;
        dispute.orderType = order.orderType;
        dispute.merchant = order.merchant;
        dispute.openedBy = msg.sender;
        dispute.openedAt = block.timestamp;

        merchant.openDisputeCount += 1;
        merchant.status = MerchantStatus.DISPUTED;
        merchant.availability = MerchantAvailability.OFFLINE;

        emit DisputeRaised(
            orderId,
            order.merchant,
            msg.sender,
            order.orderType,
            order.status,
            block.timestamp,
            order.disputeDeadline
        );
    }

    function resolveDisputeNeutral(bytes32 orderId) external onlyDiamondOwner nonReentrant {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        _requireOrder(orderId);
        DisputeV2 storage dispute = s.disputes[orderId];
        if (dispute.status != DisputeStatus.OPEN) revert DisputeNotOpen(orderId);

        MerchantV2 storage merchant = s.merchants[dispute.merchant];
        dispute.status = DisputeStatus.RESOLVED;
        dispute.resolution = DisputeResolution.NEUTRAL;
        dispute.resolver = msg.sender;
        dispute.resolvedAt = block.timestamp;

        merchant.openDisputeCount -= 1;
        if (merchant.openDisputeCount == 0) {
            merchant.status = MerchantStatus.ACTIVE;
            merchant.availability = MerchantAvailability.OFFLINE;
        }
        emit DisputeResolvedNeutral(orderId, dispute.merchant, msg.sender, block.timestamp);
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
