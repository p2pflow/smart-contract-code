// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/******************************************************************************\
* Author: Nick Mudge <nick@perfectabstractions.com> (https://twitter.com/mudgen)
* EIP-2535 Diamonds: https://eips.ethereum.org/EIPS/eip-2535
*
* Source: https://github.com/mudgen/diamond-3-hardhat
*
* ─────────────────────────────────────────────────────────────────────────────
* THIS IS THE DIAMOND — THE PROXY CONTRACT
* ─────────────────────────────────────────────────────────────────────────────
*
* How it works at runtime:
*
*   User calls someFunction() on Diamond's address
*       │
*       ▼
*   fallback() runs
*       │
*       ├─ Look up msg.sig in selectorToFacetAndPosition
*       │        (finds which Facet contract owns this function)
*       │
*       └─ delegatecall → FacetContract.someFunction()
*               │
*               └─ Runs in Diamond's storage context
*                  (reads/writes Diamond's state variables)
*
* KEY INSIGHT: delegatecall means the facet's CODE runs but uses THIS
* contract's STORAGE. So all facets share one unified state.
\******************************************************************************/

import { LibDiamond } from "./libraries/LibDiamond.sol";
import { IDiamondCut } from "./interfaces/IDiamondCut.sol";
import { InvalidAddress, InvalidFacetAddress } from "./shared/Errors.sol";

contract Diamond {
    // ─────────────────────────────────────────────────────────────────────────
    // CONSTRUCTOR
    //
    // On deployment:
    //   1. Sets the contract owner
    //   2. Registers the diamondCut() function selector from DiamondCutFacet
    //      so future upgrades are possible
    //
    // The diamond starts with only ONE function: diamondCut().
    // All other facets are added via the first diamondCut call after deployment.
    // ─────────────────────────────────────────────────────────────────────────
    constructor(address _contractOwner, address _diamondCutFacet) {
        if (_contractOwner == address(0)) revert InvalidAddress();
        if (_diamondCutFacet == address(0) || _diamondCutFacet.code.length == 0) {
            revert InvalidFacetAddress(_diamondCutFacet);
        }
        LibDiamond.setContractOwner(_contractOwner);

        // Register diamondCut() from DiamondCutFacet as the first (and only) function
        IDiamondCut.FacetCut[] memory cut = new IDiamondCut.FacetCut[](1);
        bytes4[] memory functionSelectors = new bytes4[](1);
        functionSelectors[0] = IDiamondCut.diamondCut.selector;

        cut[0] = IDiamondCut.FacetCut({
            facetAddress: _diamondCutFacet,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: functionSelectors
        });

        // No _init address needed for bootstrap — just wire the selector
        LibDiamond.diamondCut(cut, address(0), "");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FALLBACK — the routing engine
    //
    // Every call that doesn't match a function in THIS contract hits fallback().
    // We look up the 4-byte selector (msg.sig) in our routing table,
    // find the facet address, then delegatecall to it.
    //
    // Assembly is used for efficiency:
    //   - calldatacopy: copies ALL incoming calldata into memory[0]
    //   - delegatecall: calls the facet with that calldata
    //   - returndatacopy: copies the facet's return data into memory[0]
    //   - return / revert: forwards the result to the caller
    // ─────────────────────────────────────────────────────────────────────────
    fallback() external {
        LibDiamond.DiamondStorage storage ds;
        bytes32 position = LibDiamond.DIAMOND_STORAGE_POSITION;

        // Point ds at the diamond's storage slot
        assembly {
            ds.slot := position
        }

        // Find the facet for the incoming function selector
        address facet = ds.selectorToFacetAndPosition[msg.sig].facetAddress;
        require(facet != address(0), "Diamond: Function does not exist");

        // delegatecall into the facet — runs facet code in THIS contract's storage
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }
}
