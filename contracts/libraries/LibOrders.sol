// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {
    Merchant,
    PaymentChannel,
    MerchantAccountStatus,
    ChannelStatus,
    ChannelAvailability
} from "../shared/AppStorage.sol";

/// @notice Pure helpers for the P2P order engine — ID derivation, price math,
///         and balance projections (unreserved USDC / unreserved fiat).
///         All functions are pure/view; no state writes.
library LibOrders {
    uint256 internal constant USDC_DECIMALS = 6;
    uint256 internal constant USDC_UNIT = 10 ** USDC_DECIMALS; // 1e6
    uint256 internal constant MAX_ASSIGNMENTS = 4;

    /// @dev Deterministic per-user order id: keccak256("ORDER", user, nonce, chainId).
    ///      Nonce is the pre-increment platform-wide value from AppStorage.orderNonce.
    function generateOrderId(
        address user,
        uint256 nonce,
        uint256 chainId
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("ORDER", user, nonce, chainId));
    }

    /// @dev fiat_amount = usdc_amount * price. usdc_amount is in 6-dec USDC atoms,
    ///      price is INR per whole USDC (integer). Result carries the same 6-dec scale
    ///      as usdcAmount, so its value in whole INR is result / 1e6.
    function computeFiatAmount(uint256 usdcAmount, uint256 price)
        internal
        pure
        returns (uint256)
    {
        return usdcAmount * price;
    }

    /// @dev unreserved_usdc = total_usdc - reserved_usdc - risk_usdc. Reverts underflow.
    function unreservedUsdc(Merchant storage m) internal view returns (uint256) {
        return m.usdcLiquidity - m.reservedUsdc - m.riskUsdc;
    }

    /// @dev unreserved_inr = total_inr - reserved_inr.
    function unreservedFiat(PaymentChannel storage ch) internal view returns (uint256) {
        return ch.fiatBalance - ch.reservedFiat;
    }

    /// @notice A merchant is eligible for BUY-order assignment when the account is ACTIVE
    ///         (blacklist / dispute / unstake exit that state) and enough unreserved USDC
    ///         exists to cover the requested amount. Availability (ONLINE / OFFLINE) is
    ///         intentionally NOT checked per the current spec ("ignore online/offline").
    function isBuyEligible(Merchant storage m, uint256 usdcAmount)
        internal
        view
        returns (bool)
    {
        if (m.accountStatus != MerchantAccountStatus.ACTIVE) return false;
        return unreservedUsdc(m) >= usdcAmount;
    }

    /// @notice A payment channel is SELL-eligible when APPROVED + ACTIVE and its
    ///         unreserved fiat can cover the required amount.
    function isSellEligibleChannel(PaymentChannel storage ch, uint256 fiatAmount)
        internal
        view
        returns (bool)
    {
        if (ch.status != ChannelStatus.APPROVED) return false;
        if (ch.availability != ChannelAvailability.ACTIVE) return false;
        return unreservedFiat(ch) >= fiatAmount;
    }
}
