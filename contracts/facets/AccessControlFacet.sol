// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {InvalidAddress} from "../shared/Errors.sol";
import {Modifiers} from "../shared/Modifiers.sol";
import {LibAppStorage} from "../libraries/LibAppStorage.sol";

/// @notice The owner is the admin. The executor is the only application role.
contract AccessControlFacet is Modifiers {
    event ExecutorUpdated(address indexed previousExecutor, address indexed newExecutor);

    function executor() external view onlyInitialized returns (address) {
        return LibAppStorage.appStorage().config.executor;
    }

    function setExecutor(address newExecutor) external onlyDiamondOwner nonReentrant {
        if (newExecutor == address(0)) revert InvalidAddress();
        address previous = LibAppStorage.appStorage().config.executor;
        LibAppStorage.appStorage().config.executor = newExecutor;
        emit ExecutorUpdated(previous, newExecutor);
    }
}
