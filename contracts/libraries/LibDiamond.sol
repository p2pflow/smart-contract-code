// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/******************************************************************************\
* Author: Nick Mudge <nick@perfectabstractions.com> (https://twitter.com/mudgen)
* EIP-2535 Diamonds: https://eips.ethereum.org/EIPS/eip-2535
*
* Source: https://github.com/mudgen/diamond-3-hardhat
*
* LibDiamond is the HEART of the Diamond pattern.
* It holds:
*   1. DiamondStorage — the single storage slot shared by ALL facets
*   2. All internal logic for add / replace / remove of functions
*   3. Owner management helpers
*
* WHY A LIBRARY?
* Solidity libraries with internal functions are inlined into the caller at
* compile time — no extra deployment cost, no CALL overhead.
\******************************************************************************/

import { IDiamondCut } from "../interfaces/IDiamondCut.sol";
import { InvalidAddress } from "../shared/Errors.sol";

// Custom error emitted when _init delegatecall fails without a revert reason
error InitializationFunctionReverted(address _initializationContractAddress, bytes _calldata);

library LibDiamond {
    // ─────────────────────────────────────────────────────────────────────────
    // STORAGE SLOT
    //
    // The Diamond stores ALL its state here — at a deterministic slot derived
    // from this hash.  Every facet reads/writes the SAME struct because they
    // all delegatecall into the Diamond's storage.
    //
    // This technique is called "Diamond Storage" and avoids storage-slot
    // collisions between facets.
    // ─────────────────────────────────────────────────────────────────────────
    bytes32 constant DIAMOND_STORAGE_POSITION =
        keccak256("diamond.standard.diamond.storage");

    // ─────────────────────────────────────────────────────────────────────────
    // STORAGE STRUCTS
    // ─────────────────────────────────────────────────────────────────────────

    // Tracks: which facet a selector belongs to + where in that facet's array
    struct FacetAddressAndPosition {
        address facetAddress;
        uint96 functionSelectorPosition; // index in facetFunctionSelectors[facet].functionSelectors
    }

    // Per-facet bookkeeping: the list of selectors it owns + its index in facetAddresses[]
    struct FacetFunctionSelectors {
        bytes4[] functionSelectors;
        uint256 facetAddressPosition; // index in DiamondStorage.facetAddresses
    }

    // The master storage struct — lives at DIAMOND_STORAGE_POSITION
    struct DiamondStorage {
        // selector → (facet address, position in that facet's selector array)
        mapping(bytes4 => FacetAddressAndPosition) selectorToFacetAndPosition;

        // facet address → (its selectors array, its position in facetAddresses)
        mapping(address => FacetFunctionSelectors) facetFunctionSelectors;

        // ordered list of all registered facet addresses
        address[] facetAddresses;

        // ERC-165 interface support flags
        mapping(bytes4 => bool) supportedInterfaces;

        // The owner of this diamond (ERC-173)
        address contractOwner;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STORAGE ACCESSOR
    //
    // Uses inline assembly to point `ds` at the exact storage slot defined by
    // DIAMOND_STORAGE_POSITION.  This is safe and deterministic.
    // ─────────────────────────────────────────────────────────────────────────
    function diamondStorage() internal pure returns (DiamondStorage storage ds) {
        bytes32 position = DIAMOND_STORAGE_POSITION;
        assembly {
            ds.slot := position
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // OWNERSHIP HELPERS (ERC-173)
    // ─────────────────────────────────────────────────────────────────────────

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    function setContractOwner(address _newOwner) internal {
        if (_newOwner == address(0)) revert InvalidAddress();
        DiamondStorage storage ds = diamondStorage();
        address previousOwner = ds.contractOwner;
        ds.contractOwner = _newOwner;
        emit OwnershipTransferred(previousOwner, _newOwner);
    }

    function contractOwner() internal view returns (address contractOwner_) {
        contractOwner_ = diamondStorage().contractOwner;
    }

    /// @dev Reverts if msg.sender is not the diamond owner
    function enforceIsContractOwner() internal view {
        require(
            msg.sender == diamondStorage().contractOwner,
            "LibDiamond: Must be contract owner"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DIAMOND CUT — the upgrade mechanism
    //
    // This is the only way to change the diamond's function routing table.
    // It loops through each FacetCut and calls add / replace / remove.
    // At the end it emits DiamondCut and optionally runs _init.
    // ─────────────────────────────────────────────────────────────────────────

    event DiamondCut(IDiamondCut.FacetCut[] _diamondCut, address _init, bytes _calldata);

    function diamondCut(
        IDiamondCut.FacetCut[] memory _diamondCut,
        address _init,
        bytes memory _calldata
    ) internal {
        for (uint256 facetIndex; facetIndex < _diamondCut.length; facetIndex++) {
            IDiamondCut.FacetCutAction action = _diamondCut[facetIndex].action;

            if (action == IDiamondCut.FacetCutAction.Add) {
                addFunctions(
                    _diamondCut[facetIndex].facetAddress,
                    _diamondCut[facetIndex].functionSelectors
                );
            } else if (action == IDiamondCut.FacetCutAction.Replace) {
                replaceFunctions(
                    _diamondCut[facetIndex].facetAddress,
                    _diamondCut[facetIndex].functionSelectors
                );
            } else if (action == IDiamondCut.FacetCutAction.Remove) {
                removeFunctions(
                    _diamondCut[facetIndex].facetAddress,
                    _diamondCut[facetIndex].functionSelectors
                );
            } else {
                revert("LibDiamondCut: Incorrect FacetCutAction");
            }
        }
        emit DiamondCut(_diamondCut, _init, _calldata);
        initializeDiamondCut(_init, _calldata);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ADD FUNCTIONS
    //
    // Registers each selector → _facetAddress in the routing table.
    // Reverts if any selector is already registered.
    // ─────────────────────────────────────────────────────────────────────────
    function addFunctions(address _facetAddress, bytes4[] memory _functionSelectors) internal {
        require(_functionSelectors.length > 0, "LibDiamondCut: No selectors in facet to cut");
        DiamondStorage storage ds = diamondStorage();
        require(_facetAddress != address(0), "LibDiamondCut: Add facet can't be address(0)");

        uint96 selectorPosition = uint96(
            ds.facetFunctionSelectors[_facetAddress].functionSelectors.length
        );

        // Register the facet address if this is the first selector for it
        if (selectorPosition == 0) {
            addFacet(ds, _facetAddress);
        }

        for (uint256 selectorIndex; selectorIndex < _functionSelectors.length; selectorIndex++) {
            bytes4 selector = _functionSelectors[selectorIndex];
            address oldFacetAddress = ds.selectorToFacetAndPosition[selector].facetAddress;
            require(
                oldFacetAddress == address(0),
                "LibDiamondCut: Can't add function that already exists"
            );
            addFunction(ds, selector, selectorPosition, _facetAddress);
            selectorPosition++;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // REPLACE FUNCTIONS
    //
    // Swaps the facet that owns each selector.
    // Reverts if trying to replace with the same facet.
    // ─────────────────────────────────────────────────────────────────────────
    function replaceFunctions(address _facetAddress, bytes4[] memory _functionSelectors) internal {
        require(_functionSelectors.length > 0, "LibDiamondCut: No selectors in facet to cut");
        DiamondStorage storage ds = diamondStorage();
        require(_facetAddress != address(0), "LibDiamondCut: Add facet can't be address(0)");

        uint96 selectorPosition = uint96(
            ds.facetFunctionSelectors[_facetAddress].functionSelectors.length
        );

        if (selectorPosition == 0) {
            addFacet(ds, _facetAddress);
        }

        for (uint256 selectorIndex; selectorIndex < _functionSelectors.length; selectorIndex++) {
            bytes4 selector = _functionSelectors[selectorIndex];
            address oldFacetAddress = ds.selectorToFacetAndPosition[selector].facetAddress;
            require(
                oldFacetAddress != _facetAddress,
                "LibDiamondCut: Can't replace function with same function"
            );
            removeFunction(ds, oldFacetAddress, selector);
            addFunction(ds, selector, selectorPosition, _facetAddress);
            selectorPosition++;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // REMOVE FUNCTIONS
    //
    // Deletes selectors from the routing table.
    // _facetAddress MUST be address(0) when removing (EIP-2535 rule).
    // ─────────────────────────────────────────────────────────────────────────
    function removeFunctions(address _facetAddress, bytes4[] memory _functionSelectors) internal {
        require(_functionSelectors.length > 0, "LibDiamondCut: No selectors in facet to cut");
        DiamondStorage storage ds = diamondStorage();
        require(
            _facetAddress == address(0),
            "LibDiamondCut: Remove facet address must be address(0)"
        );

        for (uint256 selectorIndex; selectorIndex < _functionSelectors.length; selectorIndex++) {
            bytes4 selector = _functionSelectors[selectorIndex];
            address oldFacetAddress = ds.selectorToFacetAndPosition[selector].facetAddress;
            removeFunction(ds, oldFacetAddress, selector);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INTERNAL HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    /// Register a new facet address in DiamondStorage
    function addFacet(DiamondStorage storage ds, address _facetAddress) internal {
        enforceHasContractCode(_facetAddress, "LibDiamondCut: New facet has no code");
        ds.facetFunctionSelectors[_facetAddress].facetAddressPosition = ds.facetAddresses.length;
        ds.facetAddresses.push(_facetAddress);
    }

    /// Write one selector → facet mapping entry
    function addFunction(
        DiamondStorage storage ds,
        bytes4 _selector,
        uint96 _selectorPosition,
        address _facetAddress
    ) internal {
        ds.selectorToFacetAndPosition[_selector].functionSelectorPosition = _selectorPosition;
        ds.facetFunctionSelectors[_facetAddress].functionSelectors.push(_selector);
        ds.selectorToFacetAndPosition[_selector].facetAddress = _facetAddress;
    }

    /// Delete one selector from the routing table.
    /// Uses swap-and-pop to keep arrays compact (no gaps).
    function removeFunction(
        DiamondStorage storage ds,
        address _facetAddress,
        bytes4 _selector
    ) internal {
        require(
            _facetAddress != address(0),
            "LibDiamondCut: Can't remove function that doesn't exist"
        );
        // Can't remove immutable functions (defined directly in Diamond.sol)
        require(
            _facetAddress != address(this),
            "LibDiamondCut: Can't remove immutable function"
        );

        // Swap-and-pop the selector out of the facet's selector array
        uint256 selectorPosition =
            ds.selectorToFacetAndPosition[_selector].functionSelectorPosition;
        uint256 lastSelectorPosition =
            ds.facetFunctionSelectors[_facetAddress].functionSelectors.length - 1;

        if (selectorPosition != lastSelectorPosition) {
            bytes4 lastSelector =
                ds.facetFunctionSelectors[_facetAddress].functionSelectors[lastSelectorPosition];
            ds.facetFunctionSelectors[_facetAddress].functionSelectors[selectorPosition] =
                lastSelector;
            ds.selectorToFacetAndPosition[lastSelector].functionSelectorPosition =
                uint96(selectorPosition);
        }
        ds.facetFunctionSelectors[_facetAddress].functionSelectors.pop();
        delete ds.selectorToFacetAndPosition[_selector];

        // If that was the last selector for this facet, remove the facet address too
        if (lastSelectorPosition == 0) {
            uint256 lastFacetAddressPosition = ds.facetAddresses.length - 1;
            uint256 facetAddressPosition =
                ds.facetFunctionSelectors[_facetAddress].facetAddressPosition;

            if (facetAddressPosition != lastFacetAddressPosition) {
                address lastFacetAddress = ds.facetAddresses[lastFacetAddressPosition];
                ds.facetAddresses[facetAddressPosition] = lastFacetAddress;
                ds.facetFunctionSelectors[lastFacetAddress].facetAddressPosition =
                    facetAddressPosition;
            }
            ds.facetAddresses.pop();
            delete ds.facetFunctionSelectors[_facetAddress].facetAddressPosition;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INIT CALL
    //
    // After every diamondCut you can optionally delegatecall an initializer.
    // This is how you set initial state variables when deploying or upgrading.
    // ─────────────────────────────────────────────────────────────────────────
    function initializeDiamondCut(address _init, bytes memory _calldata) internal {
        if (_init == address(0)) {
            return;
        }
        enforceHasContractCode(_init, "LibDiamondCut: _init address has no code");

        (bool success, bytes memory error) = _init.delegatecall(_calldata);
        if (!success) {
            if (error.length > 0) {
                // Bubble up the revert reason
                assembly {
                    let returndata_size := mload(error)
                    revert(add(32, error), returndata_size)
                }
            } else {
                revert InitializationFunctionReverted(_init, _calldata);
            }
        }
    }

    /// Guard: ensures an address contains deployed bytecode
    function enforceHasContractCode(
        address _contract,
        string memory _errorMessage
    ) internal view {
        uint256 contractSize;
        assembly {
            contractSize := extcodesize(_contract)
        }
        require(contractSize > 0, _errorMessage);
    }
}
