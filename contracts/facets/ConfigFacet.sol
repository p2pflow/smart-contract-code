// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Modifiers, PlatformConfig } from "../shared/AppStorage.sol";

/// @notice Platform configuration reads and admin controls (initialized in DiamondInit).
contract ConfigFacet is Modifiers {
    event PlatformPaused(address indexed by);
    event PlatformUnpaused(address indexed by);
    event MinMerchantStakeUpdated(uint256 newMinStakeUsdc);
    event PlatformAdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event DefaultChannelLimitsUpdated(uint256 dailyUsdc, uint256 monthlyUsdc);
    event OrderPricingUpdated(uint256 buyPriceInrPerUsdc, uint256 sellPriceInrPerUsdc);
    event DisputeWindowUpdated(uint256 disputeWindowSeconds);
    event EligibleMerchantAdded(address indexed merchant);
    event EligibleMerchantRemoved(address indexed merchant);
    event EligibleMerchantsCleared();

    function getConfig() external view returns (PlatformConfig memory) {
        return s.config;
    }

    function pausePlatform() external onlyAdmin {
        s.config.paused = true;
        emit PlatformPaused(msg.sender);
    }

    function unpausePlatform() external onlyAdmin {
        s.config.paused = false;
        emit PlatformUnpaused(msg.sender);
    }

    function setMinMerchantStake(uint256 minStakeUsdc) external onlyAdmin {
        s.config.minMerchantStakeUsdc = minStakeUsdc;
        emit MinMerchantStakeUpdated(minStakeUsdc);
    }

    /// @notice Update the platform-wide default per-channel volume ceilings (USDC, 6d).
    ///         Per-channel overrides on `PaymentChannel.dailyLimitUsdc` / `monthlyLimitUsdc`
    ///         take precedence when non-zero. `0` on both defaults means "unlimited".
    function setDefaultChannelLimits(uint256 dailyUsdc, uint256 monthlyUsdc) external onlyAdmin {
        require(monthlyUsdc == 0 || dailyUsdc == 0 || monthlyUsdc >= dailyUsdc, "Monthly < daily");
        s.defaultChannelDailyLimitUsdc = dailyUsdc;
        s.defaultChannelMonthlyLimitUsdc = monthlyUsdc;
        emit DefaultChannelLimitsUpdated(dailyUsdc, monthlyUsdc);
    }

    /// @notice Read the platform-wide default per-channel volume ceilings (USDC, 6d).
    function getChannelLimitDefaults()
        external
        view
        returns (uint256 dailyUsdc, uint256 monthlyUsdc)
    {
        return (s.defaultChannelDailyLimitUsdc, s.defaultChannelMonthlyLimitUsdc);
    }

    function transferPlatformAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Zero address");
        address prev = s.config.admin;
        s.config.admin = newAdmin;
        emit PlatformAdminTransferred(prev, newAdmin);
    }

    // ── Order engine config ──────────────────────────────────────────────────

    /// @notice Update the hardcoded oracle prices used by createBuyOrder / createSellOrder.
    ///         `0` on either price disables that direction until re-set.
    function setOrderPricing(uint256 buyPriceInrPerUsdc, uint256 sellPriceInrPerUsdc)
        external
        onlyAdmin
    {
        s.buyPriceInrPerUsdc = buyPriceInrPerUsdc;
        s.sellPriceInrPerUsdc = sellPriceInrPerUsdc;
        emit OrderPricingUpdated(buyPriceInrPerUsdc, sellPriceInrPerUsdc);
    }

    /// @notice Update the SELL-order dispute window (seconds). Applies to newly
    ///         completed orders only — existing `disputeExpiresAt` values are frozen.
    function setDisputeWindow(uint256 disputeWindowSeconds) external onlyAdmin {
        require(disputeWindowSeconds > 0, "Zero window");
        s.disputeWindowSeconds = disputeWindowSeconds;
        emit DisputeWindowUpdated(disputeWindowSeconds);
    }

    function getOrderPricing()
        external
        view
        returns (uint256 buyPriceInrPerUsdc, uint256 sellPriceInrPerUsdc, uint256 disputeWindowSeconds)
    {
        return (s.buyPriceInrPerUsdc, s.sellPriceInrPerUsdc, s.disputeWindowSeconds);
    }

    // ── Merchant eligibility whitelist ──────────────────────────────────────

    /// @notice Whitelist a merchant for order-router consideration. When the
    ///         whitelist is non-empty the OrderFacet only assigns orders to
    ///         members of this list; when empty every ACTIVE merchant with
    ///         sufficient liquidity is eligible. Idempotent for existing entries.
    function addEligibleMerchant(address merchant) external onlyAdmin {
        require(merchant != address(0), "Zero address");
        require(s.merchants[merchant].wallet != address(0), "Not a merchant");
        if (s.eligibleMerchantIndex[merchant] != 0) return;
        s.eligibleMerchants.push(merchant);
        s.eligibleMerchantIndex[merchant] = s.eligibleMerchants.length; // 1-based
        emit EligibleMerchantAdded(merchant);
    }

    /// @notice Remove a merchant from the eligibility whitelist. Safe to call on
    ///         entries that aren't present (no-op).
    function removeEligibleMerchant(address merchant) external onlyAdmin {
        uint256 idx = s.eligibleMerchantIndex[merchant];
        if (idx == 0) return;
        uint256 last = s.eligibleMerchants.length;
        if (idx != last) {
            address moved = s.eligibleMerchants[last - 1];
            s.eligibleMerchants[idx - 1] = moved;
            s.eligibleMerchantIndex[moved] = idx;
        }
        s.eligibleMerchants.pop();
        delete s.eligibleMerchantIndex[merchant];
        emit EligibleMerchantRemoved(merchant);
    }

    /// @notice Wipe the entire whitelist — falls back to "all ACTIVE merchants
    ///         are eligible" behaviour.
    function clearEligibleMerchants() external onlyAdmin {
        uint256 n = s.eligibleMerchants.length;
        for (uint256 i = 0; i < n; i++) {
            delete s.eligibleMerchantIndex[s.eligibleMerchants[i]];
        }
        delete s.eligibleMerchants;
        emit EligibleMerchantsCleared();
    }

    function getEligibleMerchants() external view returns (address[] memory) {
        return s.eligibleMerchants;
    }

    function isEligibleMerchant(address merchant) external view returns (bool) {
        return s.eligibleMerchantIndex[merchant] != 0;
    }
}
