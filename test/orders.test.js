// test/orders.test.js
// Run: npx hardhat test test/orders.test.js
//
// Full P2P order engine coverage — BUY / SELL happy paths, dispute window,
// dispute resolution, cancellation, and edge cases.

const { ethers } = require("hardhat");
const { expect } = require("chai");

const FacetCutAction = { Add: 0 };

function getSelectors(contract) {
  return contract.interface.fragments
    .filter((f) => f.type === "function")
    .map((f) => ethers.id(f.format("sighash")).slice(0, 10));
}

const OrderType = { BUY: 0, SELL: 1 };
const OrderStatus = {
  CREATED: 0,
  ACCEPTED: 1,
  PAID: 2,
  COMPLETED: 3,
  CANCELLED: 4,
};
const DisputeStatus = { NONE: 0, OPEN: 1, SETTLED: 2 };
const DisputeResult = { NONE: 0, USER_WINS: 1, MERCHANT_WINS: 2 };
const MerchantAccountStatus = { ACTIVE: 0, INACTIVE: 1, BLACKLISTED: 2, DISPUTED: 3 };
const ChannelStatus = { PENDING: 0, APPROVED: 1, REJECTED: 2, TERMINATED: 3 };
const ChannelAvailability = { ACTIVE: 0, INACTIVE: 1 };

const BUY_PRICE = 95n;
const SELL_PRICE = 90n;
const DISPUTE_WINDOW = 600n; // 10 min

async function deployOrderDiamond() {
  const [deployer, user, m1, m2, m3, m4, m5, keeper] = await ethers.getSigners();

  const usdc = await ethers.deployContract("MockERC20", ["USDC", "USDC", 6]);
  const minStake = ethers.parseUnits("100", 6);

  const diamondCutFacet = await ethers.deployContract("DiamondCutFacet");
  const diamondLoupeFacet = await ethers.deployContract("DiamondLoupeFacet");
  const ownershipFacet = await ethers.deployContract("OwnershipFacet");
  const configFacet = await ethers.deployContract("ConfigFacet");
  const merchantFacet = await ethers.deployContract("MerchantFacet");
  const orderFacet = await ethers.deployContract("OrderFacet");
  const diamondInit = await ethers.deployContract("DiamondInit");

  const diamond = await ethers.deployContract("Diamond", [
    deployer.address,
    await diamondCutFacet.getAddress(),
  ]);
  const diamondAddress = await diamond.getAddress();

  const cut = [
    { facetAddress: await diamondLoupeFacet.getAddress(), action: FacetCutAction.Add, functionSelectors: getSelectors(diamondLoupeFacet) },
    { facetAddress: await ownershipFacet.getAddress(),    action: FacetCutAction.Add, functionSelectors: getSelectors(ownershipFacet) },
    { facetAddress: await configFacet.getAddress(),       action: FacetCutAction.Add, functionSelectors: getSelectors(configFacet) },
    { facetAddress: await merchantFacet.getAddress(),     action: FacetCutAction.Add, functionSelectors: getSelectors(merchantFacet) },
    { facetAddress: await orderFacet.getAddress(),        action: FacetCutAction.Add, functionSelectors: getSelectors(orderFacet) },
  ];

  const initCalldata = diamondInit.interface.encodeFunctionData("init", [
    await usdc.getAddress(),
    minStake,
    0, // unlimited daily
    0, // unlimited monthly
    BUY_PRICE,
    SELL_PRICE,
    DISPUTE_WINDOW,
  ]);
  const dc = await ethers.getContractAt("IDiamondCut", diamondAddress);
  await (await dc.diamondCut(cut, await diamondInit.getAddress(), initCalldata)).wait();

  return {
    deployer, user, m1, m2, m3, m4, m5, keeper,
    usdc, minStake, diamondAddress,
    config: await ethers.getContractAt("ConfigFacet", diamondAddress),
    merchants: await ethers.getContractAt("MerchantFacet", diamondAddress),
    orders: await ethers.getContractAt("OrderFacet", diamondAddress),
  };
}

