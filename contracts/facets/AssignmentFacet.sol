// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {OrderStatus, OrderV2} from "../shared/AppStorage.sol";
import {InvalidOrderState, OrderNotFound} from "../shared/Errors.sol";
import {Modifiers} from "../shared/Modifiers.sol";
import {LibAppStorage} from "../libraries/LibAppStorage.sol";
import {LibEligibility} from "../libraries/LibEligibility.sol";

contract AssignmentFacet is Modifiers {
    event OrderAssigned(bytes32 indexed orderId, address indexed merchant, bytes32 indexed channelId, uint256 assignedAt);

    function assignOrder(bytes32 orderId, address merchant, bytes32 channelId)
        external
        onlyExecutor
        whenNotPaused
        nonReentrant
    {
        OrderV2 storage order = _requireOrder(orderId);
        if (order.status != OrderStatus.CREATED) revert InvalidOrderState(orderId, uint8(order.status));
        LibEligibility.enforceAssignment(order, merchant, channelId);
        order.merchant = merchant;
        order.channelId = channelId;
        order.status = OrderStatus.ASSIGNED;
        emit OrderAssigned(orderId, merchant, channelId, block.timestamp);
    }

    function _requireOrder(bytes32 orderId) private view returns (OrderV2 storage order) {
        order = LibAppStorage.appStorage().orders[orderId];
        if (order.orderId == bytes32(0)) revert OrderNotFound(orderId);
    }
}
