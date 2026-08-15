// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract TestFacetV2 {
    function v2TestPing() external pure returns (bytes32) {
        return keccak256("P2PFLOW_V2_TEST_PING");
    }
}