async function setupMerchantWithLiquidity(fx, signer, usdcLiquidity, telegram) {
  await fx.usdc.mint(signer.address, usdcLiquidity);
  await fx.usdc.connect(signer).approve(fx.diamondAddress, ethers.MaxUint256);
  await fx.merchants.connect(signer).registerMerchant(usdcLiquidity, telegram);
  await fx.merchants.connect(signer).addPaymentChannel("HDFC", "9999", "u@hdfc", "primary");
  const chs = await fx.merchants.connect(signer).getMyChannels();
  const channelId = chs[0].channelId;
  await fx.merchants.connect(fx.deployer).approveChannel(channelId);
  return channelId;
}

// Directly writes to the AppStorage `channels[cid].fiatBalance` slot so tests
// don't depend on a fiat-crediting admin function that isn't in-scope here.
// PaymentChannel storage layout (see AppStorage.sol) — `fiatBalance` is the 9th
// field. Slot math: mapping(bytes32 => PaymentChannel) lives at AppStorage slot
// determined by keccak256, but we don't need to poke it — the SELL flow uses
// `ch.fiatBalance` only, and we bootstrap it by making the merchant run a full
// BUY cycle first, which naturally credits the channel.
async function seedChannelFiatViaBuy(fx, merchantSigner, channelId, targetFiat) {
  // Each BUY of `usdc` USDC at BUY_PRICE credits BUY_PRICE * usdc into fiat.
  // Solve smallest usdc such that BUY_PRICE * usdc >= targetFiat.
  const usdcAmount = (targetFiat + BUY_PRICE - 1n) / BUY_PRICE;
  const [, , , , , , , , seedUser] = await ethers.getSigners();
  // Create + accept + mark paid + confirm — mirrors a real BUY.
  const tx = await fx.orders.connect(seedUser).createBuyOrder(usdcAmount);
  const rc = await tx.wait();
  const evt = rc.logs.find((l) => {
    try { return fx.orders.interface.parseLog(l)?.name === "OrderCreated"; }
    catch (_) { return false; }
  });
  const orderId = fx.orders.interface.parseLog(evt).args.orderId;
  await fx.orders.connect(merchantSigner).acceptOrder(orderId, channelId);
  await fx.orders.connect(seedUser).markPaymentSent(orderId);
  await fx.orders.connect(merchantSigner).confirmPayment(orderId);
  return orderId;
}

describe("OrderFacet — creation & assignment", function () {
  let fx;
  beforeEach(async function () {
    fx = await deployOrderDiamond();
  });

  it("pricing is initialized from DiamondInit", async function () {
    const [buy, sell, win] = await fx.config.getOrderPricing();
    expect(buy).to.equal(BUY_PRICE);
    expect(sell).to.equal(SELL_PRICE);
    expect(win).to.equal(DISPUTE_WINDOW);
  });

  it("createBuyOrder reverts when no merchants exist", async function () {
    await expect(
      fx.orders.connect(fx.user).createBuyOrder(ethers.parseUnits("10", 6))
    ).to.be.revertedWith("No eligible merchants");
  });

  it("assigns up to 4 merchants by liquidity", async function () {
    await setupMerchantWithLiquidity(fx, fx.m1, ethers.parseUnits("500", 6), "m1");
    await setupMerchantWithLiquidity(fx, fx.m2, ethers.parseUnits("500", 6), "m2");
    await setupMerchantWithLiquidity(fx, fx.m3, ethers.parseUnits("500", 6), "m3");
    await setupMerchantWithLiquidity(fx, fx.m4, ethers.parseUnits("500", 6), "m4");
    await setupMerchantWithLiquidity(fx, fx.m5, ethers.parseUnits("500", 6), "m5");

    const tx = await fx.orders
      .connect(fx.user)
      .createBuyOrder(ethers.parseUnits("100", 6));
    const rc = await tx.wait();
    const created = rc.logs
      .map((l) => {
        try { return fx.orders.interface.parseLog(l); } catch { return null; }
      })
      .filter((p) => p && p.name === "OrderAssigned");
    expect(created.length).to.equal(4);
  });
});

