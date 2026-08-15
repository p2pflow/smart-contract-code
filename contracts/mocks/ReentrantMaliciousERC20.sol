// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IReentrancyCallee {
    function reenter() external;
}

/// @notice Test-only ERC20 that invokes a configured callee during transferFrom, so the
///         caller can attempt a reentrant call into the same target. Used to prove that
///         MerchantFacet's nonReentrant modifier blocks classic reentrancy.
contract ReentrantMaliciousERC20 {
    string  public name     = "Reentrant";
    string  public symbol   = "REE";
    uint8   public decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public callee;

    function setCallee(address c) external {
        callee = c;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply   += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;
        _invokeHook();
        return true;
    }

    /// @dev Real transfer + hook into `callee` so it can try to reenter.
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) {
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to]   += amount;

        _invokeHook();
        return true;
    }

    function _invokeHook() private {
        if (callee != address(0)) IReentrancyCallee(callee).reenter();
    }
}
