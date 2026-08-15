// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Test-only ERC20 that returns `false` from transferFrom/transfer instead of
///         reverting. Used to verify SafeERC20 wraps raw calls and reverts on `false`.
contract BadReturnERC20 {
    string  public name     = "BadReturnERC20";
    string  public symbol   = "BAD";
    uint8   public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply   += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    /// @dev Always returns false. Does NOT revert and does NOT move balances.
    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }

    /// @dev Always returns false. Does NOT revert and does NOT move balances.
    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}