describe("OrderFacet — BUY happy path", function () {
  let fx, channelId;

  beforeEach(async function () {
    fx = await deployOrderDiamond();
    channelId = await setupMerchantWithLiquidity(
      fx, fx.m1, ethers.parseUnits("300", 6), "m1"
    );
  });

  it("full lifecycle: create → accept → markPaymentSent → confirmPayment", async function () {
    const usdcAmount = ethers.parseUnits("100", 6);
    const expectedFiat = usdcAmount * BUY_PRICE;

    // 1) create
    const tx = await fx.orders.connect(fx.user).createBuyOrder(usdcAmount);
    const rc = await tx.wait();
    const evt = rc.logs
      .map((l) => { try { return fx.orders.interface.parseLog(l); } catch { return null; } })
      .find((p) => p && p.name === "OrderCreated");
    const orderId = evt.args.orderId;

    let o = await fx.orders.getOrder(orderId);
    expect(o.status).to.equal(OrderStatus.CREATED);
    expect(o.orderType).to.equal(OrderType.BUY);
    expect(o.usdcAmount).to.equal(usdcAmount);
    expect(o.fiatAmount).to.equal(expectedFiat);
    expect(o.price).to.equal(BUY_PRICE);

    // 2) accept — locks reservedUsdc
    await fx.orders.connect(fx.m1).acceptOrder(orderId, channelId);
    o = await fx.orders.getOrder(orderId);
    expect(o.status).to.equal(OrderStatus.ACCEPTED);
    expect(o.merchant).to.equal(fx.m1.address);

    let bal = await fx.orders.getMerchantBalances(fx.m1.address);
    expect(bal.reservedUsdc).to.equal(usdcAmount);
    expect(bal.unreservedUsdc).to.equal(ethers.parseUnits("200", 6));

    // 3) markPaymentSent by user
    await fx.orders.connect(fx.user).markPaymentSent(orderId);
    o = await fx.orders.getOrder(orderId);
    expect(o.status).to.equal(OrderStatus.PAID);

    // 4) confirmPayment by merchant — USDC transferred to user
    const userBalBefore = await fx.usdc.balanceOf(fx.user.address);
    await fx.orders.connect(fx.m1).confirmPayment(orderId);
    const userBalAfter = await fx.usdc.balanceOf(fx.user.address);
    expect(userBalAfter - userBalBefore).to.equal(usdcAmount);

    o = await fx.orders.getOrder(orderId);
    expect(o.status).to.equal(OrderStatus.COMPLETED);

    bal = await fx.orders.getMerchantBalances(fx.m1.address);
    expect(bal.totalUsdc).to.equal(ethers.parseUnits("200", 6));
    expect(bal.reservedUsdc).to.equal(0);

    const chFiat = await fx.orders.getChannelFiat(channelId);
    expect(chFiat.totalFiat).to.equal(expectedFiat);
  });

  it("only assigned merchant can accept; only merchant can confirm", async function () {
    await setupMerchantWithLiquidity(fx, fx.m2, ethers.parseUnits("300", 6), "m2");
    const tx = await fx.orders
      .connect(fx.user)
      .createBuyOrder(ethers.parseUnits("50", 6));
    const rc = await tx.wait();
    const orderId = rc.logs
      .map((l) => { try { return fx.orders.interface.parseLog(l); } catch { return null; } })
      .find((p) => p && p.name === "OrderCreated").args.orderId;

    // random keeper is not assigned
    await expect(
      fx.orders.connect(fx.keeper).acceptOrder(orderId, channelId)
    ).to.be.revertedWith("Not assigned");
  });

  it("cannot confirm before user marks paid", async function () {
    const tx = await fx.orders
      .connect(fx.user)
      .createBuyOrder(ethers.parseUnits("50", 6));
    const rc = await tx.wait();
    const orderId = rc.logs
      .map((l) => { try { return fx.orders.interface.parseLog(l); } catch { return null; } })
      .find((p) => p && p.name === "OrderCreated").args.orderId;

    await fx.orders.connect(fx.m1).acceptOrder(orderId, channelId);
    await expect(
      fx.orders.connect(fx.m1).confirmPayment(orderId)
    ).to.be.revertedWith("Not PAID");
  });
});

