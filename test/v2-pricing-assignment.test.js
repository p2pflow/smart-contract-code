const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const {
  CandidateStatus,
  ChannelAvailability,
  E6,
  MerchantAvailability,
  OrderStatus,
  OrderType,
  PublicationKind,
  SideMask,
  createOrder,
  deployV2,
  publishRound,
  setupMerchant,
} = require("./helpers/v2-fixture");

async function fixtureWithRound() {
  const fixture = await deployV2();
  await publishRound(fixture);
  return fixture;
}

async function fixtureWithMerchant() {
  const fixture = await fixtureWithRound();
  fixture.merchantSetup = await setupMerchant(fixture, fixture.merchantOne);
  return fixture;
}

describe("v2 price rounds and quote binding", function () {
  it("restricts both publication labels to PRICE_UPDATER and stores publisher time", async function () {
    const fixture = await loadFixture(deployV2);
    const now = await time.latest();
    const args = [1, 95n * E6, 90n * E6, now, 2, ethers.id("round-1"), PublicationKind.AUTOMATED];
    await expect(fixture.pricing.connect(fixture.operator).publishPriceRound(...args))
      .to.be.revertedWithCustomError(fixture.access, "MissingRole");
    await expect(fixture.pricing.connect(fixture.other).publishPriceRound(...args))
      .to.be.revertedWithCustomError(fixture.access, "MissingRole");

    const tx = await fixture.pricing.connect(fixture.priceUpdater).publishPriceRound(...args);
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt.blockNumber);
    const stored = await fixture.pricing.getLatestPriceRound();
    expect(stored.roundId).to.equal(1n);
    expect(stored.publishedAt).to.equal(block.timestamp);
    expect(stored.evidenceDigest).to.equal(args[5]);

    const observed = await time.latest();
    await expect(fixture.pricing.connect(fixture.priceUpdater).publishPriceRound(
      2, 96n * E6, 91n * E6, observed, 2, ethers.id("emergency"), PublicationKind.EMERGENCY,
    )).to.emit(fixture.pricing, "PriceRoundPublished");
  });

  it("applies the identical validity guardrails to every publication kind", async function () {
    const fixture = await loadFixture(deployV2);
    const now = await time.latest();
    const call = (overrides = {}) => fixture.pricing.connect(fixture.priceUpdater).publishPriceRound(
      overrides.roundId ?? 1,
      overrides.buy ?? 95n * E6,
      overrides.sell ?? 90n * E6,
      overrides.observedAt ?? now,
      overrides.sources ?? 2,
      overrides.digest ?? ethers.id("evidence"),
      overrides.kind ?? PublicationKind.EMERGENCY,
    );
    await expect(call({ roundId: 2 })).to.be.revertedWithCustomError(fixture.pricing, "InvalidPriceRound");
    await expect(call({ buy: 0 })).to.be.revertedWithCustomError(fixture.pricing, "InvalidPriceValues");
    await expect(call({ buy: 89n * E6 })).to.be.revertedWithCustomError(fixture.pricing, "InvalidPriceValues");
    await expect(call({ sources: 1 })).to.be.revertedWithCustomError(fixture.pricing, "InsufficientPriceSources");
    await expect(call({ observedAt: now + 100 })).to.be.revertedWithCustomError(fixture.pricing, "FutureObservation");
    await expect(call({ observedAt: now - 301 })).to.be.revertedWithCustomError(fixture.pricing, "StalePrice");
    await expect(call({ digest: ethers.ZeroHash })).to.be.revertedWithCustomError(fixture.pricing, "InvalidEvidence");
    await expect(call()).to.emit(fixture.pricing, "PriceRoundPublished");

    const nextNow = await time.latest();
    await expect(call({ roundId: 1, observedAt: nextNow })).to.be.revertedWithCustomError(
      fixture.pricing,
      "InvalidPriceRound",
    );
  });

  it("checks independent buy/sell deviation at the exact bps boundary", async function () {
    const fixture = await loadFixture(deployV2);
    await fixture.pricing.connect(fixture.operator).setPricePolicy({
      sourceQuorum: 2,
      maxAgeSeconds: 300,
      maxDeviationBps: 300,
    });
    await publishRound(fixture, { buyPriceE6: 100n * E6, sellPriceE6: 80n * E6 });
    const now = await time.latest();
    await expect(fixture.pricing.connect(fixture.priceUpdater).publishPriceRound(
      2,
      103n * E6 + 1n,
      824n * 100_000n,
      now,
      2,
      ethers.id("one-atom-over"),
      PublicationKind.EMERGENCY,
    )).to.be.revertedWithCustomError(fixture.pricing, "PriceDeviationExceeded");
    await publishRound(fixture, { buyPriceE6: 103n * E6, sellPriceE6: 824n * 100_000n });
    const nextNow = await time.latest();
    await expect(fixture.pricing.connect(fixture.priceUpdater).publishPriceRound(
      3,
      103n * E6,
      84_872_001n,
      nextNow,
      2,
      ethers.id("sell-one-atom-over"),
      PublicationKind.AUTOMATED,
    )).to.be.revertedWithCustomError(fixture.pricing, "PriceDeviationExceeded");
  });

  it("rejects invalid policy bounds and paused publications without granting OPERATOR a bypass", async function () {
    const fixture = await loadFixture(deployV2);
    await expect(fixture.pricing.connect(fixture.other).setPricePolicy({
      sourceQuorum: 2, maxAgeSeconds: 300, maxDeviationBps: 300,
    })).to.be.revertedWithCustomError(fixture.access, "MissingRole");
    await expect(fixture.pricing.connect(fixture.operator).setPricePolicy({
      sourceQuorum: 1, maxAgeSeconds: 300, maxDeviationBps: 300,
    })).to.be.revertedWithCustomError(fixture.pricing, "InvalidPricePolicy");
    await fixture.config.connect(fixture.pauser).pausePlatform();
    const now = await time.latest();
    await expect(fixture.pricing.connect(fixture.priceUpdater).publishPriceRound(
      1, 95n * E6, 90n * E6, now, 2, ethers.id("paused"), PublicationKind.AUTOMATED,
    )).to.be.revertedWithCustomError(fixture.pricing, "PlatformIsPaused");
  });

  it("pins the latest round, freshness, quote lifetime and directional slippage", async function () {
    const fixture = await loadFixture(fixtureWithRound);
    const now = await time.latest();
    await expect(fixture.orders.connect(fixture.user).createBuyOrder(
      E6, 0, 100n * E6, now + 100,
    )).to.be.revertedWithCustomError(fixture.orders, "InvalidPriceRound");
    await expect(fixture.orders.connect(fixture.user).createBuyOrder(
      E6, 1, 94n * E6, now + 100,
    )).to.be.revertedWithCustomError(fixture.orders, "SlippageBoundExceeded");
    await expect(fixture.orders.connect(fixture.user).createSellOrder(
      E6, 1, 91n * E6, now + 100,
    )).to.be.revertedWithCustomError(fixture.orders, "SlippageBoundExceeded");
    await expect(fixture.orders.connect(fixture.user).createBuyOrder(
      E6, 1, 95n * E6, now + 400,
    )).to.be.revertedWithCustomError(fixture.orders, "QuoteValidityTooLong");
    await time.increase(301);
    const later = await time.latest();
    await expect(fixture.orders.connect(fixture.user).createBuyOrder(
      E6, 1, 95n * E6, later + 100,
    )).to.be.revertedWithCustomError(fixture.orders, "StalePrice");
  });

  it("uses BUY-ceil/SELL-floor E6 math, rejects zero fiat and avoids intermediate overflow", async function () {
    const fixture = await loadFixture(deployV2);
    await publishRound(fixture, { buyPriceE6: 1_500_001n, sellPriceE6: 1_500_001n });
    const buy = await createOrder(fixture, OrderType.BUY, 1n);
    expect(buy.created.args.fiatAmountE6).to.equal(2n);
    const sell = await createOrder(fixture, OrderType.SELL, 1n);
    expect(sell.created.args.fiatAmountE6).to.equal(1n);

    const tiny = await deployV2();
    await publishRound(tiny, { buyPriceE6: 1n, sellPriceE6: 1n });
    const quoteUntil = (await time.latest()) + 100;
    await tiny.usdc.mint(tiny.user.address, 1n);
    await tiny.usdc.connect(tiny.user).approve(tiny.diamondAddress, 1n);
    await expect(tiny.orders.connect(tiny.user).createSellOrder(1n, 1, 1, quoteUntil))
      .to.be.revertedWithCustomError(tiny.orders, "InvalidAmount");

    const huge = await deployV2();
    await publishRound(huge, { buyPriceE6: 2n * E6, sellPriceE6: 2n * E6 });
    const amount = ethers.MaxUint256 / 2n;
    const hugeOrder = await createOrder(huge, OrderType.BUY, amount);
    expect(hugeOrder.created.args.fiatAmountE6).to.equal(amount * 2n);
  });
});

