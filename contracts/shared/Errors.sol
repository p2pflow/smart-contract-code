// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

error ProtocolNotInitialized();
error ProtocolAlreadyInitialized();
error InvalidDiamondContext();
error InvalidAddress();
error InvalidFacetAddress(address facet);
error InvalidAmount();
error InvalidConfiguration();
error InvalidToken();
error InvalidTokenDecimals(uint8 actual);
error InboundBalanceMismatch(uint256 expected, uint256 received);
error OutboundBalanceMismatch(uint256 expected, uint256 debited, uint256 received);
error PlatformIsPaused();
error PlatformIsNotPaused();
error ReentrantCall();
error UnauthorizedExecutor(address caller);

error InvalidPriceValues();
error SlippageBoundExceeded(uint256 selectedPriceE6, uint256 boundPriceE6);

error MerchantAlreadyRegistered();
error MerchantNotFound(address merchant);
error MerchantNotActive(address merchant);
error MerchantNotOnline(address merchant);
error MerchantStakeBelowMinimum(address merchant, uint256 stakeUsdc, uint256 minimumUsdc);
error InvalidMerchantStatus();
error MerchantHasObligations(address merchant);
error InsufficientAvailableLiquidity(uint256 available, uint256 required);
error InsufficientFiatCapacity(uint256 availableE6, uint256 requiredE6);
error ChannelNotFound(bytes32 channelId);
error ChannelNotEligible(bytes32 channelId);
error InvalidChannelStatus();
error InvalidSideMask(uint8 sideMask);
error CapacityBelowReserved(uint256 capacityE6, uint256 reservedE6);
error ChannelHasObligations(bytes32 channelId, uint256 obligationCount);

error OrderNotFound(bytes32 orderId);
error InvalidOrderState(bytes32 orderId, uint8 actual);
error InvalidOrderType(bytes32 orderId, uint8 actual);
error UnauthorizedOrderActor(bytes32 orderId, address actor);
error CustodyAlreadyFinalized(bytes32 orderId);
error InvalidTerminalStatus(uint8 status);
error InvalidAssignment();

error DisputeNotAllowed(bytes32 orderId);
error DisputeNotOpen(bytes32 orderId);
