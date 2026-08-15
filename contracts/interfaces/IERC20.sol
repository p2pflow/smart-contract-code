// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// ERC-20: Standard Token Interface
// Source: https://eips.ethereum.org/EIPS/eip-20
//
// This is what USDC (and any ERC-20 token) implements.
// Import this wherever you need to interact with USDC —
// e.g. transferring tokens into escrow, releasing funds, checking balances.

interface IERC20 {
    /// @notice Total tokens in existence
    function totalSupply() external view returns (uint256);

    /// @notice Token balance of an account
    function balanceOf(address account) external view returns (uint256);

    /// @notice Transfer tokens to a recipient directly
    function transfer(address to, uint256 amount) external returns (bool);

    /// @notice How many tokens `spender` is allowed to spend on behalf of `owner`
    function allowance(address owner, address spender) external view returns (uint256);

    /// @notice Approve `spender` to spend up to `amount` of your tokens
    /// @dev Call this BEFORE transferFrom. User must approve the Diamond to spend USDC.
    function approve(address spender, uint256 amount) external returns (bool);

    /// @notice Transfer tokens from `from` to `to` (requires prior approval)
    /// @dev This is how the Diamond pulls USDC from a user — user approves first, then
    ///      the EscrowFacet calls transferFrom to lock funds.
    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}
