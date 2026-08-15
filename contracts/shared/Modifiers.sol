// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PlatformIsPaused, ProtocolNotInitialized, ReentrantCall} from "./Errors.sol";
import {LibAccess} from "../libraries/LibAccess.sol";
import {LibAppStorage} from "../libraries/LibAppStorage.sol";

abstract contract Modifiers {
    modifier onlyInitialized() {
        if (!LibAppStorage.isInitialized()) revert ProtocolNotInitialized();
        _;
    }

    modifier onlyRole(bytes32 role) {
        if (!LibAppStorage.isInitialized()) revert ProtocolNotInitialized();
        LibAccess.enforceRole(role, msg.sender);
        _;
    }

    modifier whenNotPaused() {
        if (!LibAppStorage.isInitialized()) revert ProtocolNotInitialized();
        if (LibAppStorage.appStorage().config.paused) revert PlatformIsPaused();
        _;
    }

    modifier nonReentrant() {
        if (!LibAppStorage.isInitialized()) revert ProtocolNotInitialized();
        if (LibAppStorage.appStorage().reentrancyStatus == LibAppStorage.ENTERED) {
            revert ReentrantCall();
        }
        LibAppStorage.appStorage().reentrancyStatus = LibAppStorage.ENTERED;
        _;
        LibAppStorage.appStorage().reentrancyStatus = LibAppStorage.NOT_ENTERED;
    }
}
