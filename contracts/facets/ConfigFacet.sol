// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AppStorageV2, PlatformConfig} from "../shared/AppStorage.sol";
import {InvalidAmount, PlatformIsNotPaused, PlatformIsPaused} from "../shared/Errors.sol";
import {Modifiers} from "../shared/Modifiers.sol";
import {LibAppStorage} from "../libraries/LibAppStorage.sol";

contract ConfigFacet is Modifiers {
    event PlatformPaused(address indexed by);
    event PlatformUnpaused(address indexed by);
    event MinMerchantStakeUpdated(uint256 minMerchantStakeUsdc, address indexed by);

    function getConfig() external view onlyInitialized returns (PlatformConfig memory) {
        return LibAppStorage.appStorage().config;
    }

    function pausePlatform() external onlyDiamondOwner nonReentrant {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        if (s.config.paused) revert PlatformIsPaused();
        s.config.paused = true;
        emit PlatformPaused(msg.sender);
    }

    function unpausePlatform() external onlyDiamondOwner nonReentrant {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        if (!s.config.paused) revert PlatformIsNotPaused();
        s.config.paused = false;
        emit PlatformUnpaused(msg.sender);
    }

    function setMinMerchantStake(uint256 minMerchantStakeUsdc) external onlyDiamondOwner nonReentrant {
        if (minMerchantStakeUsdc == 0) revert InvalidAmount();
        LibAppStorage.appStorage().config.minMerchantStakeUsdc = minMerchantStakeUsdc;
        emit MinMerchantStakeUpdated(minMerchantStakeUsdc, msg.sender);
    }

    function getCustodyTotals()
        external
        view
        onlyInitialized
        returns (uint256 stake, uint256 liquidity, uint256 reservedBuy, uint256 sellEscrow)
    {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        return (s.totalMerchantStakeUsdc, s.totalMerchantLiquidityUsdc, s.totalReservedBuyUsdc, s.totalSellEscrowUsdc);
    }
}
