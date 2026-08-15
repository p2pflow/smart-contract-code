// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/******************************************************************************\
* Author: Nick Mudge <nick@perfectabstractions.com> (https://twitter.com/mudgen)
* EIP-2535 Diamonds: https://eips.ethereum.org/EIPS/eip-2535
*
* Source: https://github.com/mudgen/diamond-3-hardhat
*
* A loupe is a small magnifying glass used to look at diamonds.
* These functions look INTO the diamond — inspecting its facets and selectors.
\******************************************************************************/

interface IDiamondLoupe {
    // Bundles a facet address with all its registered function selectors
    struct Facet {
        address facetAddress;
        bytes4[] functionSelectors;
    }

    /// @notice Gets ALL facets and their function selectors registered in this diamond
    /// @return facets_ Array of Facet structs
    function facets() external view returns (Facet[] memory facets_);

    /// @notice Gets all function selectors supported by a specific facet contract
    /// @param _facet The facet contract address
    /// @return facetFunctionSelectors_ Array of 4-byte selectors
    function facetFunctionSelectors(address _facet)
        external
        view
        returns (bytes4[] memory facetFunctionSelectors_);

    /// @notice Get all facet addresses registered in the diamond
    /// @return facetAddresses_ Array of addresses
    function facetAddresses()
        external
        view
        returns (address[] memory facetAddresses_);

    /// @notice Given a 4-byte selector, find which facet handles it
    /// @dev Returns address(0) if no facet handles this selector
    /// @param _functionSelector The 4-byte function selector
    /// @return facetAddress_ The address of the facet that handles it
    function facetAddress(bytes4 _functionSelector)
        external
        view
        returns (address facetAddress_);
}
