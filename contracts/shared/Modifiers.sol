// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PlatformIsPaused, ProtocolNotInitialized, ReentrantCall, UnauthorizedExecutor} from "./Errors.sol";
import {LibAppStorage} from "../libraries/LibAppStorage.sol";
import {LibDiamond} from "../libraries/LibDiamond.sol";

abstract contract Modifiers {
    modifier onlyInitialized() {
        if (!LibAppStorage.isInitialized()) revert ProtocolNotInitialized();
        _;
    }

    modifier onlyDiamondOwner() {
        if (!LibAppStorage.isInitialized()) revert ProtocolNotInitialized();
        LibDiamond.enforceIsContractOwner();
        _;
    }

    modifier onlyExecutor() {
        if (!LibAppStorage.isInitialized()) revert ProtocolNotInitialized();
        if (msg.sender != LibAppStorage.appStorage().config.executor) {
            revert UnauthorizedExecutor(msg.sender);
        }
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
