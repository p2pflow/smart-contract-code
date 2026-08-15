// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafetyConfig} from "../shared/AppStorage.sol";
import {InvalidConfiguration} from "../shared/Errors.sol";

library LibConfig {
    function validateSafety(SafetyConfig memory safety) internal pure {
        if (
            safety.orderLifetimeSeconds < 60 ||
            safety.orderLifetimeSeconds > 7 days ||
            safety.assignmentLifetimeSeconds < 30 ||
            safety.assignmentLifetimeSeconds > safety.orderLifetimeSeconds ||
            safety.acceptedRecoverySeconds < 60 ||
            safety.acceptedRecoverySeconds > 7 days ||
            safety.maxQuoteValiditySeconds < 15 ||
            safety.maxQuoteValiditySeconds > safety.orderLifetimeSeconds
        ) revert InvalidConfiguration();
    }
}
