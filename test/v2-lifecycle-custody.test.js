const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, mine, time } = require("@nomicfoundation/hardhat-network-helpers");

const {
  ChannelStatus,
  DisputeResolution,
  DisputeStatus,
  E6,
  MerchantStatus,
  OrderStatus,
  OrderType,
  assignOrder,
  createOrder,
  deployV2,
  publishRound,
  setupMerchant,
} = require("./helpers/v2-fixture");

async function marketFixture(options = {}) {
  const fixture = await deployV2(options);
  await publishRound(fixture);
  fixture.merchantSetup = await setupMerchant(fixture, fixture.merchantOne);
  return fixture;
}

async function acceptedOrder(fixture, orderType, amount = 100n * E6, label = "accept") {
  const created = await createOrder(fixture, orderType, amount);
  await assignOrder(fixture, created.orderId, [{
    merchant: fixture.merchantOne.address,
    channelId: fixture.merchantSetup.channelId,
  }], label);
  await fixture.orders.connect(fixture.merchantOne).acceptOrder(
    created.orderId,
    fixture.merchantSetup.channelId,
  );
  return { ...created, order: await fixture.orders.getOrder(created.orderId) };
}

async function assertConserved(fixture, merchant = fixture.merchantOne, channelId = fixture.merchantSetup?.channelId) {
  const totals = await fixture.config.getCustodyTotals();
  const tokenBalance = await fixture.usdc.balanceOf(fixture.diamondAddress);
  expect(tokenBalance).to.be.gte(
    totals.totalMerchantStakeUsdc + totals.totalMerchantLiquidityUsdc + totals.totalSellEscrowUsdc,
  );
  if (merchant && channelId) {
    const account = await fixture.merchants.getMerchant(merchant.address);
    const channel = await fixture.merchants.getChannel(channelId);
    expect(account.reservedUsdc + account.disputeLockedUsdc).to.be.lte(account.liquidityUsdc);
    expect(account.reservedFiatE6).to.equal(channel.reservedFiatE6);
    expect(account.obligationCount).to.equal(channel.obligationCount);
  }
}

