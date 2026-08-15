// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Test-only initializer that reproduces nonzero legacy slot-zero state.
contract LegacyV1StateSeeder {
    function seedLegacyState(address legacyAdmin) external {
        assembly {
            sstore(0, legacyAdmin)
            sstore(4, 1)
        }
    }
}
