// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {
    ChannelAvailability,
    ChannelStatus,
    MerchantAvailability,
    MerchantStatus,
    MerchantV2,
    OrderType,
    PaymentChannelV2
} from "../shared/AppStorage.sol";

library LibMerchants {
    uint8 internal constant SIDE_BUY = 1;
    uint8 internal constant SIDE_SELL = 2;
    uint8 internal constant SIDE_BOTH = SIDE_BUY | SIDE_SELL;

    function generateChannelId(address diamond, address merchant, uint256 nonce, uint256 chainId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode("P2PFLOW_V3_CHANNEL", diamond, chainId, merchant, nonce));
    }

    function supportsSide(uint8 sideMask, OrderType orderType) internal pure returns (bool) {
        uint8 required = orderType == OrderType.BUY ? SIDE_BUY : SIDE_SELL;
        return (sideMask & required) == required;
    }

    function availableUsdc(MerchantV2 storage merchant) internal view returns (uint256) {
        return merchant.stakeUsdc - merchant.reservedUsdc;
    }

    function availableFiatE6(PaymentChannelV2 storage channel) internal view returns (uint256) {
        return channel.fiatCapacityE6 - channel.reservedFiatE6;
    }

    function isEligibleAccount(MerchantV2 storage merchant) internal view returns (bool) {
        return merchant.wallet != address(0)
            && merchant.status == MerchantStatus.ACTIVE
            && merchant.availability == MerchantAvailability.ONLINE;
    }

    function isEligibleChannel(
        PaymentChannelV2 storage channel,
        address merchant,
        OrderType orderType
    ) internal view returns (bool) {
        return channel.channelId != bytes32(0)
            && channel.merchant == merchant
            && channel.status == ChannelStatus.APPROVED
            && channel.availability == ChannelAvailability.ACTIVE
            && supportsSide(channel.sideMask, orderType);
    }
}
