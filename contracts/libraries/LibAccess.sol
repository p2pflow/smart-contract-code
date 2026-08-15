// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AppStorageV2, RoleData} from "../shared/AppStorage.sol";
import {
    InvalidAddress,
    LastDefaultAdmin,
    MissingRole,
    RoleAccountAlreadyAssigned,
    RoleAccountIsDiamondOwner,
    UnknownRole
} from "../shared/Errors.sol";
import {LibDiamond} from "./LibDiamond.sol";
import {LibAppStorage} from "./LibAppStorage.sol";

library LibAccess {
    bytes32 internal constant DEFAULT_ADMIN_ROLE = bytes32(0);
    bytes32 internal constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 internal constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 internal constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 internal constant PRICE_UPDATER_ROLE = keccak256("PRICE_UPDATER_ROLE");
    bytes32 internal constant ORDER_ASSIGNER_ROLE = keccak256("ORDER_ASSIGNER_ROLE");
    bytes32 internal constant DISPUTE_RESOLVER_ROLE = keccak256("DISPUTE_RESOLVER_ROLE");

    function isKnownRole(bytes32 role) internal pure returns (bool) {
        return
            role == DEFAULT_ADMIN_ROLE ||
            role == OPERATOR_ROLE ||
            role == UPGRADER_ROLE ||
            role == PAUSER_ROLE ||
            role == PRICE_UPDATER_ROLE ||
            role == ORDER_ASSIGNER_ROLE ||
            role == DISPUTE_RESOLVER_ROLE;
    }

    function roleAdmin(bytes32 role) internal pure returns (bytes32) {
        if (!isKnownRole(role)) revert UnknownRole(role);
        return DEFAULT_ADMIN_ROLE;
    }

    function hasRole(bytes32 role, address account) internal view returns (bool) {
        if (!isKnownRole(role)) return false;
        return LibAppStorage.appStorage().roles[role].members[account];
    }

    function enforceRole(bytes32 role, address account) internal view {
        if (!isKnownRole(role)) revert UnknownRole(role);
        if (!hasRole(role, account)) revert MissingRole(role, account);
    }

    function roleMemberCount(bytes32 role) internal view returns (uint256) {
        if (!isKnownRole(role)) revert UnknownRole(role);
        return LibAppStorage.appStorage().roles[role].memberCount;
    }

    function hasAnyRole(address account) internal view returns (bool) {
        return
            hasRole(DEFAULT_ADMIN_ROLE, account) ||
            hasRole(OPERATOR_ROLE, account) ||
            hasRole(UPGRADER_ROLE, account) ||
            hasRole(PAUSER_ROLE, account) ||
            hasRole(PRICE_UPDATER_ROLE, account) ||
            hasRole(ORDER_ASSIGNER_ROLE, account) ||
            hasRole(DISPUTE_RESOLVER_ROLE, account);
    }

    function grantRole(bytes32 role, address account) internal returns (bool changed) {
        if (!isKnownRole(role)) revert UnknownRole(role);
        if (account == address(0)) revert InvalidAddress();

        AppStorageV2 storage s = LibAppStorage.appStorage();
        RoleData storage data = s.roles[role];
        if (data.members[account]) return false;
        if (account == LibDiamond.contractOwner()) revert RoleAccountIsDiamondOwner(account);
        if (hasAnyRole(account)) revert RoleAccountAlreadyAssigned(account);

        data.members[account] = true;
        data.memberCount += 1;
        return true;
    }

    function revokeRole(bytes32 role, address account) internal returns (bool changed) {
        if (!isKnownRole(role)) revert UnknownRole(role);
        AppStorageV2 storage s = LibAppStorage.appStorage();
        RoleData storage data = s.roles[role];
        if (!data.members[account]) return false;
        if (role == DEFAULT_ADMIN_ROLE && data.memberCount == 1) revert LastDefaultAdmin();

        data.members[account] = false;
        data.memberCount -= 1;
        return true;
    }
}