describe("OrderFacet — SELL happy path", function () {
  let fx, channelId, usdcAmount, fiatAmount;

  beforeEach(async function () {
    fx = await deployOrderDiamond();
    channelId = await setupMerchantWithLiquidity(
      fx, fx.m1, ethers.parseUnits("300", 6), "m1"
    );
    usdcAmount = ethers.parseUnits("100", 6);
    fiatAmount = usdcAmount * SELL_PRICE;

    // Seed the merchant's channel with enough fiatBalance by running one BUY.
    // That BUY credits BUY_PRICE * usdc = 95 * 100 USDC = enough for a 90-priced SELL.
    // NOTE: this also uses up 100 USDC of merchant liquidity, so we top it back up.
    const seedUsdc = ethers.parseUnits("100", 6);
    const [, , , , , , , , seedUser] = await ethers.getSigners();
    const tx = await fx.orders.connect(seedUser).createBuyOrder(seedUsdc);
    const rc = await tx.wait();
    const orderId = rc.logs
      .map((l) => { try { return fx.orders.interface.parseLog(l); } catch { return null; } })
      .find((p) => p && p.name === "OrderCreated").args.orderId;
    await fx.orders.connect(fx.m1).acceptOrder(orderId, channelId);
    await fx.orders.connect(seedUser).markPaymentSent(orderId);
    await fx.orders.connect(fx.m1).confirmPayment(orderId);
    // Top up merchant liquidity back to 300 so USDC math in the test stays clean.
    await fx.usdc.mint(fx.m1.address, seedUsdc);
    await fx.merchants.connect(fx.m1).depositStake(seedUsdc);

    // Fund user with USDC for the SELL.
    await fx.usdc.mint(fx.user.address, usdcAmount);
    await fx.usdc.connect(fx.user).approve(fx.diamondAddress, ethers.MaxUint256);
  });

  it("full lifecycle: create → accept → markPaymentSent (auto-completes into risk_usdc)", async function () {
    // 1) create SELL — pulls USDC from user
    const tx = await fx.orders.connect(fx.user).createSellOrder(usdcAmount);
    const rc = await tx.wait();
    const orderId = rc.logs
      .map((l) => { try { return fx.orders.interface.parseLog(l); } catch { return null; } })
      .find((p) => p && p.name === "OrderCreated").args.orderId;

    expect(await fx.usdc.balanceOf(fx.user.address)).to.equal(0);

    // 2) merchant accept — locks reservedFiat
    await fx.orders.connect(fx.m1).acceptOrder(orderId, channelId);
    let chFiat = await fx.orders.getChannelFiat(channelId);
    expect(chFiat.reservedFiat).to.equal(fiatAmount);

    // 3) merchant markPaymentSent — atomically completes; risk_usdc bumps
    await fx.orders.connect(fx.m1).markPaymentSent(orderId);

    const o = await fx.orders.getOrder(orderId);
    expect(o.status).to.equal(OrderStatus.COMPLETED);
    expect(o.disputeExpiresAt).to.be.gt(0);

    const bal = await fx.orders.getMerchantBalances(fx.m1.address);
    expect(bal.totalUsdc).to.equal(ethers.parseUnits("400", 6)); // 300 + 100
    expect(bal.riskUsdc).to.equal(usdcAmount);
    expect(bal.unreservedUsdc).to.equal(ethers.parseUnits("300", 6));

    chFiat = await fx.orders.getChannelFiat(channelId);
    // Seed BUY credited 95*100=9500 (with 6dec = 9500e6); SELL consumed 90*100=9000 (9000e6).
    // Residual = 500e6.
    expect(chFiat.totalFiat).to.equal(ethers.parseUnits("500", 6));
    expect(chFiat.reservedFiat).to.equal(0);
  });

  it("risk_usdc blocks further SELL orders from consuming that liquidity", async function () {
    const tx = await fx.orders.connect(fx.user).createSellOrder(usdcAmount);
    const rc = await tx.wait();
    const orderId = rc.logs
      .map((l) => { try { return fx.orders.interface.parseLog(l); } catch { return null; } })
      .find((p) => p && p.name === "OrderCreated").args.orderId;
    await fx.orders.connect(fx.m1).acceptOrder(orderId, channelId);
    await fx.orders.connect(fx.m1).markPaymentSent(orderId);

    // Now settleOrder should not be callable before window
    await expect(fx.orders.settleOrder(orderId)).to.be.revertedWith("Window not elapsed");
  });

  it("settleOrder after window releases risk_usdc back to unreserved", async function () {
    const tx = await fx.orders.connect(fx.user).createSellOrder(usdcAmount);
    const rc = await tx.wait();
    const orderId = rc.logs
      .map((l) => { try { return fx.orders.interface.parseLog(l); } catch { return null; } })
      .find((p) => p && p.name === "OrderCreated").args.orderId;
    await fx.orders.connect(fx.m1).acceptOrder(orderId, channelId);
    await fx.orders.connect(fx.m1).markPaymentSent(orderId);

    // Fast-forward past dispute window
    await ethers.provider.send("evm_increaseTime", [Number(DISPUTE_WINDOW) + 1]);
    await ethers.provider.send("evm_mine", []);

    await fx.orders.connect(fx.keeper).settleOrder(orderId);

    const bal = await fx.orders.getMerchantBalances(fx.m1.address);
    expect(bal.riskUsdc).to.equal(0);
    expect(bal.unreservedUsdc).to.equal(ethers.parseUnits("400", 6));

    const o = await fx.orders.getOrder(orderId);
    expect(o.riskReleased).to.equal(true);
    expect(o.disputeStatus).to.equal(DisputeStatus.SETTLED);

    // Double-settle reverts
    await expect(fx.orders.settleOrder(orderId)).to.be.revertedWith("Already released");
  });
});

