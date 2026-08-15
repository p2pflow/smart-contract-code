// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/******************************************************************************\
* EIP-2535 Diamonds: https://eips.ethereum.org/EIPS/eip-2535
*
* OwnershipFacet — implements ERC-173 (Contract Ownership Standard)
*
* Exposes owner() and transferOwnership() so any external caller can
* read/change who controls this diamond.
* All actual state is stored through LibDiamond — no separate storage slot.
\******************************************************************************/

import { LibDiamond } from "../libraries/LibDiamond.sol";
import { IERC173 } from "../interfaces/IERC173.sol";
import { InvalidAddress, RoleAccountAlreadyAssigned } from "../shared/Errors.sol";
import { LibAccess } from "../libraries/LibAccess.sol";
import { LibAppStorage } from "../libraries/LibAppStorage.sol";

contract OwnershipFacet is IERC173 {
    /// @notice Returns the current diamond owner address
    function owner() external view override returns (address owner_) {
        owner_ = LibDiamond.contractOwner();
    }

    /// @notice Transfer ownership to a new address
    /// @dev Only the current owner can call this
    function transferOwnership(address _newOwner) external override {
        LibDiamond.enforceIsContractOwner();
        if (_newOwner == address(0)) revert InvalidAddress();
        if (LibAppStorage.isInitialized() && LibAccess.hasAnyRole(_newOwner)) {
            revert RoleAccountAlreadyAssigned(_newOwner);
        }
        LibDiamond.setContractOwner(_newOwner);
    }
}
