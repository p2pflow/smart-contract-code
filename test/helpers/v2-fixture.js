const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const FacetCutAction = Object.freeze({ Add: 0, Replace: 1, Remove: 2 });
const OrderType = Object.freeze({ BUY: 0, SELL: 1 });
const OrderStatus = Object.freeze({
  CREATED: 0,
  ASSIGNED: 1,
  ACCEPTED: 2,
  FIAT_SENT: 3,
  COMPLETED: 4,
  CANCELLED: 5,
  EXPIRED: 6,
  DISPUTED: 7,
});
const MerchantStatus = Object.freeze({
  PENDING: 0,
  ACTIVE: 1,
  INACTIVE: 2,
  BLACKLISTED: 3,
  DISPUTED: 4,
  EXITING: 5,
  EXITED: 6,
});
const MerchantAvailability = Object.freeze({ ONLINE: 0, OFFLINE: 1 });
const ChannelStatus = Object.freeze({ PENDING: 0, APPROVED: 1, REJECTED: 2, TERMINATED: 3 });
const ChannelAvailability = Object.freeze({ ACTIVE: 0, INACTIVE: 1 });
const CandidateStatus = Object.freeze({ NONE: 0, ASSIGNED: 1, REJECTED: 2, ACCEPTED: 3, EXPIRED: 4, RELEASED: 5 });
const PublicationKind = Object.freeze({ AUTOMATED: 0, EMERGENCY: 1 });
const DisputeStatus = Object.freeze({ NONE: 0, OPEN: 1, RESOLVED: 2 });
const DisputeResolution = Object.freeze({ CANCEL_TRADE: 0, SETTLE_TRADE: 1 });
const SideMask = Object.freeze({ BUY: 1, SELL: 2, BOTH: 3 });

const E6 = 1_000_000n;
const DEFAULT_BUY_PRICE = 95n * E6;
const DEFAULT_SELL_PRICE = 90n * E6;

function getSelectors(contract) {
  return contract.interface.fragments
    .filter((fragment) => fragment.type === "function")
    .map((fragment) => fragment.selector)
    .sort();
}

function findEvent(receipt, contract, eventName) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === eventName) return parsed;
    } catch {
      // Another facet/token log.
    }
  }
  throw new Error(`${eventName} was not emitted`);
}

