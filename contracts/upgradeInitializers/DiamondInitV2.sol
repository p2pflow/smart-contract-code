// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IDiamondCut} from "../interfaces/IDiamondCut.sol";
import {IDiamondLoupe} from "../interfaces/IDiamondLoupe.sol";
import {IERC165} from "../interfaces/IERC165.sol";
import {IERC173} from "../interfaces/IERC173.sol";
import {
    AppStorageV2,
    PricePolicy,
    SafetyConfig
} from "../shared/AppStorage.sol";
import {
    InvalidAddress,
    InvalidAmount,
    InvalidDiamondContext,
    InvalidToken,
    InvalidTokenDecimals,
    LegacyV1StateDetected,
    ProtocolAlreadyInitialized,
    RoleAccountsMustBeDistinct
} from "../shared/Errors.sol";
import {LibAccess} from "../libraries/LibAccess.sol";
import {LibAppStorage} from "../libraries/LibAppStorage.sol";
import {LibDiamond} from "../libraries/LibDiamond.sol";
import {LibConfig} from "../libraries/LibConfig.sol";
import {LibPricing} from "../libraries/LibPricing.sol";

/// @notice Fresh-deployment-only initializer for the privacy-safe v2 namespace.
/// @dev It intentionally refuses any Diamond whose legacy slot-zero region is non-empty.
contract DiamondInitV2 {
    struct RoleAccounts {
        address defaultAdmin;
        address operator;
        address upgrader;
        address pauser;
        address priceUpdater;
        address orderAssigner;
        address disputeResolver;
    }

    struct InitConfig {
        address usdcToken;
        uint256 minMerchantStakeUsdc;
        SafetyConfig safety;
        PricePolicy pricePolicy;
        RoleAccounts roles;
    }

    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event ProtocolInitialized(
        bytes32 indexed protocolId,
        uint256 protocolVersion,
        uint256 layoutVersion,
        bytes32 storageNamespace,
        address indexed usdcToken,
        address indexed diamondOwner,
        bytes32 rolesDigest,
        bytes32 configurationDigest
    );
    event SafetyConfigUpdated(
        uint256 orderLifetimeSeconds,
        uint256 assignmentLifetimeSeconds,
        uint256 acceptedRecoverySeconds,
        uint256 maxQuoteValiditySeconds,
        address indexed by
    );
    event MinMerchantStakeUpdated(uint256 minMerchantStakeUsdc, address indexed by);
    event PlatformPaused(address indexed by);
    event PricePolicyUpdated(
        uint256 sourceQuorum,
        uint256 maxAgeSeconds,
        uint256 maxDeviationBps,
        address indexed by
    );

    function initV2(InitConfig calldata input) external {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        if (s.initializedMagic != bytes32(0) || s.config.protocolVersion != 0) {
            revert ProtocolAlreadyInitialized();
        }

        address diamondOwner = LibDiamond.contractOwner();
        if (diamondOwner == address(0)) revert InvalidDiamondContext();
        _refuseLegacyV1Slots();
        _validateToken(input.usdcToken);
        _validateConfiguration(input);
        _validateDistinctRoles(diamondOwner, input.roles);

        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        ds.supportedInterfaces[type(IERC165).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondCut).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondLoupe).interfaceId] = true;
        ds.supportedInterfaces[type(IERC173).interfaceId] = true;

        s.config.protocolId = LibAppStorage.PROTOCOL_ID;
        s.config.protocolVersion = LibAppStorage.PROTOCOL_VERSION;
        s.config.layoutVersion = LibAppStorage.LAYOUT_VERSION;
        s.config.usdcToken = input.usdcToken;
        s.config.paused = true;
        s.config.minMerchantStakeUsdc = input.minMerchantStakeUsdc;
        s.config.safety = input.safety;
        s.pricePolicy = input.pricePolicy;
        s.reentrancyStatus = LibAppStorage.NOT_ENTERED;

        _grantInitialRole(LibAccess.DEFAULT_ADMIN_ROLE, input.roles.defaultAdmin);
        _grantInitialRole(LibAccess.OPERATOR_ROLE, input.roles.operator);
        _grantInitialRole(LibAccess.UPGRADER_ROLE, input.roles.upgrader);
        _grantInitialRole(LibAccess.PAUSER_ROLE, input.roles.pauser);
        _grantInitialRole(LibAccess.PRICE_UPDATER_ROLE, input.roles.priceUpdater);
        _grantInitialRole(LibAccess.ORDER_ASSIGNER_ROLE, input.roles.orderAssigner);
        _grantInitialRole(LibAccess.DISPUTE_RESOLVER_ROLE, input.roles.disputeResolver);

        s.initializedMagic = LibAppStorage.INITIALIZED_MAGIC;

        bytes32 rolesDigest = keccak256(abi.encode(input.roles));
        bytes32 configurationDigest = keccak256(
            abi.encode(
                input.usdcToken,
                input.minMerchantStakeUsdc,
                input.safety,
                input.pricePolicy
            )
        );
        emit ProtocolInitialized(
            LibAppStorage.PROTOCOL_ID,
            LibAppStorage.PROTOCOL_VERSION,
            LibAppStorage.LAYOUT_VERSION,
            LibAppStorage.STORAGE_NAMESPACE,
            input.usdcToken,
            diamondOwner,
            rolesDigest,
            configurationDigest
        );
        emit SafetyConfigUpdated(
            input.safety.orderLifetimeSeconds,
            input.safety.assignmentLifetimeSeconds,
            input.safety.acceptedRecoverySeconds,
            input.safety.maxQuoteValiditySeconds,
            msg.sender
        );
        emit MinMerchantStakeUpdated(input.minMerchantStakeUsdc, msg.sender);
        emit PricePolicyUpdated(
            input.pricePolicy.sourceQuorum,
            input.pricePolicy.maxAgeSeconds,
            input.pricePolicy.maxDeviationBps,
            msg.sender
        );
        emit PlatformPaused(msg.sender);
    }

    function _grantInitialRole(bytes32 role, address account) private {
        LibAccess.grantRole(role, account);
        emit RoleGranted(role, account, msg.sender);
    }

    function _validateToken(address token) private view {
        if (token == address(0)) revert InvalidAddress();
        if (token.code.length == 0) revert InvalidToken();
        (bool ok, bytes memory result) = token.staticcall(
            abi.encodeCall(IERC20Metadata.decimals, ())
        );
        if (!ok || result.length < 32) revert InvalidToken();
        uint8 decimals = abi.decode(result, (uint8));
        if (decimals != 6) revert InvalidTokenDecimals(decimals);
    }

    function _validateConfiguration(InitConfig calldata input) private pure {
        if (input.minMerchantStakeUsdc == 0) revert InvalidAmount();
        LibPricing.validatePolicy(input.pricePolicy);
        LibConfig.validateSafety(input.safety);
    }

    function _validateDistinctRoles(address diamondOwner, RoleAccounts calldata roles) private pure {
        address[8] memory accounts = [
            diamondOwner,
            roles.defaultAdmin,
            roles.operator,
            roles.upgrader,
            roles.pauser,
            roles.priceUpdater,
            roles.orderAssigner,
            roles.disputeResolver
        ];
        for (uint256 i; i < accounts.length; ++i) {
            if (accounts[i] == address(0)) revert InvalidAddress();
            for (uint256 j = i + 1; j < accounts.length; ++j) {
                if (accounts[i] == accounts[j]) revert RoleAccountsMustBeDistinct();
            }
        }
    }

    function _refuseLegacyV1Slots() private view {
        for (uint256 slot; slot < 5; ++slot) {
            bytes32 value;
            assembly {
                value := sload(slot)
            }
            if (value != bytes32(0)) revert LegacyV1StateDetected(slot, value);
        }
    }
}
