// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// ERC-173: Contract Ownership Standard
// Source: https://eips.ethereum.org/EIPS/eip-173

interface IERC173 {
    /// @dev Emitted when ownership is transferred
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /// @notice Returns the address of the current owner
    function owner() external view returns (address owner_);

    /// @notice Transfers ownership to a new address
    /// @param _newOwner Address of the new owner
    function transferOwnership(address _newOwner) external;
}
