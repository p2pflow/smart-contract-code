// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IDiamondCut} from "../interfaces/IDiamondCut.sol";
import {IDiamondLoupe} from "../interfaces/IDiamondLoupe.sol";
import {IERC165} from "../interfaces/IERC165.sol";
import {IERC173} from "../interfaces/IERC173.sol";
import {AppStorageV2} from "../shared/AppStorage.sol";
import {
    InvalidAddress,
    InvalidAmount,
    InvalidDiamondContext,
    InvalidToken,
    InvalidTokenDecimals,
    ProtocolAlreadyInitialized
} from "../shared/Errors.sol";
import {LibAppStorage} from "../libraries/LibAppStorage.sol";
import {LibDiamond} from "../libraries/LibDiamond.sol";

contract DiamondInitV2 {
    struct InitConfig {
        address usdcToken;
        address executor;
        uint256 minMerchantStakeUsdc;
    }

    event ProtocolInitialized(
        address indexed usdcToken,
        address indexed diamondOwner,
        address indexed executor,
        uint256 minMerchantStakeUsdc
    );

    function initV2(InitConfig calldata input) external {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        if (s.initializedMagic != bytes32(0)) revert ProtocolAlreadyInitialized();
        address diamondOwner = LibDiamond.contractOwner();
        if (diamondOwner == address(0)) revert InvalidDiamondContext();
        if (input.executor == address(0)) revert InvalidAddress();
        if (input.minMerchantStakeUsdc == 0) revert InvalidAmount();
        _validateToken(input.usdcToken);

        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        ds.supportedInterfaces[type(IERC165).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondCut).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondLoupe).interfaceId] = true;
        ds.supportedInterfaces[type(IERC173).interfaceId] = true;

        s.config.usdcToken = input.usdcToken;
        s.config.executor = input.executor;
        s.config.paused = true;
        s.config.minMerchantStakeUsdc = input.minMerchantStakeUsdc;
        s.reentrancyStatus = LibAppStorage.NOT_ENTERED;
        s.initializedMagic = LibAppStorage.INITIALIZED_MAGIC;

        emit ProtocolInitialized(input.usdcToken, diamondOwner, input.executor, input.minMerchantStakeUsdc);
    }

    function _validateToken(address token) private view {
        if (token == address(0)) revert InvalidAddress();
        if (token.code.length == 0) revert InvalidToken();
        (bool ok, bytes memory result) = token.staticcall(abi.encodeCall(IERC20Metadata.decimals, ()));
        if (!ok || result.length < 32) revert InvalidToken();
        uint8 decimals = abi.decode(result, (uint8));
        if (decimals != 6) revert InvalidTokenDecimals(decimals);
    }
}
