// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { PaymentChannel } from "../shared/AppStorage.sol";

/// @notice Helpers for channel ID generation and field normalization.
library LibMerchants {
    uint256 internal constant DAY_SECONDS = 1 days;
    uint256 internal constant MONTH_SECONDS = 30 days;

    function generateChannelId(
        address wallet,
        uint256 channelCount,
        uint256 chainId
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("CHANNEL", wallet, channelCount, chainId));
    }

    /// @notice Normalize a bank name for the duplicate guard: trim ASCII whitespace from
    ///         both ends, then lowercase ASCII A-Z. This prevents trivial dedup bypass via
    ///         "SBI" vs "sbi" vs " SBI ". Non-ASCII bytes pass through unchanged.
    function normalizeBankName(string memory raw) internal pure returns (bytes memory) {
        bytes memory b = bytes(raw);
        uint256 len = b.length;

        uint256 start;
        uint256 end = len;
        while (start < end && _isAsciiSpace(b[start])) start++;
        while (end > start && _isAsciiSpace(b[end - 1])) end--;

        uint256 outLen = end - start;
        bytes memory out = new bytes(outLen);
        for (uint256 i; i < outLen; i++) {
            bytes1 c = b[start + i];
            // 'A' (0x41) .. 'Z' (0x5A) -> add 0x20 to get 'a' .. 'z'
            if (c >= 0x41 && c <= 0x5A) c = bytes1(uint8(c) + 32);
            out[i] = c;
        }
        return out;
    }

    /// @notice Returns true iff every byte of `s` is an ASCII digit '0'..'9'. Empty -> true.
    function isAllAsciiDigits(string memory raw) internal pure returns (bool) {
        bytes memory b = bytes(raw);
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            if (c < 0x30 || c > 0x39) return false;
        }
        return true;
    }

    function _isAsciiSpace(bytes1 c) private pure returns (bool) {
        // Space, tab, LF, CR
        return c == 0x20 || c == 0x09 || c == 0x0a || c == 0x0d;
    }

    // ── Channel volume limits ─────────────────────────────────────────────────

    /// @notice Snapshot of the current window state a UI/order router would want.
    ///         Every channel uses the platform-wide defaults; there is no per-channel
    ///         override. `resetsAt` is the timestamp at which `used` will next roll to 0.
    ///         A platform default of `0` means unlimited on that window.
    function windowStatus(
        PaymentChannel storage ch,
        uint256 defaultDailyUsdc,
        uint256 defaultMonthlyUsdc
    )
        internal
        view
        returns (
            uint256 dailyLimit,
            uint256 dailyUsed,
            uint256 dailyResetsAt,
            uint256 monthlyLimit,
            uint256 monthlyUsed,
            uint256 monthlyResetsAt
        )
    {
        dailyLimit = defaultDailyUsdc;
        monthlyLimit = defaultMonthlyUsdc;

        if (ch.dailyWindowStart == 0 || block.timestamp >= ch.dailyWindowStart + DAY_SECONDS) {
            dailyUsed = 0;
            dailyResetsAt = block.timestamp + DAY_SECONDS;
        } else {
            dailyUsed = ch.dailyVolumeUsed;
            dailyResetsAt = ch.dailyWindowStart + DAY_SECONDS;
        }

        if (ch.monthlyWindowStart == 0 || block.timestamp >= ch.monthlyWindowStart + MONTH_SECONDS) {
            monthlyUsed = 0;
            monthlyResetsAt = block.timestamp + MONTH_SECONDS;
        } else {
            monthlyUsed = ch.monthlyVolumeUsed;
            monthlyResetsAt = ch.monthlyWindowStart + MONTH_SECONDS;
        }
    }

    /// @notice Called by OrderFacet when a channel is credited/debited by `amount`. Rolls
    ///         windows forward as needed and enforces the platform-wide ceilings. Reverts if
    ///         the addition would breach either limit. `amount == 0` is a no-op. A platform
    ///         default of `0` means unlimited on that window.
    function consumeChannelVolume(
        PaymentChannel storage ch,
        uint256 defaultDailyUsdc,
        uint256 defaultMonthlyUsdc,
        uint256 amount
    ) internal {
        if (amount == 0) return;

        // Daily window
        if (ch.dailyWindowStart == 0 || block.timestamp >= ch.dailyWindowStart + DAY_SECONDS) {
            ch.dailyWindowStart = block.timestamp;
            ch.dailyVolumeUsed = 0;
        }
        uint256 newDaily = ch.dailyVolumeUsed + amount;
        require(defaultDailyUsdc == 0 || newDaily <= defaultDailyUsdc, "Daily channel limit exceeded");
        ch.dailyVolumeUsed = newDaily;

        // Monthly window (independent bucket — a fresh day doesn't reset the month)
        if (ch.monthlyWindowStart == 0 || block.timestamp >= ch.monthlyWindowStart + MONTH_SECONDS) {
            ch.monthlyWindowStart = block.timestamp;
            ch.monthlyVolumeUsed = 0;
        }
        uint256 newMonthly = ch.monthlyVolumeUsed + amount;
        require(defaultMonthlyUsdc == 0 || newMonthly <= defaultMonthlyUsdc, "Monthly channel limit exceeded");
        ch.monthlyVolumeUsed = newMonthly;
    }
}
