// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PricePolicy} from "../shared/AppStorage.sol";
import {InvalidPricePolicy, PriceDeviationExceeded} from "../shared/Errors.sol";

library LibPricing {
    uint256 internal constant BPS_DENOMINATOR = 10_000;
    uint256 internal constant MIN_SOURCE_QUORUM = 2;
    uint256 internal constant MAX_SOURCE_QUORUM = 16;
    uint256 internal constant MIN_PRICE_AGE_SECONDS = 30;
    uint256 internal constant MAX_PRICE_AGE_SECONDS = 1 days;
    uint256 internal constant MAX_DEVIATION_BPS = 5_000;

    function validatePolicy(PricePolicy memory policy) internal pure {
        if (
            policy.sourceQuorum < MIN_SOURCE_QUORUM ||
            policy.sourceQuorum > MAX_SOURCE_QUORUM ||
            policy.maxAgeSeconds < MIN_PRICE_AGE_SECONDS ||
            policy.maxAgeSeconds > MAX_PRICE_AGE_SECONDS ||
            policy.maxDeviationBps == 0 ||
            policy.maxDeviationBps > MAX_DEVIATION_BPS
        ) revert InvalidPricePolicy();
    }

    function enforceDeviation(
        uint256 previousPriceE6,
        uint256 nextPriceE6,
        uint256 maxDeviationBps
    ) internal pure {
        uint256 delta = previousPriceE6 > nextPriceE6
            ? previousPriceE6 - nextPriceE6
            : nextPriceE6 - previousPriceE6;
        uint256 deviationBps = Math.mulDiv(
            delta,
            BPS_DENOMINATOR,
            previousPriceE6,
            Math.Rounding.Ceil
        );
        if (deviationBps > maxDeviationBps) {
            revert PriceDeviationExceeded(previousPriceE6, nextPriceE6);
        }
    }
}
