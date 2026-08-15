// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {
    AppStorageV2,
    PlatformConfigV2,
    SafetyConfig
} from "../shared/AppStorage.sol";
import {
    InvalidAmount,
    PlatformIsNotPaused,
    PlatformIsPaused
} from "../shared/Errors.sol";
import {Modifiers} from "../shared/Modifiers.sol";
import {LibAccess} from "../libraries/LibAccess.sol";
import {LibAppStorage} from "../libraries/LibAppStorage.sol";
import {LibConfig} from "../libraries/LibConfig.sol";

contract ConfigFacet is Modifiers {
    event PlatformPaused(address indexed by);
    event PlatformUnpaused(address indexed by);
    event SafetyConfigUpdated(
        uint256 orderLifetimeSeconds,
        uint256 assignmentLifetimeSeconds,
        uint256 acceptedRecoverySeconds,
        uint256 maxQuoteValiditySeconds,
        address indexed by
    );
    event MinMerchantStakeUpdated(uint256 minMerchantStakeUsdc, address indexed by);

    function isProtocolInitialized() external view returns (bool) {
        return LibAppStorage.isInitialized();
    }

    function protocolId() external view onlyInitialized returns (bytes32) {
        return LibAppStorage.appStorage().config.protocolId;
    }

    function protocolVersion() external view onlyInitialized returns (uint256) {
        return LibAppStorage.appStorage().config.protocolVersion;
    }

    function storageLayoutVersion() external view onlyInitialized returns (uint256) {
        return LibAppStorage.appStorage().config.layoutVersion;
    }

    function storageNamespace() external pure returns (bytes32) {
        return LibAppStorage.STORAGE_NAMESPACE;
    }

    function getConfig() external view onlyInitialized returns (PlatformConfigV2 memory) {
        return LibAppStorage.appStorage().config;
    }

    function getSafetyConfig() external view onlyInitialized returns (SafetyConfig memory) {
        return LibAppStorage.appStorage().config.safety;
    }

    function pausePlatform()
        external
        onlyRole(LibAccess.PAUSER_ROLE)
        nonReentrant
    {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        if (s.config.paused) revert PlatformIsPaused();
        s.config.paused = true;
        emit PlatformPaused(msg.sender);
    }

    function unpausePlatform()
        external
        onlyRole(LibAccess.PAUSER_ROLE)
        nonReentrant
    {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        if (!s.config.paused) revert PlatformIsNotPaused();
        s.config.paused = false;
        emit PlatformUnpaused(msg.sender);
    }

    function setSafetyConfig(SafetyConfig calldata safety)
        external
        onlyRole(LibAccess.OPERATOR_ROLE)
        nonReentrant
    {
        LibConfig.validateSafety(safety);
        LibAppStorage.appStorage().config.safety = safety;
        emit SafetyConfigUpdated(
            safety.orderLifetimeSeconds,
            safety.assignmentLifetimeSeconds,
            safety.acceptedRecoverySeconds,
            safety.maxQuoteValiditySeconds,
            msg.sender
        );
    }

    function setMinMerchantStake(uint256 minMerchantStakeUsdc)
        external
        onlyRole(LibAccess.OPERATOR_ROLE)
        nonReentrant
    {
        if (minMerchantStakeUsdc == 0) revert InvalidAmount();
        LibAppStorage.appStorage().config.minMerchantStakeUsdc = minMerchantStakeUsdc;
        emit MinMerchantStakeUpdated(minMerchantStakeUsdc, msg.sender);
    }

    function getCustodyTotals()
        external
        view
        onlyInitialized
        returns (
            uint256 totalMerchantStakeUsdc,
            uint256 totalMerchantLiquidityUsdc,
            uint256 totalReservedBuyUsdc,
            uint256 totalSellEscrowUsdc
        )
    {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        return (
            s.totalMerchantStakeUsdc,
            s.totalMerchantLiquidityUsdc,
            s.totalReservedBuyUsdc,
            s.totalSellEscrowUsdc
        );
    }

}
