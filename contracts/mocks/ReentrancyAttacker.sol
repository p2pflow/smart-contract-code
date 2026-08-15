// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IMerchantRegister {
    function registerMerchant(uint256 stakeAmount) external;
}

interface IApproveLike {
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @notice Test-only attacker that exercises reentrancy against MerchantFacet.registerMerchant.
///         The malicious ERC20 calls back into `reenter()` during transferFrom; we then try a
///         second registerMerchant on the same Diamond, which the nonReentrant guard must block.
contract ReentrancyAttacker {
    address public immutable diamond;
    address public immutable token;
    bool    private _reentered;
    bytes   private _reentryCalldata;

    constructor(address _diamond, address _token) {
        diamond = _diamond;
        token   = _token;
    }

    function attack(uint256 amount) external {
        IApproveLike(token).approve(diamond, type(uint256).max);
        IMerchantRegister(diamond).registerMerchant(amount);
    }

    function approveDiamond() external {
        IApproveLike(token).approve(diamond, type(uint256).max);
    }

    function setReentryCalldata(bytes calldata callData) external {
        _reentryCalldata = callData;
    }

    function callDiamond(bytes calldata callData) external returns (bytes memory result) {
        (bool ok, bytes memory returnData) = diamond.call(callData);
        if (!ok) _bubble(returnData);
        return returnData;
    }

    /// @dev Called by ReentrantMaliciousERC20 mid-transferFrom. We try a second register;
    ///      nonReentrant should revert this with "ReentrancyGuard: reentrant call".
    function reenter() external {
        if (_reentered) return;
        _reentered = true;
        if (_reentryCalldata.length == 0) {
            IMerchantRegister(diamond).registerMerchant(1);
            return;
        }
        (bool ok, bytes memory returnData) = diamond.call(_reentryCalldata);
        if (!ok) _bubble(returnData);
    }

    function _bubble(bytes memory returnData) private pure {
        assembly {
            revert(add(returnData, 32), mload(returnData))
        }
    }
}
