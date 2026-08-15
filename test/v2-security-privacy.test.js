const { expect } = require("chai");
const { artifacts, ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const {
  E6,
  OrderStatus,
  OrderType,
  assignOrder,
  createOrder,
  deployV2,
  publishRound,
  setupMerchant,
} = require("./helpers/v2-fixture");

async function marketFixture() {
  const fixture = await deployV2();
  await publishRound(fixture);
  fixture.first = await setupMerchant(fixture, fixture.merchantOne);
  fixture.second = await setupMerchant(fixture, fixture.merchantTwo);
  return fixture;
}

describe("v2 adversarial token and reentrancy safety", function () {
  it("rolls back accounting when an ERC20 returns false", async function () {
    const token = await ethers.deployContract("BadReturnERC20");
    const fixture = await deployV2({ usdc: token });
    const stake = 100n * E6;
    await token.mint(fixture.other.address, stake);
    await token.connect(fixture.other).approve(fixture.diamondAddress, stake);
    await expect(fixture.merchants.connect(fixture.other).registerMerchant(stake)).to.be.reverted;
    expect(await token.balanceOf(fixture.diamondAddress)).to.equal(0n);
    expect((await fixture.config.getCustodyTotals()).totalMerchantStakeUsdc).to.equal(0n);
    await expect(fixture.merchants.getMerchant(fixture.other.address))
      .to.be.revertedWithCustomError(fixture.merchants, "MerchantNotFound");
  });

  it("rejects inbound fee-on-transfer atoms and rolls all writes back", async function () {
    const token = await ethers.deployContract("FeeOnTransferERC20");
    const fixture = await deployV2({ usdc: token });
    const stake = 100n * E6;
    await token.mint(fixture.other.address, stake);
    await token.connect(fixture.other).approve(fixture.diamondAddress, stake);
    await expect(fixture.merchants.connect(fixture.other).registerMerchant(stake))
      .to.be.revertedWithCustomError(fixture.merchants, "InboundBalanceMismatch");
    expect(await token.balanceOf(fixture.other.address)).to.equal(stake);
    expect(await token.balanceOf(fixture.diamondAddress)).to.equal(0n);
    expect((await fixture.config.getCustodyTotals()).totalMerchantStakeUsdc).to.equal(0n);
  });

  it("rejects outbound fee behavior and restores token plus ledger state", async function () {
    const token = await ethers.deployContract("FeeOnTransferERC20");
    await token.setFeeModes(true, false);
    const fixture = await deployV2({ usdc: token });
    await publishRound(fixture);
    const setup = await setupMerchant(fixture, fixture.merchantOne);
    const diamondBefore = await token.balanceOf(fixture.diamondAddress);
    const merchantBefore = await token.balanceOf(fixture.merchantOne.address);
    await expect(fixture.merchants.connect(fixture.merchantOne).withdrawLiquidity(E6))
      .to.be.revertedWithCustomError(fixture.merchants, "OutboundBalanceMismatch");
    expect(await token.balanceOf(fixture.diamondAddress)).to.equal(diamondBefore);
    expect(await token.balanceOf(fixture.merchantOne.address)).to.equal(merchantBefore);
    expect((await fixture.merchants.getMerchant(fixture.merchantOne.address)).liquidityUsdc)
      .to.equal(setup.liquidity);
    expect((await fixture.config.getCustodyTotals()).totalMerchantLiquidityUsdc)
      .to.equal(setup.liquidity);
  });

  it("uses one namespaced lock across facet callbacks for inbound and outbound transfers", async function () {
    const token = await ethers.deployContract("ReentrantMaliciousERC20");
    const fixture = await deployV2({ usdc: token });
    const attacker = await ethers.deployContract("ReentrancyAttacker", [
      fixture.diamondAddress,
      await token.getAddress(),
    ]);
    const attackerAddress = await attacker.getAddress();
    const stake = 100n * E6;
    await token.mint(attackerAddress, stake);
    await attacker.approveDiamond();
    const crossFacetCall = fixture.orders.interface.encodeFunctionData("createBuyOrder", [
      1, 0, 1, ethers.MaxUint256,
    ]);
    await attacker.setReentryCalldata(crossFacetCall);
    await token.setCallee(attackerAddress);
    const register = fixture.merchants.interface.encodeFunctionData("registerMerchant", [stake]);
    await expect(attacker.callDiamond(register))
      .to.be.revertedWithCustomError(fixture.merchants, "ReentrantCall");
    expect(await token.balanceOf(fixture.diamondAddress)).to.equal(0n);
    expect((await fixture.config.getCustodyTotals()).totalMerchantStakeUsdc).to.equal(0n);

    await token.setCallee(ethers.ZeroAddress);
    await attacker.callDiamond(register);
    const requestExit = fixture.merchants.interface.encodeFunctionData("requestMerchantExit");
    await attacker.callDiamond(requestExit);
    await token.setCallee(attackerAddress);
    const withdrawStake = fixture.merchants.interface.encodeFunctionData("withdrawStake");
    await expect(attacker.callDiamond(withdrawStake))
      .to.be.revertedWithCustomError(fixture.orders, "ReentrantCall");
    expect(await token.balanceOf(fixture.diamondAddress)).to.equal(stake);
    expect((await fixture.merchants.getMerchant(attackerAddress)).stakeUsdc).to.equal(stake);
    expect((await fixture.config.getCustodyTotals()).totalMerchantStakeUsdc).to.equal(stake);
  });
});

describe("v2 bounded reads, opaque data, and invariant-oriented sequences", function () {
  it("paginates all growing projections with a hard 100-item bound", async function () {
    const fixture = await loadFixture(marketFixture);
    const firstOrder = await createOrder(fixture, OrderType.BUY, E6);
    const secondOrder = await createOrder(fixture, OrderType.SELL, E6);
    await assignOrder(fixture, firstOrder.orderId, [{
      merchant: fixture.merchantOne.address,
      channelId: fixture.first.channelId,
    }], "merchant-index");
    await fixture.orders.connect(fixture.merchantOne).acceptOrder(firstOrder.orderId, fixture.first.channelId);

    const merchantPage1 = await fixture.merchants.getMerchantPage(0, 1);
    const merchantPage2 = await fixture.merchants.getMerchantPage(merchantPage1.nextCursor, 1);
    expect(merchantPage1.items).to.have.length(1);
    expect(merchantPage2.items).to.have.length(1);
    expect(merchantPage2.nextCursor).to.equal(2n);
    const orderPage1 = await fixture.orders.getOrderIdPage(0, 1);
    const orderPage2 = await fixture.orders.getOrderIdPage(orderPage1.nextCursor, 1);
    expect(orderPage1.items[0]).to.equal(firstOrder.orderId);
    expect(orderPage2.items[0]).to.equal(secondOrder.orderId);
    expect((await fixture.orders.getUserOrderIdPage(fixture.user.address, 0, 100)).items)
      .to.have.length(2);
    expect((await fixture.orders.getMerchantOrderIdPage(fixture.merchantOne.address, 0, 100)).items)
      .to.deep.equal([firstOrder.orderId]);
    expect((await fixture.merchants.getMerchantChannelPage(fixture.merchantOne.address, 0, 100)).items)
      .to.have.length(1);

    await expect(fixture.merchants.getMerchantPage(0, 0))
      .to.be.revertedWithCustomError(fixture.merchants, "PageLimitInvalid");
    await expect(fixture.merchants.getMerchantChannelPage(fixture.merchantOne.address, 0, 101))
      .to.be.revertedWithCustomError(fixture.merchants, "PageLimitInvalid");
    await expect(fixture.orders.getOrderIdPage(0, 101))
      .to.be.revertedWithCustomError(fixture.orders, "PageLimitInvalid");
    await expect(fixture.orders.getUserOrderIdPage(fixture.user.address, 0, 0))
      .to.be.revertedWithCustomError(fixture.orders, "PageLimitInvalid");
  });

  it("exposes only static opaque public fields and removes every legacy selector", async function () {
    const facetNames = [
      "AccessControlFacet", "ConfigFacet", "PricingFacet", "MerchantFacet",
      "AssignmentFacet", "OrderFacet", "DisputeFacet",
    ];
    const combined = [];
    for (const name of facetNames) combined.push(...(await artifacts.readArtifact(name)).abi);
    const surface = JSON.stringify(combined);
    for (const legacy of [
      "addPaymentChannel", "confirmPayment", "getAllMerchants", "getPendingChannels",
      "getUserOrders", "markPaymentSent", "setOrderPricing", "telegram", "bankDetails",
      "upiId", "kyc", "notificationToken", "paymentReference", "dailyLimit", "monthlyLimit",
      "rollingVolume",
    ]) {
      expect(surface.toLowerCase()).not.to.include(legacy.toLowerCase());
    }
    for (const item of combined) {
      if (item.type !== "function" && item.type !== "event") continue;
      const parameters = [...(item.inputs ?? []), ...(item.outputs ?? [])];
      expect(parameters.some((parameter) => parameter.type === "string" || parameter.type === "bytes"))
        .to.equal(false, `${item.type} ${item.name} exposes dynamic plaintext`);
    }
  });

  it("keeps zero/uninitialized identifiers hidden and creates unique receipt-decodable IDs without matching", async function () {
    const fixture = await loadFixture(marketFixture);
    await expect(fixture.merchants.getMerchant(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(fixture.merchants, "MerchantNotFound");
    await expect(fixture.merchants.getChannel(ethers.ZeroHash))
      .to.be.revertedWithCustomError(fixture.merchants, "ChannelNotFound");
    await expect(fixture.orders.getOrder(ethers.ZeroHash))
      .to.be.revertedWithCustomError(fixture.orders, "OrderNotFound");

    const first = await createOrder(fixture, OrderType.BUY, E6);
    const second = await createOrder(fixture, OrderType.BUY, E6);
    expect(first.orderId).not.to.equal(ethers.ZeroHash);
    expect(second.orderId).not.to.equal(first.orderId);
    expect(first.created.args.orderNumber).to.equal(1n);
    expect(second.created.args.orderNumber).to.equal(2n);
    expect((await fixture.orders.getOrder(first.orderId)).status).to.equal(OrderStatus.CREATED);
    expect((await fixture.assignments.getAssignment(first.orderId)).candidates).to.have.length(0);
    expect(fixture.first.channelId).not.to.equal(fixture.second.channelId);
  });

  it("conserves aggregate and per-channel obligations after a mixed multi-order sequence", async function () {
    const fixture = await loadFixture(marketFixture);
    const actions = [OrderType.BUY, OrderType.SELL, OrderType.BUY, OrderType.SELL];
    for (let index = 0; index < actions.length; index += 1) {
      const kind = actions[index];
      const order = await createOrder(fixture, kind, BigInt(index + 1) * E6);
      if (index === 2) {
        await fixture.orders.connect(fixture.user).cancelOrder(order.orderId);
      } else {
        await assignOrder(fixture, order.orderId, [{
          merchant: fixture.merchantOne.address,
          channelId: fixture.first.channelId,
        }], `mixed-${index}`);
        await fixture.orders.connect(fixture.merchantOne).acceptOrder(order.orderId, fixture.first.channelId);
        if (index === 3) {
          await fixture.disputes.connect(fixture.user).openDispute(order.orderId);
          await fixture.disputes.connect(fixture.disputeResolver).resolveDispute(
            order.orderId, 0,
          );
        } else {
          const payer = kind === OrderType.BUY ? fixture.user : fixture.merchantOne;
          const receiver = kind === OrderType.BUY ? fixture.merchantOne : fixture.user;
          await fixture.orders.connect(payer).markFiatSent(order.orderId);
          await fixture.orders.connect(receiver).confirmFiatReceived(order.orderId);
        }
      }

      const totals = await fixture.config.getCustodyTotals();
      const merchant = await fixture.merchants.getMerchant(fixture.merchantOne.address);
      const channel = await fixture.merchants.getChannel(fixture.first.channelId);
      const tokenBalance = await fixture.usdc.balanceOf(fixture.diamondAddress);
      expect(tokenBalance).to.be.gte(
        totals.totalMerchantStakeUsdc + totals.totalMerchantLiquidityUsdc + totals.totalSellEscrowUsdc,
      );
      expect(merchant.reservedUsdc + merchant.disputeLockedUsdc).to.be.lte(merchant.liquidityUsdc);
      expect(merchant.reservedFiatE6).to.equal(channel.reservedFiatE6);
      expect(merchant.obligationCount).to.equal(channel.obligationCount);
    }
  });
});