describe("v2 bounded assignment", function () {
  it("assigns only a validated 1..4 set and leaves no partial writes on candidate four failure", async function () {
    const fixture = await loadFixture(fixtureWithRound);
    const merchants = [fixture.merchantOne, fixture.merchantTwo, fixture.other, fixture.newAdmin];
    const setups = [];
    for (const merchant of merchants) setups.push(await setupMerchant(fixture, merchant));
    const { orderId } = await createOrder(fixture, OrderType.BUY, 10n * E6);
    const order = await fixture.orders.getOrder(orderId);
    const digest = ethers.id("atomic-four");
    await expect(fixture.assignments.connect(fixture.orderAssigner).assignOrderCandidates(
      orderId,
      order.assignmentEpoch,
      [
        { merchant: merchants[0].address, channelId: setups[0].channelId },
        { merchant: merchants[1].address, channelId: setups[1].channelId },
        { merchant: merchants[2].address, channelId: setups[2].channelId },
        { merchant: merchants[3].address, channelId: ethers.id("missing") },
      ],
      digest,
    )).to.be.revertedWithCustomError(fixture.assignments, "ChannelNotFound");
    expect((await fixture.orders.getOrder(orderId)).status).to.equal(OrderStatus.CREATED);
    expect((await fixture.assignments.getAssignment(orderId))[4]).to.have.length(0);

    await expect(fixture.assignments.connect(fixture.orderAssigner).assignOrderCandidates(
      orderId,
      order.assignmentEpoch,
      merchants.map((merchant, index) => ({ merchant: merchant.address, channelId: setups[index].channelId })),
      digest,
    )).to.emit(fixture.assignments, "OrderCandidatesAssigned");
    const assignment = await fixture.assignments.getAssignment(orderId);
    expect(assignment[4]).to.have.length(4);
    expect(assignment[5].map(Number)).to.deep.equal([
      CandidateStatus.ASSIGNED, CandidateStatus.ASSIGNED,
      CandidateStatus.ASSIGNED, CandidateStatus.ASSIGNED,
    ]);
  });

  it("rejects empty, oversized, zero, self, duplicate merchant and duplicate channel sets", async function () {
    const fixture = await loadFixture(fixtureWithRound);
    const first = await setupMerchant(fixture, fixture.merchantOne);
    const second = await setupMerchant(fixture, fixture.merchantTwo);
    const { orderId } = await createOrder(fixture, OrderType.BUY, E6);
    const assign = (candidates, digestLabel) => fixture.assignments.connect(fixture.orderAssigner)
      .assignOrderCandidates(orderId, 1, candidates, ethers.id(digestLabel));
    await expect(assign([], "empty")).to.be.revertedWithCustomError(fixture.assignments, "InvalidCandidateCount");
    const candidate = { merchant: fixture.merchantOne.address, channelId: first.channelId };
    await expect(assign(Array(5).fill(candidate), "five"))
      .to.be.revertedWithCustomError(fixture.assignments, "InvalidCandidateCount");
    await expect(assign([{ merchant: ethers.ZeroAddress, channelId: first.channelId }], "zero"))
      .to.be.revertedWithCustomError(fixture.assignments, "InvalidCandidate");
    await expect(assign([{ merchant: fixture.user.address, channelId: first.channelId }], "self"))
      .to.be.revertedWithCustomError(fixture.assignments, "InvalidCandidate");
    await expect(assign([candidate, candidate], "exact-duplicate"))
      .to.be.revertedWithCustomError(fixture.assignments, "DuplicateCandidate");
    expect((await fixture.orders.getOrder(orderId)).status).to.equal(OrderStatus.CREATED);

    const secondChannel = await fixture.merchants.connect(fixture.merchantOne)
      .registerPaymentChannel.staticCall(SideMask.BOTH, 100_000n * E6);
    await fixture.merchants.connect(fixture.merchantOne).registerPaymentChannel(SideMask.BOTH, 100_000n * E6);
    await fixture.merchants.connect(fixture.operator).reviewPaymentChannel(secondChannel, 1);
    await fixture.merchants.connect(fixture.merchantOne).setChannelAvailability(secondChannel, 0);
    await expect(assign([
      candidate,
      { merchant: fixture.merchantOne.address, channelId: secondChannel },
    ], "same-merchant")).to.be.revertedWithCustomError(fixture.assignments, "DuplicateCandidate");
    await expect(assign([
      candidate,
      { merchant: fixture.merchantTwo.address, channelId: first.channelId },
    ], "same-channel")).to.be.revertedWithCustomError(fixture.assignments, "ChannelNotEligible");
    expect(second.channelId).to.not.equal(first.channelId);
  });

  it("rejects self-matching even when the user is a fully eligible merchant", async function () {
    const fixture = await loadFixture(fixtureWithRound);
    const own = await setupMerchant(fixture, fixture.user);
    const { orderId } = await createOrder(fixture, OrderType.BUY, E6);
    await expect(fixture.assignments.connect(fixture.orderAssigner).assignOrderCandidates(
      orderId,
      1,
      [{ merchant: fixture.user.address, channelId: own.channelId }],
      ethers.id("eligible-self"),
    )).to.be.revertedWithCustomError(fixture.assignments, "InvalidCandidate");
  });

  it("enforces assigner authority, nonzero digest, live order state and order expiry", async function () {
    const fixture = await loadFixture(fixtureWithMerchant);
    const candidate = [{
      merchant: fixture.merchantOne.address,
      channelId: fixture.merchantSetup.channelId,
    }];
    const created = await createOrder(fixture, OrderType.BUY, E6);
    await expect(fixture.assignments.connect(fixture.other).assignOrderCandidates(
      created.orderId, 1, candidate, ethers.id("unauthorized"),
    )).to.be.revertedWithCustomError(fixture.access, "MissingRole");
    await expect(fixture.assignments.connect(fixture.orderAssigner).assignOrderCandidates(
      created.orderId, 1, candidate, ethers.ZeroHash,
    )).to.be.revertedWithCustomError(fixture.assignments, "InvalidEvidence");
    await fixture.orders.connect(fixture.user).cancelOrder(created.orderId);
    await expect(fixture.assignments.connect(fixture.orderAssigner).assignOrderCandidates(
      created.orderId, 1, candidate, ethers.id("terminal"),
    )).to.be.revertedWithCustomError(fixture.assignments, "InvalidOrderState");

    const expired = await createOrder(fixture, OrderType.BUY, E6);
    const order = await fixture.orders.getOrder(expired.orderId);
    await time.increaseTo(order.orderDeadline);
    await expect(fixture.assignments.connect(fixture.orderAssigner).assignOrderCandidates(
      expired.orderId, 1, candidate, ethers.id("expired-order"),
    )).to.be.revertedWithCustomError(fixture.assignments, "AssignmentExpired");
  });

  it("revalidates live account, channel, side, stake and capacity guardrails", async function () {
    const fixture = await loadFixture(fixtureWithRound);
    const setup = await setupMerchant(fixture, fixture.merchantOne, { sideMask: SideMask.BUY });
    const sell = await createOrder(fixture, OrderType.SELL, 10n * E6);
    await expect(fixture.assignments.connect(fixture.orderAssigner).assignOrderCandidates(
      sell.orderId, 1,
      [{ merchant: fixture.merchantOne.address, channelId: setup.channelId }],
      ethers.id("wrong-side"),
    )).to.be.revertedWithCustomError(fixture.assignments, "ChannelNotEligible");

    const buy = await createOrder(fixture, OrderType.BUY, 10n * E6);
    await fixture.merchants.connect(fixture.merchantOne).setAvailability(MerchantAvailability.OFFLINE);
    await expect(fixture.assignments.connect(fixture.orderAssigner).assignOrderCandidates(
      buy.orderId, 1,
      [{ merchant: fixture.merchantOne.address, channelId: setup.channelId }],
      ethers.id("offline"),
    )).to.be.revertedWithCustomError(fixture.assignments, "MerchantNotOnline");
    await fixture.merchants.connect(fixture.merchantOne).setAvailability(MerchantAvailability.ONLINE);
    await fixture.config.connect(fixture.operator).setMinMerchantStake(101n * E6);
    await expect(fixture.assignments.connect(fixture.orderAssigner).assignOrderCandidates(
      buy.orderId, 1,
      [{ merchant: fixture.merchantOne.address, channelId: setup.channelId }],
      ethers.id("stake"),
    )).to.be.revertedWithCustomError(fixture.assignments, "MerchantStakeBelowMinimum");
  });

  it("revalidates capacity at acceptance and rejects stale/replayed decisions", async function () {
    const fixture = await loadFixture(fixtureWithMerchant);
    const { channelId } = fixture.merchantSetup;
    const first = await createOrder(fixture, OrderType.SELL, 10n * E6);
    const digest = ethers.id("global-decision");
    await fixture.assignments.connect(fixture.orderAssigner).assignOrderCandidates(
      first.orderId, 1,
      [{ merchant: fixture.merchantOne.address, channelId }], digest,
    );
    await fixture.merchants.connect(fixture.merchantOne).setChannelFiatCapacity(channelId, 1);
    await expect(fixture.orders.connect(fixture.merchantOne).acceptOrder(first.orderId, channelId))
      .to.be.revertedWithCustomError(fixture.orders, "InsufficientFiatCapacity");

    const second = await createOrder(fixture, OrderType.BUY, E6);
    await expect(fixture.assignments.connect(fixture.orderAssigner).assignOrderCandidates(
      second.orderId, 2,
      [{ merchant: fixture.merchantOne.address, channelId }], ethers.id("stale-epoch"),
    )).to.be.revertedWithCustomError(fixture.assignments, "StaleAssignmentEpoch");
    await expect(fixture.assignments.connect(fixture.orderAssigner).assignOrderCandidates(
      second.orderId, 1,
      [{ merchant: fixture.merchantOne.address, channelId }], digest,
    )).to.be.revertedWithCustomError(fixture.assignments, "DecisionAlreadyUsed");
  });

  it("revalidates merchant status, channel availability, and BUY liquidity at acceptance", async function () {
    const fixture = await loadFixture(fixtureWithMerchant);
    const { channelId } = fixture.merchantSetup;

    const blacklisted = await createOrder(fixture, OrderType.BUY, 10n * E6);
    await fixture.assignments.connect(fixture.orderAssigner).assignOrderCandidates(
      blacklisted.orderId, 1,
      [{ merchant: fixture.merchantOne.address, channelId }], ethers.id("blacklist-race"),
    );
    await fixture.merchants.connect(fixture.operator).setMerchantStatus(fixture.merchantOne.address, 3);
    await expect(fixture.orders.connect(fixture.merchantOne).acceptOrder(blacklisted.orderId, channelId))
      .to.be.revertedWithCustomError(fixture.orders, "MerchantNotActive");
    await fixture.merchants.connect(fixture.operator).setMerchantStatus(fixture.merchantOne.address, 2);
    await fixture.merchants.connect(fixture.operator).setMerchantStatus(fixture.merchantOne.address, 1);
    await fixture.merchants.connect(fixture.merchantOne).setAvailability(MerchantAvailability.ONLINE);

    const inactiveChannel = await createOrder(fixture, OrderType.BUY, 10n * E6);
    await fixture.assignments.connect(fixture.orderAssigner).assignOrderCandidates(
      inactiveChannel.orderId, 1,
      [{ merchant: fixture.merchantOne.address, channelId }], ethers.id("channel-race"),
    );
    await fixture.merchants.connect(fixture.merchantOne).setChannelAvailability(
      channelId, ChannelAvailability.INACTIVE,
    );
    await expect(fixture.orders.connect(fixture.merchantOne).acceptOrder(inactiveChannel.orderId, channelId))
      .to.be.revertedWithCustomError(fixture.orders, "ChannelNotEligible");
    await fixture.merchants.connect(fixture.merchantOne).setChannelAvailability(
      channelId, ChannelAvailability.ACTIVE,
    );

    const drained = await createOrder(fixture, OrderType.BUY, fixture.merchantSetup.liquidity);
    await fixture.assignments.connect(fixture.orderAssigner).assignOrderCandidates(
      drained.orderId, 1,
      [{ merchant: fixture.merchantOne.address, channelId }], ethers.id("liquidity-race"),
    );
    await fixture.merchants.connect(fixture.merchantOne).withdrawLiquidity(1);
    await expect(fixture.orders.connect(fixture.merchantOne).acceptOrder(drained.orderId, channelId))
      .to.be.revertedWithCustomError(fixture.orders, "InsufficientAvailableLiquidity");
  });

  it("expires/rejects assignments at bounded deadlines and exposes only the current epoch", async function () {
    const fixture = await loadFixture(fixtureWithMerchant);
    const { channelId } = fixture.merchantSetup;
    const first = await createOrder(fixture, OrderType.BUY, E6);
    await fixture.assignments.connect(fixture.orderAssigner).assignOrderCandidates(
      first.orderId, 1,
      [{ merchant: fixture.merchantOne.address, channelId }], ethers.id("expire"),
    );
    const before = await fixture.assignments.getAssignment(first.orderId);
    await expect(fixture.assignments.connect(fixture.other).expireAssignment(first.orderId))
      .to.be.revertedWithCustomError(fixture.assignments, "AssignmentNotExpired");
    await time.increaseTo(before.deadline);
    await expect(fixture.assignments.connect(fixture.other).expireAssignment(first.orderId))
      .to.be.revertedWithCustomError(fixture.assignments, "UnauthorizedOrderActor");
    await expect(fixture.orders.connect(fixture.merchantOne).acceptOrder(first.orderId, channelId))
      .to.be.revertedWithCustomError(fixture.orders, "AssignmentExpired");
    await fixture.assignments.connect(fixture.orderAssigner).expireAssignment(first.orderId);
    const after = await fixture.assignments.getAssignment(first.orderId);
    expect(after.assignmentEpoch).to.equal(2n);
    expect(after.candidates).to.have.length(0);
    expect(after.decisionDigest).to.equal(ethers.ZeroHash);
    expect((await fixture.orders.getOrder(first.orderId)).status).to.equal(OrderStatus.CREATED);

    await publishRound(fixture);
    const second = await createOrder(fixture, OrderType.BUY, E6);
    await fixture.assignments.connect(fixture.orderAssigner).assignOrderCandidates(
      second.orderId, 1,
      [{ merchant: fixture.merchantOne.address, channelId }], ethers.id("reject"),
    );
    await fixture.orders.connect(fixture.merchantOne).rejectAssignment(second.orderId, channelId);
    const rejected = await fixture.assignments.getAssignment(second.orderId);
    expect(rejected.assignmentEpoch).to.equal(2n);
    expect(rejected.candidates).to.have.length(0);
    expect((await fixture.orders.getOrder(second.orderId)).status).to.equal(OrderStatus.CREATED);
  });
});
