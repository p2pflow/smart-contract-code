// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/******************************************************************************\
* Author: Nick Mudge <nick@perfectabstractions.com> (https://twitter.com/mudgen)
* EIP-2535 Diamonds: https://eips.ethereum.org/EIPS/eip-2535
* Source: https://github.com/mudgen/diamond-3-hardhat
*
* DiamondCutFacet — the upgrade facet
*
* This is the ONLY facet registered in the constructor.
* It exposes the diamondCut() function which lets the owner
* add / replace / remove any functions in the diamond.
*
* Only the contract owner can call diamondCut().
\******************************************************************************/

import { IDiamondCut } from "../interfaces/IDiamondCut.sol";
import { LibDiamond } from "../libraries/LibDiamond.sol";

contract DiamondCutFacet is IDiamondCut {
    /// @notice Add/replace/remove any number of functions and optionally execute
    ///         a function with delegatecall
    /// @param _diamondCut  Array describing each cut (facet + selectors + action)
    /// @param _init        Contract to delegatecall after the cut (address(0) = skip)
    /// @param _calldata    Encoded function call to run on _init
    function diamondCut(
        FacetCut[] calldata _diamondCut,
        address _init,
        bytes calldata _calldata
    ) external override {
        // Only the diamond owner can upgrade
        LibDiamond.enforceIsContractOwner();
        LibDiamond.diamondCut(_diamondCut, _init, _calldata);
    }
}