async function deployV2(options = {}) {
  const signers = await ethers.getSigners();
  const [owner, admin, operator, upgrader, pauser, priceUpdater, orderAssigner, disputeResolver,
    user, merchantOne, merchantTwo, other, newAdmin, newOwner] = signers;

  const usdc = options.usdc ?? await ethers.deployContract("MockERC20", ["USD Coin", "USDC", 6]);
  const diamondCutFacet = await ethers.deployContract("DiamondCutFacet");
  const diamond = await ethers.deployContract("Diamond", [owner.address, await diamondCutFacet.getAddress()]);
  const diamondAddress = await diamond.getAddress();

  const facetNames = [
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
  const facetDeployments = {};
  const cut = [];
  const seenSelectors = new Map();
  for (const name of facetNames) {
    const facet = await ethers.deployContract(name);
    facetDeployments[name] = facet;
    const selectors = getSelectors(facet);
    for (const selector of selectors) {
      if (seenSelectors.has(selector)) {
        throw new Error(`duplicate selector ${selector}: ${seenSelectors.get(selector)} and ${name}`);
      }
      seenSelectors.set(selector, name);
    }
    cut.push({
      facetAddress: await facet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: selectors,
    });
  }

  const diamondCut = await ethers.getContractAt("IDiamondCut", diamondAddress);
  const initializer = await ethers.deployContract("DiamondInitV2");
  const roles = {
    defaultAdmin: admin.address,
    operator: operator.address,
    upgrader: upgrader.address,
    pauser: pauser.address,
    priceUpdater: priceUpdater.address,
    orderAssigner: orderAssigner.address,
    disputeResolver: disputeResolver.address,
    ...(options.roles ?? {}),
  };
  const initInput = {
    usdcToken: await usdc.getAddress(),
    minMerchantStakeUsdc: options.minStake ?? 100n * E6,
    safety: {
      orderLifetimeSeconds: 600,
      assignmentLifetimeSeconds: 300,
      acceptedRecoverySeconds: 1_800,
      maxQuoteValiditySeconds: 300,
      ...(options.safety ?? {}),
    },
    pricePolicy: {
      sourceQuorum: 2,
      maxAgeSeconds: 300,
      maxDeviationBps: 300,
      ...(options.pricePolicy ?? {}),
    },
    roles,
  };

  const initCalldata = initializer.interface.encodeFunctionData("initV2", [initInput]);
  let initReceipt;
  if (options.initialize === false) {
    await (await diamondCut.connect(owner).diamondCut(cut, ethers.ZeroAddress, "0x")).wait();
  } else {
    initReceipt = await (await diamondCut.connect(owner).diamondCut(
      cut,
      await initializer.getAddress(),
      initCalldata,
    )).wait();
    if (options.leavePaused !== true) {
      const bootstrapConfig = await ethers.getContractAt("ConfigFacet", diamondAddress);
      await (await bootstrapConfig.connect(pauser).unpausePlatform()).wait();
    }
  }

  const fixture = {
    signers,
    owner,
    admin,
    operator,
    upgrader,
    pauser,
    priceUpdater,
    orderAssigner,
    disputeResolver,
    user,
    merchantOne,
    merchantTwo,
    other,
    newAdmin,
    newOwner,
    usdc,
    diamond,
    diamondAddress,
    diamondCutFacet,
    diamondCut,
    initializer,
    initInput,
    initCalldata,
    initReceipt,
    facetDeployments,
    access: await ethers.getContractAt("AccessControlFacet", diamondAddress),
    config: await ethers.getContractAt("ConfigFacet", diamondAddress),
    pricing: await ethers.getContractAt("PricingFacet", diamondAddress),
    merchants: await ethers.getContractAt("MerchantFacet", diamondAddress),
    assignments: await ethers.getContractAt("AssignmentFacet", diamondAddress),
    orders: await ethers.getContractAt("OrderFacet", diamondAddress),
    disputes: await ethers.getContractAt("DisputeFacet", diamondAddress),
    loupe: await ethers.getContractAt("IDiamondLoupe", diamondAddress),
    ownership: await ethers.getContractAt("OwnershipFacet", diamondAddress),
  };
  return fixture;
}

async function publishRound(fixture, overrides = {}) {
  const now = await time.latest();
  const latest = await fixture.pricing.getLatestPriceRound();
  const roundId = overrides.roundId ?? latest.roundId + 1n;
  const values = {
    roundId,
    buyPriceE6: overrides.buyPriceE6 ?? DEFAULT_BUY_PRICE,
    sellPriceE6: overrides.sellPriceE6 ?? DEFAULT_SELL_PRICE,
    sourceObservedAt: overrides.sourceObservedAt ?? now,
    sourceCount: overrides.sourceCount ?? 2,
    evidenceDigest: overrides.evidenceDigest ?? ethers.id(`price-evidence-${roundId}`),
    publicationKind: overrides.publicationKind ?? PublicationKind.AUTOMATED,
  };
  await (await fixture.pricing.connect(overrides.signer ?? fixture.priceUpdater).publishPriceRound(
    values.roundId,
    values.buyPriceE6,
    values.sellPriceE6,
    values.sourceObservedAt,
    values.sourceCount,
    values.evidenceDigest,
    values.publicationKind,
  )).wait();
  return values;
}

async function setupMerchant(fixture, signer, options = {}) {
  const stake = options.stake ?? 100n * E6;
  const liquidity = options.liquidity ?? 1_000n * E6;
  const fiatCapacityE6 = options.fiatCapacityE6 ?? 100_000n * E6;
  const sideMask = options.sideMask ?? SideMask.BOTH;
  await fixture.usdc.mint(signer.address, stake + liquidity);
  await fixture.usdc.connect(signer).approve(fixture.diamondAddress, ethers.MaxUint256);
  await (await fixture.merchants.connect(signer).registerMerchant(stake)).wait();
  await (await fixture.merchants.connect(fixture.operator).approveMerchant(signer.address)).wait();
  if (liquidity > 0n) {
    await (await fixture.merchants.connect(signer).depositLiquidity(liquidity)).wait();
  }
  await (await fixture.merchants.connect(signer).setAvailability(MerchantAvailability.ONLINE)).wait();
  const channelId = await fixture.merchants.connect(signer).registerPaymentChannel.staticCall(
    sideMask,
    fiatCapacityE6,
  );
  await (await fixture.merchants.connect(signer).registerPaymentChannel(sideMask, fiatCapacityE6)).wait();
  await (await fixture.merchants.connect(fixture.operator).reviewPaymentChannel(
    channelId,
    ChannelStatus.APPROVED,
  )).wait();
  await (await fixture.merchants.connect(signer).setChannelAvailability(
    channelId,
    ChannelAvailability.ACTIVE,
  )).wait();
  return { channelId, stake, liquidity, fiatCapacityE6 };
}

async function createOrder(fixture, orderType, usdcAmount, overrides = {}) {
  const latest = await fixture.pricing.getLatestPriceRound();
  const now = await time.latest();
  const quoteValidUntil = overrides.quoteValidUntil ?? now + 120;
  const bound = overrides.boundPriceE6 ?? (
    orderType === OrderType.BUY ? latest.buyPriceE6 : latest.sellPriceE6
  );
  const fn = orderType === OrderType.BUY ? "createBuyOrder" : "createSellOrder";
  if (orderType === OrderType.SELL) {
    await fixture.usdc.mint(fixture.user.address, usdcAmount);
    await fixture.usdc.connect(fixture.user).approve(fixture.diamondAddress, usdcAmount);
  }
  const tx = await fixture.orders.connect(overrides.signer ?? fixture.user)[fn](
    usdcAmount,
    overrides.roundId ?? latest.roundId,
    bound,
    quoteValidUntil,
  );
  const receipt = await tx.wait();
  const created = findEvent(receipt, fixture.orders, "OrderCreated");
  return { orderId: created.args.orderId, created, receipt };
}

async function assignOrder(fixture, orderId, candidates, label = "decision") {
  const order = await fixture.orders.getOrder(orderId);
  const decisionDigest = ethers.id(`${label}-${orderId}-${order.assignmentEpoch}`);
  await (await fixture.assignments.connect(fixture.orderAssigner).assignOrderCandidates(
    orderId,
    order.assignmentEpoch,
    candidates,
    decisionDigest,
  )).wait();
  return decisionDigest;
}

module.exports = {
  FacetCutAction,
  OrderType,
  OrderStatus,
  MerchantStatus,
  MerchantAvailability,
  ChannelStatus,
  ChannelAvailability,
  CandidateStatus,
  PublicationKind,
  DisputeStatus,
  DisputeResolution,
  SideMask,
  E6,
  DEFAULT_BUY_PRICE,
  DEFAULT_SELL_PRICE,
  getSelectors,
  findEvent,
  deployV2,
  publishRound,
  setupMerchant,
  createOrder,
  assignOrder,
};