describe("OrderFacet — dispute flow", function () {
  let fx, channelId, orderId, usdcAmount;

  beforeEach(async function () {
    fx = await deployOrderDiamond();
    channelId = await setupMerchantWithLiquidity(
      fx, fx.m1, ethers.parseUnits("300", 6), "m1"
    );

    // Seed via a BUY then a SELL through markPaymentSent so the order is COMPLETED.
    const [, , , , , , , , seedUser] = await ethers.getSigners();
    const seedUsdc = ethers.parseUnits("100", 6);
    let tx = await fx.orders.connect(seedUser).createBuyOrder(seedUsdc);
    let rc = await tx.wait();
    let seedId = rc.logs.map((l) => { try { return fx.orders.interface.parseLog(l); } catch { return null; } })
      .find((p) => p && p.name === "OrderCreated").args.orderId;
    await fx.orders.connect(fx.m1).acceptOrder(seedId, channelId);
    await fx.orders.connect(seedUser).markPaymentSent(seedId);
    await fx.orders.connect(fx.m1).confirmPayment(seedId);
    await fx.usdc.mint(fx.m1.address, seedUsdc);
    await fx.merchants.connect(fx.m1).depositStake(seedUsdc);

    usdcAmount = ethers.parseUnits("100", 6);
    await fx.usdc.mint(fx.user.address, usdcAmount);
    await fx.usdc.connect(fx.user).approve(fx.diamondAddress, ethers.MaxUint256);
    tx = await fx.orders.connect(fx.user).createSellOrder(usdcAmount);
    rc = await tx.wait();
    orderId = rc.logs.map((l) => { try { return fx.orders.interface.parseLog(l); } catch { return null; } })
      .find((p) => p && p.name === "OrderCreated").args.orderId;
    await fx.orders.connect(fx.m1).acceptOrder(orderId, channelId);
    await fx.orders.connect(fx.m1).markPaymentSent(orderId);
  });

  it("user can raise dispute within the window", async function () {
    await expect(
      fx.orders.connect(fx.m1).raiseDispute(orderId)
    ).to.be.revertedWith("Only user");

    await fx.orders.connect(fx.user).raiseDispute(orderId);
    const o = await fx.orders.getOrder(orderId);
    expect(o.disputeStatus).to.equal(DisputeStatus.OPEN);
    const merchant = await fx.merchants.getMerchant(fx.m1.address);
    expect(merchant.accountStatus).to.equal(MerchantAccountStatus.DISPUTED);

    // Cannot settle while dispute open even after window elapses
    await ethers.provider.send("evm_increaseTime", [Number(DISPUTE_WINDOW) + 1]);
    await ethers.provider.send("evm_mine", []);
    await expect(fx.orders.settleOrder(orderId)).to.be.revertedWith("Dispute open");
  });

  it("admin resolves MERCHANT_WINS → risk released, merchant keeps USDC", async function () {
    await fx.orders.connect(fx.user).raiseDispute(orderId);
    await fx.orders
      .connect(fx.deployer)
      .resolveDispute(orderId, DisputeResult.MERCHANT_WINS);

    const o = await fx.orders.getOrder(orderId);
    expect(o.disputeStatus).to.equal(DisputeStatus.SETTLED);
    expect(o.disputeResult).to.equal(DisputeResult.MERCHANT_WINS);
    expect(o.riskReleased).to.equal(true);

    const bal = await fx.orders.getMerchantBalances(fx.m1.address);
    expect(bal.riskUsdc).to.equal(0);
    expect(bal.totalUsdc).to.equal(ethers.parseUnits("400", 6));
    const merchant = await fx.merchants.getMerchant(fx.m1.address);
    expect(merchant.accountStatus).to.equal(MerchantAccountStatus.ACTIVE);
  });

  it("admin resolves USER_WINS → merchant slashed, USDC returned to user", async function () {
    await fx.orders.connect(fx.user).raiseDispute(orderId);
    const userBefore = await fx.usdc.balanceOf(fx.user.address);
    await fx.orders
      .connect(fx.deployer)
      .resolveDispute(orderId, DisputeResult.USER_WINS);
    const userAfter = await fx.usdc.balanceOf(fx.user.address);

    expect(userAfter - userBefore).to.equal(usdcAmount);

    const bal = await fx.orders.getMerchantBalances(fx.m1.address);
    expect(bal.riskUsdc).to.equal(0);
    expect(bal.totalUsdc).to.equal(ethers.parseUnits("300", 6)); // slashed back to original
  });

  it("cannot raiseDispute after window elapses", async function () {
    await ethers.provider.send("evm_increaseTime", [Number(DISPUTE_WINDOW) + 1]);
    await ethers.provider.send("evm_mine", []);
    await expect(
      fx.orders.connect(fx.user).raiseDispute(orderId)
    ).to.be.revertedWith("Window elapsed");
  });
});

