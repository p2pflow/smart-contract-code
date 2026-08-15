// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only six-decimal token that withholds one atom on transferFrom.
contract FeeOnTransferERC20 is ERC20 {
    bool public feeOnTransfer = true;
    bool public feeOnTransferFrom = true;

    constructor() ERC20("Fee token", "FEE") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFeeModes(bool onTransfer, bool onTransferFrom) external {
        feeOnTransfer = onTransfer;
        feeOnTransferFrom = onTransferFrom;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        address spender = _msgSender();
        _spendAllowance(from, spender, value);
        uint256 received = feeOnTransferFrom && value != 0 ? value - 1 : value;
        _transfer(from, to, received);
        if (value != received) _burn(from, value - received);
        return true;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        uint256 received = feeOnTransfer && value != 0 ? value - 1 : value;
        _transfer(_msgSender(), to, received);
        if (value != received) _burn(_msgSender(), value - received);
        return true;
    }
}