describe("v2 symmetric fiat handshake and custody", function () {
  it("settles BUY only after user marks and merchant confirms, exactly once", async function () {
    const fixture = await loadFixture(marketFixture);
    const amount = 100n * E6;
    const beforeUser = await fixture.usdc.balanceOf(fixture.user.address);
    const accepted = await acceptedOrder(fixture, OrderType.BUY, amount, "buy-complete");
    let merchant = await fixture.merchants.getMerchant(fixture.merchantOne.address);
    let channel = await fixture.merchants.getChannel(fixture.merchantSetup.channelId);
    let totals = await fixture.config.getCustodyTotals();
    expect(merchant.reservedUsdc).to.equal(amount);
    expect(merchant.obligationCount).to.equal(1n);
    expect(channel.obligationCount).to.equal(1n);
    expect(totals.totalReservedBuyUsdc).to.equal(amount);
    await assertConserved(fixture);

    await expect(fixture.orders.connect(fixture.merchantOne).markFiatSent(accepted.orderId))
      .to.be.revertedWithCustomError(fixture.orders, "UnauthorizedOrderActor");
    await fixture.orders.connect(fixture.user).markFiatSent(accepted.orderId);
    expect((await fixture.orders.getOrder(accepted.orderId)).status).to.equal(OrderStatus.FIAT_SENT);
    expect(await fixture.usdc.balanceOf(fixture.user.address)).to.equal(beforeUser);
    await expect(fixture.orders.connect(fixture.user).confirmFiatReceived(accepted.orderId))
      .to.be.revertedWithCustomError(fixture.orders, "UnauthorizedOrderActor");
    await expect(fixture.orders.connect(fixture.merchantOne).confirmFiatReceived(accepted.orderId))
      .to.emit(fixture.orders, "OrderCompleted");
    expect(await fixture.usdc.balanceOf(fixture.user.address)).to.equal(beforeUser + amount);
    expect((await fixture.orders.getOrder(accepted.orderId)).status).to.equal(OrderStatus.COMPLETED);
    await expect(fixture.orders.connect(fixture.merchantOne).confirmFiatReceived(accepted.orderId))
      .to.be.revertedWithCustomError(fixture.orders, "InvalidOrderState");
    await assertConserved(fixture);
  });

  it("settles SELL only after merchant marks and user confirms, moving escrow into liquidity", async function () {
    const fixture = await loadFixture(marketFixture);
    const amount = 100n * E6;
    const accepted = await acceptedOrder(fixture, OrderType.SELL, amount, "sell-complete");
    const capacityBefore = fixture.merchantSetup.fiatCapacityE6;
    const fiat = accepted.created.args.fiatAmountE6;
    let totals = await fixture.config.getCustodyTotals();
    expect(totals.totalSellEscrowUsdc).to.equal(amount);
    expect((await fixture.merchants.getChannel(fixture.merchantSetup.channelId)).reservedFiatE6)
      .to.equal(fiat);

    await expect(fixture.orders.connect(fixture.user).markFiatSent(accepted.orderId))
      .to.be.revertedWithCustomError(fixture.orders, "UnauthorizedOrderActor");
    await fixture.orders.connect(fixture.merchantOne).markFiatSent(accepted.orderId);
    await expect(fixture.orders.connect(fixture.merchantOne).confirmFiatReceived(accepted.orderId))
      .to.be.revertedWithCustomError(fixture.orders, "UnauthorizedOrderActor");
    await fixture.orders.connect(fixture.user).confirmFiatReceived(accepted.orderId);

    totals = await fixture.config.getCustodyTotals();
    expect(totals.totalSellEscrowUsdc).to.equal(0n);
    expect(totals.totalMerchantLiquidityUsdc).to.equal(fixture.merchantSetup.liquidity + amount);
    const channel = await fixture.merchants.getChannel(fixture.merchantSetup.channelId);
    expect(channel.fiatCapacityE6).to.equal(capacityBefore - fiat);
    expect(channel.reservedFiatE6).to.equal(0n);
    await assertConserved(fixture);
  });

  it("does not let mutable BUY channel capacity block completion", async function () {
    const fixture = await loadFixture(marketFixture);
    const accepted = await acceptedOrder(fixture, OrderType.BUY, E6, "buy-capacity");
    await fixture.merchants.connect(fixture.merchantOne).setChannelFiatCapacity(
      fixture.merchantSetup.channelId,
      ethers.MaxUint256,
    );
    await fixture.orders.connect(fixture.user).markFiatSent(accepted.orderId);
    await expect(fixture.orders.connect(fixture.merchantOne).confirmFiatReceived(accepted.orderId))
      .to.emit(fixture.orders, "OrderCompleted");
    expect((await fixture.merchants.getChannel(fixture.merchantSetup.channelId)).fiatCapacityE6)
      .to.equal(ethers.MaxUint256);
  });

  it("refunds SELL escrow on CREATED/ASSIGNED cancellation and releases candidates", async function () {
    const fixture = await loadFixture(marketFixture);
    const amount = 25n * E6;
    const before = await fixture.usdc.balanceOf(fixture.user.address);
    const created = await createOrder(fixture, OrderType.SELL, amount);
    await fixture.orders.connect(fixture.user).cancelOrder(created.orderId);
    expect(await fixture.usdc.balanceOf(fixture.user.address)).to.equal(before + amount);
    expect((await fixture.orders.getOrder(created.orderId)).status).to.equal(OrderStatus.CANCELLED);

    const assigned = await createOrder(fixture, OrderType.SELL, amount);
    await assignOrder(fixture, assigned.orderId, [{
      merchant: fixture.merchantOne.address,
      channelId: fixture.merchantSetup.channelId,
    }], "cancel-assigned");
    await fixture.orders.connect(fixture.user).cancelOrder(assigned.orderId);
    const current = await fixture.assignments.getAssignment(assigned.orderId);
    expect(current.candidates).to.have.length(0);
    expect((await fixture.config.getCustodyTotals()).totalSellEscrowUsdc).to.equal(0n);
    await expect(fixture.orders.connect(fixture.user).cancelOrder(assigned.orderId))
      .to.be.revertedWithCustomError(fixture.orders, "InvalidOrderState");
    await assertConserved(fixture);
  });

  it("blocks channel termination for accepted BUY and SELL, then permits it post-terminal", async function () {
    const buyFixture = await loadFixture(marketFixture);
    const buy = await acceptedOrder(buyFixture, OrderType.BUY, E6, "term-buy");
    await expect(buyFixture.merchants.connect(buyFixture.merchantOne).terminatePaymentChannel(
      buyFixture.merchantSetup.channelId,
    )).to.be.revertedWithCustomError(buyFixture.merchants, "ChannelHasObligations");
    await buyFixture.orders.connect(buyFixture.user).markFiatSent(buy.orderId);
    await buyFixture.orders.connect(buyFixture.merchantOne).confirmFiatReceived(buy.orderId);
    await buyFixture.merchants.connect(buyFixture.merchantOne).terminatePaymentChannel(
      buyFixture.merchantSetup.channelId,
    );
    expect((await buyFixture.merchants.getChannel(buyFixture.merchantSetup.channelId)).status)
      .to.equal(ChannelStatus.TERMINATED);

    const sellFixture = await marketFixture();
    await acceptedOrder(sellFixture, OrderType.SELL, E6, "term-sell");
    await expect(sellFixture.merchants.connect(sellFixture.merchantOne).terminatePaymentChannel(
      sellFixture.merchantSetup.channelId,
    )).to.be.revertedWithCustomError(sellFixture.merchants, "CapacityBelowReserved");
  });

  it("allows PENDING merchant and REJECTED channel fund/lifecycle recovery", async function () {
    const fixture = await loadFixture(deployV2);
    const stake = 100n * E6;
    await fixture.usdc.mint(fixture.other.address, stake);
    await fixture.usdc.connect(fixture.other).approve(fixture.diamondAddress, stake);
    await fixture.merchants.connect(fixture.other).registerMerchant(stake);
    await fixture.merchants.connect(fixture.other).requestMerchantExit();
    await expect(fixture.merchants.connect(fixture.other).withdrawStake())
      .to.emit(fixture.merchants, "MerchantStakeWithdrawn");
    expect((await fixture.merchants.getMerchant(fixture.other.address)).status)
      .to.equal(MerchantStatus.EXITED);

    const setup = await setupMerchant(fixture, fixture.merchantOne);
    const rejected = await fixture.merchants.connect(fixture.merchantOne)
      .registerPaymentChannel.staticCall(3, E6);
    await fixture.merchants.connect(fixture.merchantOne).registerPaymentChannel(3, E6);
    await fixture.merchants.connect(fixture.operator).reviewPaymentChannel(rejected, ChannelStatus.REJECTED);
    await fixture.merchants.connect(fixture.merchantOne).terminatePaymentChannel(rejected);
    expect((await fixture.merchants.getChannel(rejected)).status).to.equal(ChannelStatus.TERMINATED);
    expect(setup.channelId).to.not.equal(rejected);
  });

  it("never lets withdrawal touch BUY reservations, dispute locks, stake, or SELL escrow", async function () {
    const fixture = await loadFixture(marketFixture);
    const amount = 100n * E6;
    const accepted = await acceptedOrder(fixture, OrderType.BUY, amount, "withdraw-locked");
    await fixture.merchants.connect(fixture.operator).setMerchantStatus(
      fixture.merchantOne.address,
      MerchantStatus.BLACKLISTED,
    );
    await fixture.merchants.connect(fixture.merchantOne).withdrawLiquidity(900n * E6);
    await expect(fixture.merchants.connect(fixture.merchantOne).withdrawLiquidity(1))
      .to.be.revertedWithCustomError(fixture.merchants, "InsufficientAvailableLiquidity");
    expect((await fixture.merchants.getMerchant(fixture.merchantOne.address)).stakeUsdc)
      .to.equal(100n * E6);
    await fixture.orders.connect(fixture.user).markFiatSent(accepted.orderId);
    await fixture.orders.connect(fixture.merchantOne).confirmFiatReceived(accepted.orderId);
    expect((await fixture.merchants.getMerchant(fixture.merchantOne.address)).liquidityUsdc).to.equal(0n);
    await assertConserved(fixture);
  });
});

