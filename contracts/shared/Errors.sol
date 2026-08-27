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
error StalePrice(uint256 updatedAt, uint256 currentTime);
error SlippageBoundExceeded(uint256 selectedPriceE6, uint256 boundPriceE6);

error MerchantAlreadyRegistered();
error MerchantNotFound(address merchant);
error MerchantNotActive(address merchant);
error MerchantNotOnline(address merchant);
error MerchantStakeBelowMinimum(address merchant, uint256 stakeUsdc, uint256 minimumUsdc);
error InvalidMerchantStatus();
error MerchantHasObligations(address merchant);
error InsufficientAvailableStake(uint256 available, uint256 required);
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
error InvalidOrderMode(bytes32 orderId, uint8 actual);
error PaymentDetailsNotShared(bytes32 orderId);
error UnauthorizedOrderActor(bytes32 orderId, address actor);
error InsufficientUserUsdcBalance(uint256 available, uint256 required);
error CustodyAlreadyFinalized(bytes32 orderId);
error InvalidTerminalStatus(uint8 status);
error InvalidAssignment();
error EmptyCandidateList();
error DuplicateCandidate(address merchant, bytes32 channelId);
error CandidateNotAssigned(bytes32 orderId, address merchant, bytes32 channelId);
error CandidateAlreadyDeclined(bytes32 orderId, address merchant, bytes32 channelId);
error OrderNotExpired(bytes32 orderId, uint256 expiresAt, uint256 currentTime);

error DisputeNotAllowed(bytes32 orderId);
error DisputeNotOpen(bytes32 orderId);
error DisputeWindowClosed(bytes32 orderId, uint256 deadline, uint256 currentTime);
