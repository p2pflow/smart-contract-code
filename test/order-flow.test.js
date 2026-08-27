const { expect } = require("chai");
const { ethers } = require("hardhat");

const E6 = 1_000_000n;
const BUY_PRICE = 100n * E6;
const SELL_PRICE = 95n * E6;
const PHASE_TIMEOUT = 15 * 60;
const DISPUTE_WINDOW = 6 * 60 * 60;

const FACETS = [
  "DiamondLoupeFacet",
  "OwnershipFacet",
  "AccessControlFacet",
  "ConfigFacet",
  "PricingFacet",
  "MerchantFacet",
  "AssignmentFacet",
  "OrderFacet",
  "DisputeFacet",
];

function selectors(contract) {
  return contract.interface.fragments
    .filter((fragment) => fragment.type === "function")
    .map((fragment) => fragment.selector);
}

async function eventArgument(transaction, contract, eventName, argumentName) {
  const receipt = await transaction.wait();
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === eventName) return parsed.args[argumentName];
    } catch {
      // Another facet or the token emitted this log.
    }
  }
  throw new Error(`${eventName} was not emitted`);
}

async function increase(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function deployProtocol() {
  const [owner, merchantA, merchantB, user, outsider] = await ethers.getSigners();
  const token = await ethers.deployContract("MockERC20", ["Mock USDC", "mUSDC", 6]);
  const cutFacet = await ethers.deployContract("DiamondCutFacet");
  const diamond = await ethers.deployContract("Diamond", [owner.address, await cutFacet.getAddress()]);
  const deployedFacets = [];
  for (const name of FACETS) deployedFacets.push(await ethers.deployContract(name));
  const initializer = await ethers.deployContract("DiamondInitV2");
  const cut = deployedFacets.map((facet) => ({
    facetAddress: facet.target,
    action: 0,
    functionSelectors: selectors(facet),
  }));
  const initData = initializer.interface.encodeFunctionData("initV2", [{
    usdcToken: token.target,
    executor: owner.address,
    minMerchantStakeUsdc: 100n * E6,
  }]);
  await (await cutFacet.attach(diamond.target).diamondCut(cut, initializer.target, initData)).wait();

  const config = await ethers.getContractAt("ConfigFacet", diamond.target);
  const pricing = await ethers.getContractAt("PricingFacet", diamond.target);
  const merchants = await ethers.getContractAt("MerchantFacet", diamond.target);
  const assignment = await ethers.getContractAt("AssignmentFacet", diamond.target);
  const orders = await ethers.getContractAt("OrderFacet", diamond.target);
  const disputes = await ethers.getContractAt("DisputeFacet", diamond.target);
  await (await config.unpausePlatform()).wait();
  await (await pricing.setPrices(BUY_PRICE, SELL_PRICE)).wait();

  const channels = new Map();
  for (const merchant of [merchantA, merchantB]) {
    await (await token.mint(merchant.address, 200n * E6)).wait();
    await (await token.connect(merchant).approve(diamond.target, 200n * E6)).wait();
    await (await merchants.connect(merchant).registerMerchant(200n * E6)).wait();
    const channelTx = await merchants.connect(merchant).registerPaymentChannel(3, 0);
    const channelId = await eventArgument(channelTx, merchants, "PaymentChannelRegistered", "channelId");
    await (await merchants.reviewPaymentChannel(channelId, 1)).wait();
    channels.set(merchant.address, channelId);
  }
  await (await token.mint(user.address, 100n * E6)).wait();

  return {
    owner,
    merchantA,
    merchantB,
    user,
    outsider,
    token,
    diamond,
    config,
    pricing,
    merchants,
    assignment,
    orders,
    disputes,
    channelA: channels.get(merchantA.address),
    channelB: channels.get(merchantB.address),
  };
}

async function refreshPrice(context) {
  await (await context.pricing.setPrices(BUY_PRICE, SELL_PRICE)).wait();
}

async function createOrder(context, signer, method, amount, bound) {
  await refreshPrice(context);
  const tx = await context.orders.connect(signer)[method](amount, bound);
  return eventArgument(tx, context.orders, "OrderCreated", "orderId");
}

async function assign(context, orderId, candidates) {
  await (await context.assignment.assignOrder(orderId, candidates)).wait();
}

async function seedFiat(context, merchant, channelId, usdcAmount = 20n * E6) {
  const orderId = await createOrder(context, context.user, "createBuyOrder", usdcAmount, BUY_PRICE);
  await assign(context, orderId, [{ merchant: merchant.address, channelId }]);
  await (await context.orders.connect(merchant).acceptOrder(orderId, channelId)).wait();
  await (await context.orders.connect(context.user).markFiatSent(orderId)).wait();
  await (await context.orders.connect(merchant).confirmFiatReceived(orderId)).wait();
  return orderId;
}

describe("P2PFlow final neutral-dispute flow", function () {
  it("activates merchants immediately and keeps deposited stake separate from current liquidity", async function () {
    const context = await deployProtocol();
    const merchant = await context.merchants.getMerchant(context.merchantA.address);
    expect(merchant.status).to.equal(1n);
    expect(merchant.availability).to.equal(0n);
    const channel = await context.merchants.getChannel(context.channelA);
    expect(channel.status).to.equal(1n);
    expect(channel.fiatCapacityE6).to.equal(0n);

    await seedFiat(context, context.merchantA, context.channelA, 10n * E6);
    const balances = await context.merchants.getMerchantBalances(context.merchantA.address);
    expect(balances.depositedStakeUsdc).to.equal(200n * E6);
    expect(balances.currentUsdc).to.equal(190n * E6);
    expect(balances.availableUsdc).to.equal(190n * E6);
    expect((await context.merchants.getChannelCapacity(context.channelA)).capacityE6).to.equal(1_000n * E6);
  });

  it("assigns multiple candidates, lets the first acceptance win and releases an accepted BUY on cancel", async function () {
    const context = await deployProtocol();
    const orderId = await createOrder(context, context.user, "createBuyOrder", 10n * E6, BUY_PRICE);
    await assign(context, orderId, [
      { merchant: context.merchantA.address, channelId: context.channelA },
      { merchant: context.merchantB.address, channelId: context.channelB },
    ]);
    expect((await context.assignment.getOrderCandidates(orderId)).length).to.equal(2);
    await (await context.orders.connect(context.merchantB).acceptOrder(orderId, context.channelB)).wait();
    expect((await context.orders.getOrder(orderId)).merchant).to.equal(context.merchantB.address);
    await expect(context.orders.connect(context.merchantA).acceptOrder(orderId, context.channelA))
      .to.be.revertedWithCustomError(context.orders, "InvalidOrderState");
    expect((await context.merchants.getMerchantBalances(context.merchantB.address)).reservedUsdc).to.equal(10n * E6);

    await (await context.orders.connect(context.user).cancelOrder(orderId)).wait();
    const cancelled = await context.orders.getOrder(orderId);
    expect(cancelled.status).to.equal(5n);
    expect(cancelled.disputeDeadline).to.be.greaterThan(cancelled.cancelledAt);
    expect((await context.merchants.getMerchantBalances(context.merchantB.address)).reservedUsdc).to.equal(0n);
  });

  it("opens and neutrally resolves a cancelled accepted BUY dispute without moving USDC", async function () {
    const context = await deployProtocol();
    const orderId = await createOrder(context, context.user, "createBuyOrder", 10n * E6, BUY_PRICE);
    await assign(context, orderId, [{ merchant: context.merchantA.address, channelId: context.channelA }]);
    await (await context.orders.connect(context.merchantA).acceptOrder(orderId, context.channelA)).wait();
    await (await context.orders.connect(context.user).cancelOrder(orderId)).wait();
    const before = await context.token.balanceOf(context.diamond.target);

    await (await context.disputes.connect(context.user).openDispute(orderId)).wait();
    let merchant = await context.merchants.getMerchant(context.merchantA.address);
    expect(merchant.status).to.equal(4n);
    expect(merchant.availability).to.equal(1n);
    expect(merchant.openDisputeCount).to.equal(1n);
    await expect(context.merchants.connect(context.merchantA).requestUnstake())
      .to.be.revertedWithCustomError(context.merchants, "InvalidMerchantStatus");

    await (await context.disputes.resolveDisputeNeutral(orderId)).wait();
    merchant = await context.merchants.getMerchant(context.merchantA.address);
    expect(merchant.status).to.equal(1n);
    expect(merchant.availability).to.equal(1n);
    expect(merchant.openDisputeCount).to.equal(0n);
    expect(await context.token.balanceOf(context.diamond.target)).to.equal(before);
  });

  it("expires a marked-paid BUY and permits a six-hour neutral dispute", async function () {
    const context = await deployProtocol();
    const orderId = await createOrder(context, context.user, "createBuyOrder", 10n * E6, BUY_PRICE);
    await assign(context, orderId, [{ merchant: context.merchantA.address, channelId: context.channelA }]);
    await (await context.orders.connect(context.merchantA).acceptOrder(orderId, context.channelA)).wait();
    await (await context.orders.connect(context.user).markFiatSent(orderId)).wait();
    await expect(context.orders.processExpiredOrder(orderId))
      .to.be.revertedWithCustomError(context.orders, "OrderNotExpired");
    await increase(PHASE_TIMEOUT + 1);
    await (await context.orders.connect(context.outsider).processExpiredOrder(orderId)).wait();
    expect((await context.orders.getOrder(orderId)).status).to.equal(5n);
    await (await context.disputes.connect(context.user).openDispute(orderId)).wait();
    await (await context.disputes.resolveDisputeNeutral(orderId)).wait();
    await (await context.merchants.connect(context.merchantA).setAvailability(0)).wait();

    const secondId = await createOrder(context, context.user, "createBuyOrder", 1n * E6, BUY_PRICE);
    await assign(context, secondId, [{ merchant: context.merchantA.address, channelId: context.channelA }]);
    await (await context.orders.connect(context.merchantA).acceptOrder(secondId, context.channelA)).wait();
    await (await context.orders.connect(context.user).cancelOrder(secondId)).wait();
    await increase(DISPUTE_WINDOW + 1);
    await expect(context.disputes.connect(context.user).openDispute(secondId))
      .to.be.revertedWithCustomError(context.disputes, "DisputeWindowClosed");
  });

  it("pulls SELL escrow only on acceptance and cancels atomically when user funds are unavailable", async function () {
    const context = await deployProtocol();
    await seedFiat(context, context.merchantA, context.channelA);
    const beforeCreate = await context.token.balanceOf(context.diamond.target);
    const sellId = await createOrder(context, context.user, "createSellOrder", 5n * E6, SELL_PRICE);
    expect(await context.token.balanceOf(context.diamond.target)).to.equal(beforeCreate);
    await assign(context, sellId, [{ merchant: context.merchantA.address, channelId: context.channelA }]);
    await (await context.orders.connect(context.merchantA).acceptOrder(sellId, context.channelA)).wait();
    expect(await context.token.balanceOf(context.diamond.target)).to.equal(beforeCreate);
    const unfunded = await context.orders.getOrder(sellId);
    expect(unfunded.status).to.equal(5n);
    expect(unfunded.cancellationReason).to.equal(4n);
    expect((await context.merchants.getChannelCapacity(context.channelA)).reservedE6).to.equal(0n);

    await (await context.token.connect(context.user).approve(context.diamond.target, 5n * E6)).wait();
    const fundedSell = await createOrder(context, context.user, "createSellOrder", 5n * E6, SELL_PRICE);
    await assign(context, fundedSell, [{ merchant: context.merchantA.address, channelId: context.channelA }]);
    await (await context.orders.connect(context.merchantA).acceptOrder(fundedSell, context.channelA)).wait();
    expect((await context.orders.getOrder(fundedSell)).sellEscrowed).to.equal(true);
    expect(await context.token.balanceOf(context.diamond.target)).to.equal(beforeCreate + 5n * E6);
  });

  it("rejects an underfunded SELL before an order is created", async function () {
    const context = await deployProtocol();
    await refreshPrice(context);

    await expect(context.orders.connect(context.user).createSellOrder(101n * E6, SELL_PRICE))
      .to.be.revertedWithCustomError(context.orders, "InsufficientUserUsdcBalance")
      .withArgs(100n * E6, 101n * E6);
  });

  it("keeps Scan & Pay details off-chain and blocks settlement until the executor marks them ready", async function () {
    const context = await deployProtocol();
    await seedFiat(context, context.merchantA, context.channelA);
    await (await context.token.connect(context.user).approve(context.diamond.target, 5n * E6)).wait();
    await refreshPrice(context);

    const createTx = await context.orders.connect(context.user).createScanPayOrder(5n * E6, SELL_PRICE);
    const scanPayId = await eventArgument(createTx, context.orders, "OrderCreated", "orderId");
    let order = await context.orders.getOrder(scanPayId);
    expect(order.orderType).to.equal(1n);
    expect(order.orderMode).to.equal(1n);
    expect(order.paymentDetailsShared).to.equal(false);

    await assign(context, scanPayId, [{ merchant: context.merchantA.address, channelId: context.channelA }]);
    await (await context.orders.connect(context.merchantA).acceptOrder(scanPayId, context.channelA)).wait();
    await expect(context.orders.connect(context.merchantA).markFiatSent(scanPayId))
      .to.be.revertedWithCustomError(context.orders, "PaymentDetailsNotShared")
      .withArgs(scanPayId);
    await expect(context.orders.connect(context.outsider).markScanPayDetailsShared(scanPayId))
      .to.be.revertedWithCustomError(context.orders, "UnauthorizedExecutor");

    const beforeShared = await context.orders.getOrder(scanPayId);
    await increase(1);
    await expect(context.orders.markScanPayDetailsShared(scanPayId))
      .to.emit(context.orders, "PaymentDetailsShared");
    order = await context.orders.getOrder(scanPayId);
    expect(order.paymentDetailsShared).to.equal(true);
    expect(order.paymentDetailsSharedAt).to.be.greaterThan(0n);
    expect(order.expiresAt).to.be.greaterThan(beforeShared.expiresAt);

    await (await context.orders.connect(context.merchantA).markFiatSent(scanPayId)).wait();
    expect((await context.orders.getOrder(scanPayId)).status).to.equal(4n);
  });

  it("requires a fresh Scan & Pay payload after an accepted merchant releases the order", async function () {
    const context = await deployProtocol();
    await seedFiat(context, context.merchantA, context.channelA);
    await seedFiat(context, context.merchantB, context.channelB);
    await (await context.token.connect(context.user).approve(context.diamond.target, 5n * E6)).wait();
    await refreshPrice(context);
    const tx = await context.orders.connect(context.user).createScanPayOrder(5n * E6, SELL_PRICE);
    const orderId = await eventArgument(tx, context.orders, "OrderCreated", "orderId");
    await assign(context, orderId, [
      { merchant: context.merchantA.address, channelId: context.channelA },
      { merchant: context.merchantB.address, channelId: context.channelB },
    ]);
    await (await context.orders.connect(context.merchantA).acceptOrder(orderId, context.channelA)).wait();
    await (await context.orders.markScanPayDetailsShared(orderId)).wait();
    await (await context.orders.connect(context.merchantA).cancelAcceptedSellOrder(orderId)).wait();
    expect((await context.orders.getOrder(orderId)).paymentDetailsShared).to.equal(false);

    await (await context.orders.connect(context.merchantB).acceptOrder(orderId, context.channelB)).wait();
    await expect(context.orders.connect(context.merchantB).markFiatSent(orderId))
      .to.be.revertedWithCustomError(context.orders, "PaymentDetailsNotShared");
  });

  it("reassigns an accepted SELL after merchant cancellation without pulling escrow twice", async function () {
    const context = await deployProtocol();
    await seedFiat(context, context.merchantA, context.channelA);
    await seedFiat(context, context.merchantB, context.channelB);
    await (await context.token.connect(context.user).approve(context.diamond.target, 10n * E6)).wait();
    const sellId = await createOrder(context, context.user, "createSellOrder", 5n * E6, SELL_PRICE);
    await assign(context, sellId, [
      { merchant: context.merchantA.address, channelId: context.channelA },
      { merchant: context.merchantB.address, channelId: context.channelB },
    ]);
    await (await context.orders.connect(context.merchantA).acceptOrder(sellId, context.channelA)).wait();
    const escrowBalance = await context.token.balanceOf(context.diamond.target);
    await (await context.orders.connect(context.merchantA).cancelAcceptedSellOrder(sellId)).wait();
    expect((await context.orders.getOrder(sellId)).status).to.equal(1n);
    await expect(context.orders.connect(context.merchantA).acceptOrder(sellId, context.channelA))
      .to.be.revertedWithCustomError(context.orders, "CandidateAlreadyDeclined");
    await (await context.orders.connect(context.merchantB).acceptOrder(sellId, context.channelB)).wait();
    expect(await context.token.balanceOf(context.diamond.target)).to.equal(escrowBalance);
    await (await context.orders.connect(context.merchantB).markFiatSent(sellId)).wait();
    expect((await context.orders.getOrder(sellId)).status).to.equal(4n);
  });

  it("opens and neutrally resolves a completed SELL dispute without changing settlement", async function () {
    const context = await deployProtocol();
    await seedFiat(context, context.merchantA, context.channelA);
    await (await context.token.connect(context.user).approve(context.diamond.target, 5n * E6)).wait();
    const sellId = await createOrder(context, context.user, "createSellOrder", 5n * E6, SELL_PRICE);
    await assign(context, sellId, [{ merchant: context.merchantA.address, channelId: context.channelA }]);
    await (await context.orders.connect(context.merchantA).acceptOrder(sellId, context.channelA)).wait();
    await (await context.orders.connect(context.merchantA).markFiatSent(sellId)).wait();
    const merchantBefore = await context.merchants.getMerchantBalances(context.merchantA.address);
    const channelBefore = await context.merchants.getChannelCapacity(context.channelA);
    const userBefore = await context.token.balanceOf(context.user.address);

    await (await context.disputes.connect(context.user).openDispute(sellId)).wait();
    await (await context.disputes.resolveDisputeNeutral(sellId)).wait();
    const merchantAfter = await context.merchants.getMerchantBalances(context.merchantA.address);
    const channelAfter = await context.merchants.getChannelCapacity(context.channelA);
    expect(merchantAfter.currentUsdc).to.equal(merchantBefore.currentUsdc);
    expect(channelAfter.capacityE6).to.equal(channelBefore.capacityE6);
    expect(await context.token.balanceOf(context.user.address)).to.equal(userBefore);
  });

  it("cancels no-eligible and expired SELL orders with exact escrow handling", async function () {
    const context = await deployProtocol();
    const noEligible = await createOrder(context, context.user, "createSellOrder", 5n * E6, SELL_PRICE);
    await (await context.orders.cancelNoEligibleMerchantOrder(noEligible)).wait();
    expect((await context.orders.getOrder(noEligible)).cancellationReason).to.equal(2n);

    await seedFiat(context, context.merchantA, context.channelA);
    await (await context.token.connect(context.user).approve(context.diamond.target, 5n * E6)).wait();
    const accepted = await createOrder(context, context.user, "createSellOrder", 5n * E6, SELL_PRICE);
    await assign(context, accepted, [{ merchant: context.merchantA.address, channelId: context.channelA }]);
    const userBefore = await context.token.balanceOf(context.user.address);
    await (await context.orders.connect(context.merchantA).acceptOrder(accepted, context.channelA)).wait();
    await increase(PHASE_TIMEOUT + 1);
    await (await context.orders.connect(context.outsider).processExpiredOrder(accepted)).wait();
    expect(await context.token.balanceOf(context.user.address)).to.equal(userBefore);
    expect((await context.merchants.getChannelCapacity(context.channelA)).reservedE6).to.equal(0n);
  });

  it("rejects order creation using a stale executor price", async function () {
    const context = await deployProtocol();
    await increase(10 * 60 + 1);
    await expect(context.orders.connect(context.user).createBuyOrder(1n * E6, BUY_PRICE))
      .to.be.revertedWithCustomError(context.orders, "StalePrice");
  });
});