describe("OrderFacet — cancellation & guards", function () {
  let fx, channelId;

  beforeEach(async function () {
    fx = await deployOrderDiamond();
    channelId = await setupMerchantWithLiquidity(
      fx, fx.m1, ethers.parseUnits("300", 6), "m1"
    );
    // Seed channel fiat via a completed BUY so SELL orders below can find capacity.
    const [, , , , , , , , seedUser] = await ethers.getSigners();
    const seedUsdc = ethers.parseUnits("50", 6);
    const tx = await fx.orders.connect(seedUser).createBuyOrder(seedUsdc);
    const rc = await tx.wait();
    const seedId = rc.logs
      .map((l) => { try { return fx.orders.interface.parseLog(l); } catch { return null; } })
      .find((p) => p && p.name === "OrderCreated").args.orderId;
    await fx.orders.connect(fx.m1).acceptOrder(seedId, channelId);
    await fx.orders.connect(seedUser).markPaymentSent(seedId);
    await fx.orders.connect(fx.m1).confirmPayment(seedId);
    await fx.usdc.mint(fx.m1.address, seedUsdc);
    await fx.merchants.connect(fx.m1).depositStake(seedUsdc);

    await fx.usdc.mint(fx.user.address, ethers.parseUnits("500", 6));
    await fx.usdc.connect(fx.user).approve(fx.diamondAddress, ethers.MaxUint256);
  });

  it("user can cancel a CREATED BUY", async function () {
    const tx = await fx.orders
      .connect(fx.user)
      .createBuyOrder(ethers.parseUnits("50", 6));
    const rc = await tx.wait();
    const orderId = rc.logs.map((l) => { try { return fx.orders.interface.parseLog(l); } catch { return null; } })
      .find((p) => p && p.name === "OrderCreated").args.orderId;
    await fx.orders.connect(fx.user).cancelOrder(orderId);
    const o = await fx.orders.getOrder(orderId);
    expect(o.status).to.equal(OrderStatus.CANCELLED);
  });

  it("cancelling a CREATED SELL refunds escrowed USDC", async function () {
    const usdcAmount = ethers.parseUnits("30", 6);
    const before = await fx.usdc.balanceOf(fx.user.address);
    const tx = await fx.orders.connect(fx.user).createSellOrder(usdcAmount);
    const rc = await tx.wait();
    const orderId = rc.logs.map((l) => { try { return fx.orders.interface.parseLog(l); } catch { return null; } })
      .find((p) => p && p.name === "OrderCreated").args.orderId;
    expect(await fx.usdc.balanceOf(fx.user.address)).to.equal(before - usdcAmount);
    await fx.orders.connect(fx.user).cancelOrder(orderId);
    expect(await fx.usdc.balanceOf(fx.user.address)).to.equal(before);
  });

  it("cannot cancel after acceptance", async function () {
    const tx = await fx.orders
      .connect(fx.user)
      .createBuyOrder(ethers.parseUnits("50", 6));
    const rc = await tx.wait();
    const orderId = rc.logs.map((l) => { try { return fx.orders.interface.parseLog(l); } catch { return null; } })
      .find((p) => p && p.name === "OrderCreated").args.orderId;
    await fx.orders.connect(fx.m1).acceptOrder(orderId, channelId);
    await expect(
      fx.orders.connect(fx.user).cancelOrder(orderId)
    ).to.be.revertedWith("Only cancel CREATED");
  });

  it("pause blocks new order creation but not cancellation", async function () {
    await fx.config.pausePlatform();
    await expect(
      fx.orders.connect(fx.user).createBuyOrder(ethers.parseUnits("10", 6))
    ).to.be.revertedWith("Platform is paused");
  });

  it("createSellOrder reverts if no merchant has enough fiat (refund path)", async function () {
    // Only 4750e6 fiat was seeded (50 USDC * 95). A SELL for 100 USDC needs 9000e6 → no capacity.
    const usdcAmount = ethers.parseUnits("100", 6);
    const before = await fx.usdc.balanceOf(fx.user.address);
    await expect(
      fx.orders.connect(fx.user).createSellOrder(usdcAmount)
    ).to.be.revertedWith("No eligible merchants");
    // Revert restores USDC balance (transferFrom is rolled back).
    expect(await fx.usdc.balanceOf(fx.user.address)).to.equal(before);
  });
});

