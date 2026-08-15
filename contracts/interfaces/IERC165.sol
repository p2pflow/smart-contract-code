// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// ERC-165: Standard Interface Detection
// Lets any contract announce which interfaces it implements
// Source: https://eips.ethereum.org/EIPS/eip-165

interface IERC165 {
    /// @notice Query if a contract implements an interface
    /// @param interfaceId The interface identifier (XOR of all function selectors in the interface)
    /// @return `true` if the contract implements `interfaceId`
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}
