const { expect } = require("chai");
const hardhat = require("hardhat");
const { ethers } = hardhat;
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const {
  DisputeResolution,
  E6,
  OrderStatus,
  OrderType,
  assignOrder,
  createOrder,
  deployV2,
  publishRound,
  setupMerchant,
} = require("./helpers/v2-fixture");

const ASSIGNMENT_GAS_CEILING = 500_000n;
const COVERAGE_INSTRUMENTATION_ALLOWANCE = 25_000n;

function seededChoices(seed) {
  let state = BigInt(seed);
  return () => {
    state = (1_664_525n * state + 1_013_904_223n) & 0xffff_ffffn;
    return Number(state % 6n);
  };
}

async function assertCustodyLedger(fixture, channelId) {
  const totals = await fixture.config.getCustodyTotals();
  const merchant = await fixture.merchants.getMerchant(fixture.merchantOne.address);
  const channel = await fixture.merchants.getChannel(channelId);
  const balance = await fixture.usdc.balanceOf(fixture.diamondAddress);

  const tokenObligations = totals.totalMerchantStakeUsdc
    + totals.totalMerchantLiquidityUsdc
    + totals.totalSellEscrowUsdc;
  expect(balance, "token balance covers every custody bucket").to.be.gte(tokenObligations);
  expect(totals.totalReservedBuyUsdc, "BUY reserve is part of merchant liquidity")
    .to.be.lte(totals.totalMerchantLiquidityUsdc);
  expect(merchant.reservedUsdc + merchant.disputeLockedUsdc, "merchant cannot over-reserve")
    .to.be.lte(merchant.liquidityUsdc);
  expect(channel.reservedFiatE6, "channel cannot over-reserve fiat capacity")
    .to.be.lte(channel.fiatCapacityE6);
  expect(merchant.reservedFiatE6).to.equal(channel.reservedFiatE6);
  expect(merchant.obligationCount).to.equal(channel.obligationCount);
}

describe("v2 seeded invariant and bounded-gas evidence", function () {
  this.timeout(180_000);

  it("preserves the custody ledger after deterministic BUY/SELL action sequences", async function () {
    const fixture = await deployV2({ safety: { acceptedRecoverySeconds: 60 } });
    const merchant = await setupMerchant(fixture, fixture.merchantOne, {
      liquidity: 10_000n * E6,
      fiatCapacityE6: 1_000_000n * E6,
    });
    const choose = seededChoices(0x84532);

    for (let index = 0; index < 18; index += 1) {
      await publishRound(fixture);
      const orderType = index % 2 === 0 ? OrderType.BUY : OrderType.SELL;
      const created = await createOrder(fixture, orderType, BigInt(index + 1) * E6);
      await assertCustodyLedger(fixture, merchant.channelId);

      const outcome = choose();
      if (outcome === 0) {
        await fixture.orders.connect(fixture.user).cancelOrder(created.orderId);
      } else {
        await assignOrder(fixture, created.orderId, [{
          merchant: fixture.merchantOne.address,
          channelId: merchant.channelId,
        }], `seeded-${index}`);
        await assertCustodyLedger(fixture, merchant.channelId);

        if (outcome === 1) {
          await fixture.orders.connect(fixture.user).cancelOrder(created.orderId);
        } else {
          await fixture.orders.connect(fixture.merchantOne).acceptOrder(created.orderId, merchant.channelId);
          await assertCustodyLedger(fixture, merchant.channelId);

          if (outcome === 2) {
            if (orderType === OrderType.BUY) {
              await fixture.orders.connect(fixture.user).markFiatSent(created.orderId);
              await fixture.orders.connect(fixture.merchantOne).confirmFiatReceived(created.orderId);
            } else {
              await fixture.orders.connect(fixture.merchantOne).markFiatSent(created.orderId);
              await fixture.orders.connect(fixture.user).confirmFiatReceived(created.orderId);
            }
          } else if (outcome === 3 || outcome === 4) {
            await fixture.disputes.connect(fixture.user).openDispute(created.orderId);
            await assertCustodyLedger(fixture, merchant.channelId);
            await fixture.disputes.connect(fixture.disputeResolver).resolveDispute(
              created.orderId,
              outcome === 3 ? DisputeResolution.CANCEL_TRADE : DisputeResolution.SETTLE_TRADE,
            );
          } else {
            const accepted = await fixture.orders.getOrder(created.orderId);
            await time.increaseTo(accepted.acceptedRecoveryDeadline);
            await fixture.orders.connect(fixture.orderAssigner).recoverExpiredOrder(created.orderId);
          }
        }
      }

      const terminal = await fixture.orders.getOrder(created.orderId);
      expect([
        Number(OrderStatus.COMPLETED),
        Number(OrderStatus.CANCELLED),
        Number(OrderStatus.EXPIRED),
      ]).to.include(Number(terminal.status));
      await assertCustodyLedger(fixture, merchant.channelId);
    }

    const merchantAfter = await fixture.merchants.getMerchant(fixture.merchantOne.address);
    const channelAfter = await fixture.merchants.getChannel(merchant.channelId);
    expect(merchantAfter.reservedUsdc).to.equal(0n);
    expect(merchantAfter.disputeLockedUsdc).to.equal(0n);
    expect(merchantAfter.reservedFiatE6).to.equal(0n);
    expect(merchantAfter.obligationCount).to.equal(0n);
    expect(channelAfter.reservedFiatE6).to.equal(0n);
    expect(channelAfter.obligationCount).to.equal(0n);
  });

  it("keeps successful assignment gas bounded for every allowed candidate count", async function () {
    const fixture = await deployV2();
    await publishRound(fixture);
    const signers = [fixture.merchantOne, fixture.merchantTwo, fixture.other, fixture.newAdmin];
    const candidates = [];
    for (const signer of signers) {
      const setup = await setupMerchant(fixture, signer);
      candidates.push({ merchant: signer.address, channelId: setup.channelId });
    }

    const gasUsed = [];
    const absoluteCeiling = ASSIGNMENT_GAS_CEILING
      + (hardhat.__SOLIDITY_COVERAGE_RUNNING ? COVERAGE_INSTRUMENTATION_ALLOWANCE : 0n);
    for (let count = 1; count <= 4; count += 1) {
      const created = await createOrder(fixture, OrderType.BUY, E6);
      const order = await fixture.orders.getOrder(created.orderId);
      const receipt = await (await fixture.assignments.connect(fixture.orderAssigner).assignOrderCandidates(
        created.orderId,
        order.assignmentEpoch,
        candidates.slice(0, count),
        ethers.id(`gas-candidates-${count}`),
      )).wait();
      gasUsed.push(receipt.gasUsed);
      expect(
        receipt.gasUsed,
        `${count}-candidate assignment exceeded the ${hardhat.__SOLIDITY_COVERAGE_RUNNING ? "instrumented" : "production"} ceiling`,
      ).to.be.lte(absoluteCeiling);
      if (count > 1) {
        expect(receipt.gasUsed - gasUsed[count - 2], "one candidate caused an unbounded gas step")
          .to.be.lte(80_000n);
      }
    }

    expect(gasUsed).to.have.length(4);
  });
});