describe("v2 recovery, pause, and disputes", function () {
  it("covers BUY/SELL CREATED, ASSIGNED, and ACCEPTED terminal recovery branches", async function () {
    const fixture = await marketFixture({ safety: { acceptedRecoverySeconds: 60 } });
    const created = [];
    for (const kind of [OrderType.BUY, OrderType.SELL]) {
      created.push({ kind, ...(await createOrder(fixture, kind, 3n * E6)) });
    }
    const assigned = [];
    for (const kind of [OrderType.BUY, OrderType.SELL]) {
      const order = await createOrder(fixture, kind, 4n * E6);
      await assignOrder(fixture, order.orderId, [{
        merchant: fixture.merchantOne.address,
        channelId: fixture.merchantSetup.channelId,
      }], `matrix-assigned-${kind}`);
      assigned.push({ kind, ...order });
    }
    const accepted = [];
    for (const kind of [OrderType.BUY, OrderType.SELL]) {
      accepted.push({ kind, ...(await acceptedOrder(fixture, kind, 5n * E6, `matrix-accepted-${kind}`)) });
    }

    for (const item of accepted) {
      if (BigInt(await time.latest()) < item.order.acceptedRecoveryDeadline) {
        await time.increaseTo(item.order.acceptedRecoveryDeadline);
      }
      await fixture.orders.connect(fixture.orderAssigner).recoverExpiredOrder(item.orderId);
      expect((await fixture.orders.getOrder(item.orderId)).status).to.equal(OrderStatus.EXPIRED);
      await expect(fixture.orders.connect(fixture.user).recoverExpiredOrder(item.orderId))
        .to.be.revertedWithCustomError(fixture.orders, "InvalidOrderState");
    }

    const openOrders = [...created, ...assigned].sort(
      (left, right) => Number(left.created.args.deadline - right.created.args.deadline),
    );
    for (const item of openOrders) {
      if (BigInt(await time.latest()) < item.created.args.deadline) {
        await time.increaseTo(item.created.args.deadline);
      }
      await fixture.orders.connect(fixture.orderAssigner).recoverExpiredOrder(item.orderId);
      expect((await fixture.orders.getOrder(item.orderId)).status).to.equal(OrderStatus.EXPIRED);
      await expect(fixture.orders.connect(fixture.user).recoverExpiredOrder(item.orderId))
        .to.be.revertedWithCustomError(fixture.orders, "InvalidOrderState");
      expect((await fixture.assignments.getAssignment(item.orderId)).candidates).to.have.length(0);
    }

    const totals = await fixture.config.getCustodyTotals();
    expect(totals.totalReservedBuyUsdc).to.equal(0n);
    expect(totals.totalSellEscrowUsdc).to.equal(0n);
    const merchant = await fixture.merchants.getMerchant(fixture.merchantOne.address);
    const channel = await fixture.merchants.getChannel(fixture.merchantSetup.channelId);
    expect(merchant.reservedUsdc).to.equal(0n);
    expect(merchant.reservedFiatE6).to.equal(0n);
    expect(merchant.obligationCount).to.equal(0n);
    expect(channel.reservedFiatE6).to.equal(0n);
    expect(channel.obligationCount).to.equal(0n);
    await assertConserved(fixture);
  });

  it("cancels both sides from CREATED and ASSIGNED without retaining current assignment state", async function () {
    const fixture = await loadFixture(marketFixture);
    for (const kind of [OrderType.BUY, OrderType.SELL]) {
      for (const shouldAssign of [false, true]) {
        const order = await createOrder(fixture, kind, E6);
        if (shouldAssign) {
          await assignOrder(fixture, order.orderId, [{
            merchant: fixture.merchantOne.address,
            channelId: fixture.merchantSetup.channelId,
          }], `cancel-${kind}-${shouldAssign}`);
        }
        await fixture.orders.connect(fixture.user).cancelOrder(order.orderId);
        expect((await fixture.orders.getOrder(order.orderId)).status).to.equal(OrderStatus.CANCELLED);
        expect((await fixture.assignments.getAssignment(order.orderId)).candidates).to.have.length(0);
        await expect(fixture.orders.connect(fixture.user).cancelOrder(order.orderId))
          .to.be.revertedWithCustomError(fixture.orders, "InvalidOrderState");
      }
    }
    expect((await fixture.config.getCustodyTotals()).totalSellEscrowUsdc).to.equal(0n);
    await assertConserved(fixture);
  });

  it("freezes pre-fiat actions at the accepted deadline and permits permission-safe recovery", async function () {
    const fixture = await marketFixture({ safety: { acceptedRecoverySeconds: 60 } });
    const beforeBoundary = await acceptedOrder(fixture, OrderType.BUY, E6, "deadline-minus-one");
    const accepted = await acceptedOrder(fixture, OrderType.BUY, E6, "deadline");
    await time.setNextBlockTimestamp(beforeBoundary.order.acceptedRecoveryDeadline - 1n);
    await expect(fixture.orders.connect(fixture.user).markFiatSent(beforeBoundary.orderId))
      .to.emit(fixture.orders, "FiatPaymentMarked");
    await time.setNextBlockTimestamp(accepted.order.acceptedRecoveryDeadline);
    await mine();
    await expect(fixture.orders.connect(fixture.user).markFiatSent.staticCall(accepted.orderId))
      .to.be.revertedWithCustomError(fixture.orders, "AcceptedRecoveryDeadlineElapsed");
    await expect(fixture.disputes.connect(fixture.user).openDispute.staticCall(accepted.orderId))
      .to.be.revertedWithCustomError(fixture.disputes, "AcceptedRecoveryDeadlineElapsed");
    await expect(fixture.orders.connect(fixture.other).recoverExpiredOrder.staticCall(accepted.orderId))
      .to.be.revertedWithCustomError(fixture.orders, "UnauthorizedOrderActor");
    await expect(fixture.orders.connect(fixture.orderAssigner).recoverExpiredOrder(accepted.orderId))
      .to.emit(fixture.orders, "OrderExpired");
    expect((await fixture.orders.getOrder(accepted.orderId)).status).to.equal(OrderStatus.EXPIRED);
    await assertConserved(fixture);
  });

  it("authorizes user, merchant, operator, and assigner accepted recovery, but no outsider", async function () {
    const fixture = await marketFixture({ safety: { acceptedRecoverySeconds: 60 } });
    const actors = [fixture.user, fixture.merchantOne, fixture.operator, fixture.orderAssigner];
    const orders = [];
    for (let index = 0; index < actors.length; index += 1) {
      orders.push(await acceptedOrder(fixture, OrderType.BUY, E6, `recover-${index}`));
    }
    for (let index = 0; index < actors.length; index += 1) {
      await time.increaseTo(orders[index].order.acceptedRecoveryDeadline);
      if (index === 0) {
        await expect(fixture.orders.connect(fixture.other).recoverExpiredOrder(orders[index].orderId))
          .to.be.revertedWithCustomError(fixture.orders, "UnauthorizedOrderActor");
      }
      await fixture.orders.connect(actors[index]).recoverExpiredOrder(orders[index].orderId);
    }
    expect((await fixture.config.getCustodyTotals()).totalReservedBuyUsdc).to.equal(0n);
    await assertConserved(fixture);
  });

  it("allows settlement and safe exits while paused but blocks new risk", async function () {
    const fixture = await loadFixture(marketFixture);
    const accepted = await acceptedOrder(fixture, OrderType.BUY, E6, "paused-settle");
    await fixture.config.connect(fixture.pauser).pausePlatform();
    const now = await time.latest();
    await expect(fixture.orders.connect(fixture.user).createBuyOrder(E6, 1, 100n * E6, now + 10))
      .to.be.revertedWithCustomError(fixture.orders, "PlatformIsPaused");
    await expect(fixture.merchants.connect(fixture.merchantOne).depositLiquidity(E6))
      .to.be.revertedWithCustomError(fixture.merchants, "PlatformIsPaused");
    await fixture.orders.connect(fixture.user).markFiatSent(accepted.orderId);
    await fixture.orders.connect(fixture.merchantOne).confirmFiatReceived(accepted.orderId);
    await expect(fixture.merchants.connect(fixture.merchantOne).withdrawLiquidity(E6)).not.to.be.reverted;

    const role = await fixture.access.PAUSER_ROLE();
    await fixture.access.connect(fixture.admin).revokeRole(role, fixture.pauser.address);
    expect(await fixture.access.hasRole(role, fixture.pauser.address)).to.equal(false);
  });

  it("resolves BUY disputes through shared cancel and settle accounting exactly once", async function () {
    const cancelledFixture = await loadFixture(marketFixture);
    const cancelled = await acceptedOrder(cancelledFixture, OrderType.BUY, 10n * E6, "buy-dispute-cancel");
    await cancelledFixture.disputes.connect(cancelledFixture.user).openDispute(cancelled.orderId);
    let merchant = await cancelledFixture.merchants.getMerchant(cancelledFixture.merchantOne.address);
    expect(merchant.reservedUsdc).to.equal(0n);
    expect(merchant.disputeLockedUsdc).to.equal(10n * E6);
    expect((await cancelledFixture.config.getCustodyTotals()).totalReservedBuyUsdc).to.equal(10n * E6);
    await expect(cancelledFixture.disputes.connect(cancelledFixture.other).resolveDispute(
      cancelled.orderId, DisputeResolution.CANCEL_TRADE,
    )).to.be.revertedWithCustomError(cancelledFixture.access, "MissingRole");
    await cancelledFixture.disputes.connect(cancelledFixture.disputeResolver).resolveDispute(
      cancelled.orderId, DisputeResolution.CANCEL_TRADE,
    );
    expect((await cancelledFixture.disputes.getDispute(cancelled.orderId)).status)
      .to.equal(DisputeStatus.RESOLVED);
    await expect(cancelledFixture.disputes.connect(cancelledFixture.disputeResolver).resolveDispute(
      cancelled.orderId, DisputeResolution.CANCEL_TRADE,
    )).to.be.revertedWithCustomError(cancelledFixture.disputes, "DisputeNotOpen");
    await assertConserved(cancelledFixture);

    const settledFixture = await marketFixture();
    const settled = await acceptedOrder(settledFixture, OrderType.BUY, 10n * E6, "buy-dispute-settle");
    const userBefore = await settledFixture.usdc.balanceOf(settledFixture.user.address);
    await settledFixture.disputes.connect(settledFixture.merchantOne).openDispute(settled.orderId);
    await settledFixture.disputes.connect(settledFixture.disputeResolver).resolveDispute(
      settled.orderId, DisputeResolution.SETTLE_TRADE,
    );
    expect(await settledFixture.usdc.balanceOf(settledFixture.user.address)).to.equal(userBefore + 10n * E6);
    expect((await settledFixture.orders.getOrder(settled.orderId)).status).to.equal(OrderStatus.COMPLETED);
    await assertConserved(settledFixture);
  });

  it("rejects invalid dispute actors/states and blocks exit/termination/over-withdraw while locked", async function () {
    const fixture = await loadFixture(marketFixture);
    const created = await createOrder(fixture, OrderType.BUY, 100n * E6);
    await expect(fixture.disputes.connect(fixture.user).openDispute(created.orderId))
      .to.be.revertedWithCustomError(fixture.disputes, "DisputeNotAllowed");
    const accepted = await acceptedOrder(fixture, OrderType.BUY, 100n * E6, "dispute-locks");
    await expect(fixture.disputes.connect(fixture.other).openDispute(accepted.orderId))
      .to.be.revertedWithCustomError(fixture.disputes, "UnauthorizedOrderActor");
    await fixture.disputes.connect(fixture.user).openDispute(accepted.orderId);
    await expect(fixture.merchants.connect(fixture.merchantOne).requestMerchantExit())
      .to.be.revertedWithCustomError(fixture.merchants, "MerchantHasObligations");
    await expect(fixture.merchants.connect(fixture.merchantOne).terminatePaymentChannel(
      fixture.merchantSetup.channelId,
    )).to.be.revertedWithCustomError(fixture.merchants, "ChannelHasObligations");
    await expect(fixture.merchants.connect(fixture.merchantOne).withdrawLiquidity(901n * E6))
      .to.be.revertedWithCustomError(fixture.merchants, "InsufficientAvailableLiquidity");
    await fixture.disputes.connect(fixture.disputeResolver).resolveDispute(
      accepted.orderId, DisputeResolution.CANCEL_TRADE,
    );
    await assertConserved(fixture);
  });

  it("resolves SELL disputes with explicit refund or escrow-to-liquidity branches", async function () {
    const cancelledFixture = await loadFixture(marketFixture);
    const amount = 10n * E6;
    const userBefore = await cancelledFixture.usdc.balanceOf(cancelledFixture.user.address);
    const cancelled = await acceptedOrder(cancelledFixture, OrderType.SELL, amount, "sell-dispute-cancel");
    await cancelledFixture.disputes.connect(cancelledFixture.user).openDispute(cancelled.orderId);
    await cancelledFixture.disputes.connect(cancelledFixture.disputeResolver).resolveDispute(
      cancelled.orderId, DisputeResolution.CANCEL_TRADE,
    );
    expect(await cancelledFixture.usdc.balanceOf(cancelledFixture.user.address)).to.equal(userBefore + amount);
    expect((await cancelledFixture.config.getCustodyTotals()).totalSellEscrowUsdc).to.equal(0n);
    await assertConserved(cancelledFixture);

    const settledFixture = await marketFixture();
    const settled = await acceptedOrder(settledFixture, OrderType.SELL, amount, "sell-dispute-settle");
    await settledFixture.orders.connect(settledFixture.merchantOne).markFiatSent(settled.orderId);
    await settledFixture.disputes.connect(settledFixture.user).openDispute(settled.orderId);
    await settledFixture.disputes.connect(settledFixture.disputeResolver).resolveDispute(
      settled.orderId, DisputeResolution.SETTLE_TRADE,
    );
    expect((await settledFixture.config.getCustodyTotals()).totalMerchantLiquidityUsdc)
      .to.equal(settledFixture.merchantSetup.liquidity + amount);
    await assertConserved(settledFixture);
  });

  it("tolerates direct token surplus without counting it as an obligation", async function () {
    const fixture = await loadFixture(marketFixture);
    await fixture.usdc.mint(fixture.diamondAddress, 7n * E6);
    const totals = await fixture.config.getCustodyTotals();
    const obligations = totals.totalMerchantStakeUsdc + totals.totalMerchantLiquidityUsdc + totals.totalSellEscrowUsdc;
    expect(await fixture.usdc.balanceOf(fixture.diamondAddress)).to.equal(obligations + 7n * E6);
    await assertConserved(fixture);
  });
});
