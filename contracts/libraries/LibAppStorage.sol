// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AppStorageV2} from "../shared/AppStorage.sol";

library LibAppStorage {
    bytes32 internal constant STORAGE_NAMESPACE = keccak256("p2pflow.app.storage.v2");
    bytes32 internal constant INITIALIZED_MAGIC = keccak256("p2pflow.app.storage.v2.initialized");
    bytes32 internal constant PROTOCOL_ID = keccak256("P2PFLOW_BASE_SEPOLIA_MARKETPLACE_V2");
    uint256 internal constant PROTOCOL_VERSION = 2;
    uint256 internal constant LAYOUT_VERSION = 2;
    uint256 internal constant NOT_ENTERED = 1;
    uint256 internal constant ENTERED = 2;

    function appStorage() internal pure returns (AppStorageV2 storage s) {
        bytes32 position = STORAGE_NAMESPACE;
        assembly {
            s.slot := position
        }
    }

    function isInitialized() internal view returns (bool) {
        AppStorageV2 storage s = appStorage();
        return
            s.initializedMagic == INITIALIZED_MAGIC &&
            s.config.protocolId == PROTOCOL_ID &&
            s.config.protocolVersion == PROTOCOL_VERSION &&
            s.config.layoutVersion == LAYOUT_VERSION;
    }
}
