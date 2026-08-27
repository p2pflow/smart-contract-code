// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {OrderType} from "../shared/AppStorage.sol";

library LibOrders {
    uint256 internal constant E6 = 1_000_000;
    uint256 internal constant ORDER_PHASE_TIMEOUT = 15 minutes;
    uint256 internal constant DISPUTE_WINDOW = 6 hours;
    uint256 internal constant MAX_PRICE_AGE = 10 minutes;

    function generateOrderId(
        address diamond,
        address user,
        uint256 nonce,
        uint256 chainId
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode("P2PFLOW_V3_ORDER", diamond, chainId, user, nonce));
    }

    function computeFiatAmountE6(
        uint256 usdcAmount,
        uint256 priceE6,
        OrderType orderType
    ) internal pure returns (uint256) {
        if (orderType == OrderType.BUY) {
            return Math.mulDiv(usdcAmount, priceE6, E6, Math.Rounding.Ceil);
        }
        return Math.mulDiv(usdcAmount, priceE6, E6, Math.Rounding.Floor);
    }
}
