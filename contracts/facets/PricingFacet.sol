// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {LatestPrice} from "../shared/AppStorage.sol";
import {InvalidPriceValues} from "../shared/Errors.sol";
import {Modifiers} from "../shared/Modifiers.sol";
import {LibAppStorage} from "../libraries/LibAppStorage.sol";

contract PricingFacet is Modifiers {
    event PricesUpdated(uint256 buyPriceE6, uint256 sellPriceE6, uint256 updatedAt);

    function setPrices(uint256 buyPriceE6, uint256 sellPriceE6)
        external
        onlyExecutor
        whenNotPaused
        nonReentrant
    {
        if (buyPriceE6 == 0 || sellPriceE6 == 0 || buyPriceE6 < sellPriceE6) {
            revert InvalidPriceValues();
        }
        LibAppStorage.appStorage().latestPrice = LatestPrice({
            buyPriceE6: buyPriceE6,
            sellPriceE6: sellPriceE6,
            updatedAt: block.timestamp
        });
        emit PricesUpdated(buyPriceE6, sellPriceE6, block.timestamp);
    }

    function getLatestPrice() external view onlyInitialized returns (LatestPrice memory) {
        return LibAppStorage.appStorage().latestPrice;
    }
}