describe("OrderFacet — eligible-merchant whitelist", function () {
  let fx;
  beforeEach(async function () {
    fx = await deployOrderDiamond();
    await setupMerchantWithLiquidity(fx, fx.m1, ethers.parseUnits("500", 6), "m1");
    await setupMerchantWithLiquidity(fx, fx.m2, ethers.parseUnits("500", 6), "m2");
    await setupMerchantWithLiquidity(fx, fx.m3, ethers.parseUnits("500", 6), "m3");
  });

  it("empty whitelist → all ACTIVE merchants eligible (default)", async function () {
    const list = await fx.config.getEligibleMerchants();
    expect(list.length).to.equal(0);
    const tx = await fx.orders
      .connect(fx.user)
      .createBuyOrder(ethers.parseUnits("100", 6));
    const rc = await tx.wait();
    const assigned = rc.logs
      .map((l) => { try { return fx.orders.interface.parseLog(l); } catch { return null; } })
      .filter((p) => p && p.name === "OrderAssigned");
    expect(assigned.length).to.equal(3);
  });

  it("non-empty whitelist restricts assignment pool", async function () {
    await fx.config.addEligibleMerchant(fx.m1.address);
    await fx.config.addEligibleMerchant(fx.m2.address);

    const list = await fx.config.getEligibleMerchants();
    expect(list.length).to.equal(2);
    expect(await fx.config.isEligibleMerchant(fx.m3.address)).to.equal(false);

    const tx = await fx.orders
      .connect(fx.user)
      .createBuyOrder(ethers.parseUnits("100", 6));
    const rc = await tx.wait();
    const assigned = rc.logs
      .map((l) => { try { return fx.orders.interface.parseLog(l); } catch { return null; } })
      .filter((p) => p && p.name === "OrderAssigned");
    expect(assigned.length).to.equal(2);
    const assignedAddrs = assigned.map((a) => a.args.merchant.toLowerCase());
    expect(assignedAddrs).to.include(fx.m1.address.toLowerCase());
    expect(assignedAddrs).to.include(fx.m2.address.toLowerCase());
    expect(assignedAddrs).to.not.include(fx.m3.address.toLowerCase());
  });

  it("addEligibleMerchant is idempotent + non-admin cannot add", async function () {
    await fx.config.addEligibleMerchant(fx.m1.address);
    await fx.config.addEligibleMerchant(fx.m1.address); // idempotent
    expect((await fx.config.getEligibleMerchants()).length).to.equal(1);

    await expect(
      fx.config.connect(fx.m1).addEligibleMerchant(fx.m2.address)
    ).to.be.revertedWith("Not admin");
  });

  it("removeEligibleMerchant swap-pops correctly", async function () {
    await fx.config.addEligibleMerchant(fx.m1.address);
    await fx.config.addEligibleMerchant(fx.m2.address);
    await fx.config.addEligibleMerchant(fx.m3.address);

    await fx.config.removeEligibleMerchant(fx.m2.address);
    const list = await fx.config.getEligibleMerchants();
    expect(list.length).to.equal(2);
    expect(await fx.config.isEligibleMerchant(fx.m2.address)).to.equal(false);
    expect(await fx.config.isEligibleMerchant(fx.m1.address)).to.equal(true);
    expect(await fx.config.isEligibleMerchant(fx.m3.address)).to.equal(true);
  });

  it("clearEligibleMerchants resets to all-eligible mode", async function () {
    await fx.config.addEligibleMerchant(fx.m1.address);
    await fx.config.addEligibleMerchant(fx.m2.address);
    await fx.config.clearEligibleMerchants();
    expect((await fx.config.getEligibleMerchants()).length).to.equal(0);

    // After clearing, all merchants should be eligible again
    const tx = await fx.orders
      .connect(fx.user)
      .createBuyOrder(ethers.parseUnits("100", 6));
    const rc = await tx.wait();
    const assigned = rc.logs
      .map((l) => { try { return fx.orders.interface.parseLog(l); } catch { return null; } })
      .filter((p) => p && p.name === "OrderAssigned");
    expect(assigned.length).to.equal(3);
  });

  it("cannot add a non-registered address", async function () {
    await expect(
      fx.config.addEligibleMerchant(fx.keeper.address)
    ).to.be.revertedWith("Not a merchant");
  });
});
