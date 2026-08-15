// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/******************************************************************************\
* Author: Nick Mudge <nick@perfectabstractions.com> (https://twitter.com/mudgen)
* EIP-2535 Diamonds: https://eips.ethereum.org/EIPS/eip-2535
*
* Source: https://github.com/mudgen/diamond-3-hardhat
\******************************************************************************/

interface IDiamondCut {
    // Three possible actions when updating a diamond's facets:
    // Add      → register new functions
    // Replace  → swap existing function for a new implementation (same selector)
    // Remove   → delete a function from the diamond
    enum FacetCutAction { Add, Replace, Remove }

    // Represents one "cut" operation:
    // - facetAddress: the contract that holds the functions
    // - action: Add / Replace / Remove
    // - functionSelectors: 4-byte selectors of the functions to cut
    struct FacetCut {
        address facetAddress;
        FacetCutAction action;
        bytes4[] functionSelectors;
    }

    /// @notice Add/replace/remove any number of functions and optionally execute
    ///         a function with delegatecall
    /// @param _diamondCut  Array of FacetCut structs; each struct describes one
    ///                     facet and the functions to add/replace/remove
    /// @param _init        Address of a contract to delegatecall after the cut
    ///                     (use address(0) to skip)
    /// @param _calldata    Encoded call to run on _init (usually an init())
    function diamondCut(
        FacetCut[] calldata _diamondCut,
        address _init,
        bytes calldata _calldata
    ) external;

    event DiamondCut(FacetCut[] _diamondCut, address _init, bytes _calldata);
}
