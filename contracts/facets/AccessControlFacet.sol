// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {
    InvalidAddress,
    UnauthorizedRoleRenounce
} from "../shared/Errors.sol";
import {Modifiers} from "../shared/Modifiers.sol";
import {LibAccess} from "../libraries/LibAccess.sol";

/// @notice Seven mutually exclusive v2 application roles. Diamond ownership is separate.
contract AccessControlFacet is Modifiers {
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);

    function DEFAULT_ADMIN_ROLE() external pure returns (bytes32) {
        return LibAccess.DEFAULT_ADMIN_ROLE;
    }

    function OPERATOR_ROLE() external pure returns (bytes32) {
        return LibAccess.OPERATOR_ROLE;
    }

    function UPGRADER_ROLE() external pure returns (bytes32) {
        return LibAccess.UPGRADER_ROLE;
    }

    function PAUSER_ROLE() external pure returns (bytes32) {
        return LibAccess.PAUSER_ROLE;
    }

    function PRICE_UPDATER_ROLE() external pure returns (bytes32) {
        return LibAccess.PRICE_UPDATER_ROLE;
    }

    function ORDER_ASSIGNER_ROLE() external pure returns (bytes32) {
        return LibAccess.ORDER_ASSIGNER_ROLE;
    }

    function DISPUTE_RESOLVER_ROLE() external pure returns (bytes32) {
        return LibAccess.DISPUTE_RESOLVER_ROLE;
    }

    function hasRole(bytes32 role, address account) external view onlyInitialized returns (bool) {
        return LibAccess.hasRole(role, account);
    }

    function getRoleAdmin(bytes32 role) external pure returns (bytes32) {
        return LibAccess.roleAdmin(role);
    }

    function getRoleMemberCount(bytes32 role) external view onlyInitialized returns (uint256) {
        return LibAccess.roleMemberCount(role);
    }

    function grantRole(bytes32 role, address account)
        external
        onlyRole(LibAccess.DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        if (account == address(0)) revert InvalidAddress();
        if (LibAccess.grantRole(role, account)) {
            emit RoleGranted(role, account, msg.sender);
        }
    }

    function revokeRole(bytes32 role, address account)
        external
        onlyRole(LibAccess.DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        if (LibAccess.revokeRole(role, account)) {
            emit RoleRevoked(role, account, msg.sender);
        }
    }

    function renounceRole(bytes32 role, address account) external nonReentrant {
        if (account != msg.sender) revert UnauthorizedRoleRenounce(account, msg.sender);
        if (LibAccess.revokeRole(role, account)) {
            emit RoleRevoked(role, account, msg.sender);
        }
    }
}
