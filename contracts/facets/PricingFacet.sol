// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {
    AppStorageV2,
    PricePolicy,
    PriceRound,
    PublicationKind
} from "../shared/AppStorage.sol";
import {
    FutureObservation,
    InsufficientPriceSources,
    InvalidEvidence,
    InvalidPriceRound,
    InvalidPriceValues,
    StalePrice
} from "../shared/Errors.sol";
import {Modifiers} from "../shared/Modifiers.sol";
import {LibAccess} from "../libraries/LibAccess.sol";
import {LibAppStorage} from "../libraries/LibAppStorage.sol";
import {LibPricing} from "../libraries/LibPricing.sol";

contract PricingFacet is Modifiers {
    event PriceRoundPublished(
        uint256 indexed roundId,
        uint256 buyPriceE6,
        uint256 sellPriceE6,
        uint256 sourceObservedAt,
        uint256 publishedAt,
        uint256 sourceCount,
        bytes32 indexed evidenceDigest,
        PublicationKind publicationKind,
        address indexed updater
    );
    event PricePolicyUpdated(
        uint256 sourceQuorum,
        uint256 maxAgeSeconds,
        uint256 maxDeviationBps,
        address indexed by
    );

    function publishPriceRound(
        uint256 roundId,
        uint256 buyPriceE6,
        uint256 sellPriceE6,
        uint256 sourceObservedAt,
        uint256 sourceCount,
        bytes32 evidenceDigest,
        PublicationKind publicationKind
    )
        external
        onlyRole(LibAccess.PRICE_UPDATER_ROLE)
        whenNotPaused
        nonReentrant
    {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        PricePolicy storage policy = s.pricePolicy;
        uint256 expectedRoundId = s.latestPriceRoundId + 1;
        if (roundId != expectedRoundId) revert InvalidPriceRound(expectedRoundId, roundId);
        if (buyPriceE6 == 0 || sellPriceE6 == 0 || buyPriceE6 < sellPriceE6) {
            revert InvalidPriceValues();
        }
        if (sourceCount < policy.sourceQuorum) {
            revert InsufficientPriceSources(policy.sourceQuorum, sourceCount);
        }
        if (sourceObservedAt > block.timestamp) {
            revert FutureObservation(sourceObservedAt, block.timestamp);
        }
        if (block.timestamp - sourceObservedAt > policy.maxAgeSeconds) {
            revert StalePrice(sourceObservedAt, policy.maxAgeSeconds);
        }
        if (evidenceDigest == bytes32(0)) revert InvalidEvidence();

        if (s.latestPriceRoundId != 0) {
            PriceRound storage previous = s.priceRounds[s.latestPriceRoundId];
            LibPricing.enforceDeviation(
                previous.buyPriceE6,
                buyPriceE6,
                policy.maxDeviationBps
            );
            LibPricing.enforceDeviation(
                previous.sellPriceE6,
                sellPriceE6,
                policy.maxDeviationBps
            );
        }

        PriceRound storage next = s.priceRounds[roundId];
        next.roundId = roundId;
        next.buyPriceE6 = buyPriceE6;
        next.sellPriceE6 = sellPriceE6;
        next.sourceObservedAt = sourceObservedAt;
        next.publishedAt = block.timestamp;
        next.sourceCount = sourceCount;
        next.evidenceDigest = evidenceDigest;
        next.publicationKind = publicationKind;
        s.latestPriceRoundId = roundId;

        emit PriceRoundPublished(
            roundId,
            buyPriceE6,
            sellPriceE6,
            sourceObservedAt,
            block.timestamp,
            sourceCount,
            evidenceDigest,
            publicationKind,
            msg.sender
        );
    }

    function setPricePolicy(PricePolicy calldata policy)
        external
        onlyRole(LibAccess.OPERATOR_ROLE)
        nonReentrant
    {
        LibPricing.validatePolicy(policy);
        LibAppStorage.appStorage().pricePolicy = policy;
        emit PricePolicyUpdated(
            policy.sourceQuorum,
            policy.maxAgeSeconds,
            policy.maxDeviationBps,
            msg.sender
        );
    }

    function getLatestPriceRound() external view onlyInitialized returns (PriceRound memory) {
        AppStorageV2 storage s = LibAppStorage.appStorage();
        return s.priceRounds[s.latestPriceRoundId];
    }

    function getPriceRound(uint256 roundId) external view onlyInitialized returns (PriceRound memory) {
        return LibAppStorage.appStorage().priceRounds[roundId];
    }

    function getPricePolicy() external view onlyInitialized returns (PricePolicy memory) {
        return LibAppStorage.appStorage().pricePolicy;
    }
}
