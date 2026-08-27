// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AppStorageV2, AssignmentCandidate, OrderStatus, OrderV2} from "../shared/AppStorage.sol";
import {
    DuplicateCandidate,
    EmptyCandidateList,
    InvalidOrderState,
    OrderNotFound
} from "../shared/Errors.sol";
import {Modifiers} from "../shared/Modifiers.sol";
import {LibAppStorage} from "../libraries/LibAppStorage.sol";
import {LibEligibility} from "../libraries/LibEligibility.sol";
import {LibOrders} from "../libraries/LibOrders.sol";

contract AssignmentFacet is Modifiers {
    event OrderCandidateAssigned(
        bytes32 indexed orderId,
        address indexed merchant,
        bytes32 indexed channelId,
        uint256 assignedAt
    );
    event OrderCandidatesAssigned(
        bytes32 indexed orderId,
        uint256 candidateCount,
        uint256 assignedAt,
        uint256 expiresAt
    );

    function assignOrder(bytes32 orderId, AssignmentCandidate[] calldata candidates)
        external
        onlyExecutor
        whenNotPaused
        nonReentrant
    {
        if (candidates.length == 0) revert EmptyCandidateList();
        AppStorageV2 storage s = LibAppStorage.appStorage();
        OrderV2 storage order = _requireOrder(orderId);
        if (order.status != OrderStatus.CREATED) {
            revert InvalidOrderState(orderId, uint8(order.status));
        }

        for (uint256 i = 0; i < candidates.length; i++) {
            AssignmentCandidate calldata candidate = candidates[i];
            if (s.isOrderCandidate[orderId][candidate.merchant][candidate.channelId]) {
                revert DuplicateCandidate(candidate.merchant, candidate.channelId);
            }
            LibEligibility.enforceAssignment(order, candidate.merchant, candidate.channelId);
            s.isOrderCandidate[orderId][candidate.merchant][candidate.channelId] = true;
            s.orderCandidates[orderId].push(candidate);
            emit OrderCandidateAssigned(orderId, candidate.merchant, candidate.channelId, block.timestamp);
        }

        order.status = OrderStatus.ASSIGNED;
        order.assignedAt = block.timestamp;
        order.expiresAt = block.timestamp + LibOrders.ORDER_PHASE_TIMEOUT;
        emit OrderCandidatesAssigned(orderId, candidates.length, block.timestamp, order.expiresAt);
    }

    function getOrderCandidates(bytes32 orderId)
        external
        view
        onlyInitialized
        returns (AssignmentCandidate[] memory)
    {
        _requireOrder(orderId);
        return LibAppStorage.appStorage().orderCandidates[orderId];
    }

    function isAssignedCandidate(bytes32 orderId, address merchant, bytes32 channelId)
        external
        view
        onlyInitialized
        returns (bool assigned, bool declined)
    {
        _requireOrder(orderId);
        AppStorageV2 storage s = LibAppStorage.appStorage();
        return (
            s.isOrderCandidate[orderId][merchant][channelId],
            s.candidateDeclined[orderId][merchant][channelId]
        );
    }

    function _requireOrder(bytes32 orderId) private view returns (OrderV2 storage order) {
        order = LibAppStorage.appStorage().orders[orderId];
        if (order.orderId == bytes32(0)) revert OrderNotFound(orderId);
    }
}
