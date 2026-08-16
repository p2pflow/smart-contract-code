// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {
    AppStorageV2,
    AssignmentState,
    Candidate,
    CandidateStatus,
    OrderStatus,
    OrderV2
} from "../shared/AppStorage.sol";
import {
    AssignmentExpired,
    AssignmentNotExpired,
    DecisionAlreadyUsed,
    DuplicateCandidate,
    InvalidCandidateCount,
    InvalidEvidence,
    InvalidOrderState,
    OrderNotFound,
    StaleAssignmentEpoch,
    UnauthorizedOrderActor
} from "../shared/Errors.sol";
import {Modifiers} from "../shared/Modifiers.sol";
import {LibAccess} from "../libraries/LibAccess.sol";
import {LibAppStorage} from "../libraries/LibAppStorage.sol";
import {LibEligibility} from "../libraries/LibEligibility.sol";
import {LibOrders} from "../libraries/LibOrders.sol";

contract AssignmentFacet is Modifiers {
    event OrderCandidatesAssigned(
        bytes32 indexed orderId,
        uint256 indexed assignmentEpoch,
        bytes32 indexed decisionDigest,
        uint256 assignmentDeadline,
        uint256 candidateCount,
        uint256 assignedAt
    );
    event OrderCandidateAssigned(
        bytes32 indexed orderId,
        uint256 indexed assignmentEpoch,
        uint256 rank,
        address indexed merchant,
        bytes32 channelId
    );
    event OrderAssignmentExpired(
        bytes32 indexed orderId,
        uint256 indexed expiredEpoch,
        uint256 nextEpoch,
        address indexed by,
        uint256 expiredAt
    );

    function assignOrderCandidates(
        bytes32 orderId,
        uint256 assignmentEpoch,
        Candidate[] calldata candidates,
        bytes32 decisionDigest
    )
        external
        onlyRole(LibAccess.ORDER_ASSIGNER_ROLE)
        whenNotPaused
        nonReentrant
    {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        OrderV2 storage order = _requireOrder(orderId);
        if (order.status != OrderStatus.CREATED) {
            revert InvalidOrderState(orderId, uint8(order.status));
        }
        if (block.timestamp >= order.orderDeadline) {
            revert AssignmentExpired(orderId, order.orderDeadline);
        }
        if (assignmentEpoch != order.assignmentEpoch) {
            revert StaleAssignmentEpoch(order.assignmentEpoch, assignmentEpoch);
        }
        uint256 count = candidates.length;
        if (count == 0 || count > LibOrders.MAX_ASSIGNMENTS) {
            revert InvalidCandidateCount(count);
        }
        if (decisionDigest == bytes32(0)) revert InvalidEvidence();
        if (s.usedDecisionDigests[decisionDigest]) revert DecisionAlreadyUsed(decisionDigest);

        // Validate the complete bounded set before the first assignment write.
        for (uint256 i; i < count; ++i) {
            LibEligibility.enforceCandidate(order, candidates[i], i);
            for (uint256 j; j < i; ++j) {
                if (
                    candidates[i].merchant == candidates[j].merchant ||
                    candidates[i].channelId == candidates[j].channelId
                ) revert DuplicateCandidate(j, i);
            }
        }

        delete s.assignments[orderId];
        AssignmentState storage assignment = s.assignments[orderId];
        assignment.assignedAt = block.timestamp;
        uint256 assignmentDeadline = block.timestamp + s.config.safety.assignmentLifetimeSeconds;
        if (assignmentDeadline > order.orderDeadline) assignmentDeadline = order.orderDeadline;
        assignment.deadline = assignmentDeadline;
        assignment.decisionDigest = decisionDigest;
        assignment.candidateCount = uint8(count);
        for (uint256 i; i < count; ++i) {
            assignment.candidates[i] = candidates[i];
            assignment.candidateStatuses[i] = CandidateStatus.ASSIGNED;
        }
        s.usedDecisionDigests[decisionDigest] = true;
        order.status = OrderStatus.ASSIGNED;

        emit OrderCandidatesAssigned(
            orderId,
            assignmentEpoch,
            decisionDigest,
            assignmentDeadline,
            count,
            block.timestamp
        );
        for (uint256 i; i < count; ++i) {
            emit OrderCandidateAssigned(
                orderId,
                assignmentEpoch,
                i,
                candidates[i].merchant,
                candidates[i].channelId
            );
        }
    }

    function expireAssignment(bytes32 orderId, uint256 expectedAssignmentEpoch) external nonReentrant {
        OrderV2 storage order = _requireOrder(orderId);
        if (expectedAssignmentEpoch != order.assignmentEpoch) {
            revert StaleAssignmentEpoch(order.assignmentEpoch, expectedAssignmentEpoch);
        }
        if (order.status != OrderStatus.ASSIGNED) {
            revert InvalidOrderState(orderId, uint8(order.status));
        }
        AssignmentState storage assignment = LibAppStorage.appStorage().assignments[orderId];
        if (block.timestamp < assignment.deadline) {
            revert AssignmentNotExpired(orderId, assignment.deadline);
        }
        if (
            msg.sender != order.user &&
            !LibAccess.hasRole(LibAccess.OPERATOR_ROLE, msg.sender) &&
            !LibAccess.hasRole(LibAccess.ORDER_ASSIGNER_ROLE, msg.sender)
        ) revert UnauthorizedOrderActor(orderId, msg.sender);

        uint256 expiredEpoch = order.assignmentEpoch;
        for (uint256 i; i < assignment.candidateCount; ++i) {
            if (assignment.candidateStatuses[i] == CandidateStatus.ASSIGNED) {
                assignment.candidateStatuses[i] = CandidateStatus.EXPIRED;
            }
        }
        order.status = OrderStatus.CREATED;
        order.assignmentEpoch += 1;
        emit OrderAssignmentExpired(
            orderId,
            expiredEpoch,
            order.assignmentEpoch,
            msg.sender,
            block.timestamp
        );
        delete LibAppStorage.appStorage().assignments[orderId];
    }

    function getAssignment(bytes32 orderId)
        external
        view
        onlyInitialized
        returns (
            uint256 assignmentEpoch,
            uint256 assignedAt,
            uint256 deadline,
            bytes32 decisionDigest,
            Candidate[] memory candidates,
            CandidateStatus[] memory statuses
        )
    {
        OrderV2 storage order = _requireOrder(orderId);
        AssignmentState storage assignment = LibAppStorage.appStorage().assignments[orderId];
        candidates = new Candidate[](assignment.candidateCount);
        statuses = new CandidateStatus[](assignment.candidateCount);
        for (uint256 i; i < assignment.candidateCount; ++i) {
            candidates[i] = assignment.candidates[i];
            statuses[i] = assignment.candidateStatuses[i];
        }
        return (
            order.assignmentEpoch,
            assignment.assignedAt,
            assignment.deadline,
            assignment.decisionDigest,
            candidates,
            statuses
        );
    }

    function _requireOrder(bytes32 orderId) private view returns (OrderV2 storage order) {
        order = LibAppStorage.appStorage().orders[orderId];
        if (order.orderId == bytes32(0)) revert OrderNotFound(orderId);
    }
}
