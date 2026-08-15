// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

error ProtocolNotInitialized();
error ProtocolAlreadyInitialized();
error InvalidDiamondContext();
error LegacyV1StateDetected(uint256 slot, bytes32 value);
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

error UnknownRole(bytes32 role);
error MissingRole(bytes32 role, address account);
error RoleAccountAlreadyAssigned(address account);
error RoleAccountIsDiamondOwner(address account);
error LastDefaultAdmin();
error RoleAccountsMustBeDistinct();
error UnauthorizedRoleRenounce(address account, address caller);

error InvalidPricePolicy();
error InvalidPriceRound(uint256 expected, uint256 actual);
error InvalidPriceValues();
error InsufficientPriceSources(uint256 required, uint256 actual);
error StalePrice(uint256 observedAt, uint256 maxAgeSeconds);
error FutureObservation(uint256 observedAt, uint256 currentTimestamp);
error PriceDeviationExceeded(uint256 previousPriceE6, uint256 nextPriceE6);
error InvalidEvidence();
error QuoteExpired(uint256 quoteValidUntil);
error QuoteValidityTooLong(uint256 quoteValidUntil);
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
error OrderNotExpired(bytes32 orderId, uint256 deadline);
error PageLimitInvalid(uint256 limit);

error InvalidCandidateCount(uint256 count);
error InvalidCandidate(uint256 index);
error DuplicateCandidate(uint256 firstIndex, uint256 duplicateIndex);
error StaleAssignmentEpoch(uint256 expected, uint256 actual);
error AssignmentExpired(bytes32 orderId, uint256 deadline);
error AssignmentNotExpired(bytes32 orderId, uint256 deadline);
error DecisionAlreadyUsed(bytes32 decisionDigest);
error CandidateNotAssigned(address merchant, bytes32 channelId);
error CandidateAlreadyRejected(address merchant, bytes32 channelId);
error CandidateNotAcceptable(address merchant, bytes32 channelId, uint8 status);
error AcceptedRecoveryDeadlineElapsed(bytes32 orderId, uint256 deadline);

error DisputeNotAllowed(bytes32 orderId);
error DisputeNotOpen(bytes32 orderId);
