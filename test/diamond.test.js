// test/diamond.test.js
// Run: npx hardhat test
//
// Covers Diamond (loupe, ownership), ConfigFacet, MerchantFacet, and security fixes.

const { ethers } = require("hardhat");
const { expect } = require("chai");

const FacetCutAction = { Add: 0 };

/** @param {import("ethers").Contract} contract */
function getSelectors(contract) {
  return contract.interface.fragments
    .filter((f) => f.type === "function")
    .map((f) => ethers.id(f.format("sighash")).slice(0, 10));
}

const MerchantAccountStatus = {
  ACTIVE: 0,
  INACTIVE: 1,
  BLACKLISTED: 2,
  DISPUTED: 3,
  DORMANT: 4,
};

const ChannelStatus = { PENDING: 0, APPROVED: 1, REJECTED: 2, TERMINATED: 3 };
const ChannelAvailability = { ACTIVE: 0, INACTIVE: 1 };

async function deployDiamondWithUsdc(usdcAddress, minStake) {
  const [deployer, merchant, other] = await ethers.getSigners();

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
    {
      facetAddress: await diamondLoupeFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(diamondLoupeFacet),
    },
    {
      facetAddress: await ownershipFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(ownershipFacet),
    },
    {
      facetAddress: await configFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(configFacet),
    },
    {
      facetAddress: await merchantFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(merchantFacet),
    },
    {
      facetAddress: await orderFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(orderFacet),
    },
  ];

  const initCalldata = diamondInit.interface.encodeFunctionData("init", [
    usdcAddress,
    minStake,
    ethers.parseUnits("600", 6),
    ethers.parseUnits("6200", 6),
    95, // BUY price INR/USDC
    90, // SELL price INR/USDC
    600, // 10 min dispute window
  ]);

  const dc = await ethers.getContractAt("IDiamondCut", diamondAddress);
  await (await dc.diamondCut(cut, await diamondInit.getAddress(), initCalldata)).wait();

  const diamondCut = await ethers.getContractAt("IDiamondCut", diamondAddress);
  const loupe = await ethers.getContractAt("IDiamondLoupe", diamondAddress);
  const ownership = await ethers.getContractAt("OwnershipFacet", diamondAddress);
  const config = await ethers.getContractAt("ConfigFacet", diamondAddress);
  const merchants = await ethers.getContractAt("MerchantFacet", diamondAddress);
  const orders = await ethers.getContractAt("OrderFacet", diamondAddress);

  return {
    deployer,
    merchant,
    other,
    diamondAddress,
    diamondCutFacet,
    diamondLoupeFacet,
    ownershipFacet,
    configFacet,
    merchantFacet,
    orderFacet,
    diamondCut,
    loupe,
    ownership,
    config,
    merchants,
    orders,
  };
}

describe("Diamond (EIP-2535)", function () {
  let fx;

  beforeEach(async function () {
    const usdc = await ethers.deployContract("MockERC20", ["USDC", "USDC", 6]);
    const minStake = ethers.parseUnits("100", 6);
    fx = await deployDiamondWithUsdc(await usdc.getAddress(), minStake);
    fx.usdc = usdc;
    fx.minStake = minStake;
  });

  it("deploys 6 facets (Cut + Loupe + Ownership + Config + Merchant + Order)", async function () {
    const facetAddrs = await fx.loupe.facetAddresses();
    expect(facetAddrs.length).to.equal(6);
  });

  it("loupe facetAddress resolves for facets()", async function () {
    const sel = ethers.id("facets()").slice(0, 10);
    const addr = await fx.loupe.facetAddress(sel);
    expect(addr.toLowerCase()).to.equal(
      (await fx.diamondLoupeFacet.getAddress()).toLowerCase()
    );
  });

  it("supports ERC-165, IDiamondCut, IDiamondLoupe, IERC173", async function () {
    const loupeAsFacet = await ethers.getContractAt("DiamondLoupeFacet", fx.diamondAddress);
    expect(await loupeAsFacet.supportsInterface("0x01ffc9a7")).to.be.true;
    expect(await loupeAsFacet.supportsInterface("0x1f931c1c")).to.be.true;
    expect(await loupeAsFacet.supportsInterface("0x48e2b093")).to.be.true;
    expect(await loupeAsFacet.supportsInterface("0x7f5828d0")).to.be.true;
  });

  it("ownership: owner, transfer, non-owner revert", async function () {
    expect(await fx.ownership.owner()).to.equal(fx.deployer.address);
    await fx.ownership.transferOwnership(fx.other.address);
    expect(await fx.ownership.owner()).to.equal(fx.other.address);
    await fx.ownership.connect(fx.other).transferOwnership(fx.deployer.address);
    await expect(
      fx.ownership.connect(fx.other).transferOwnership(fx.other.address)
    ).to.be.revertedWith("LibDiamond: Must be contract owner");
  });
});

describe("ConfigFacet", function () {
  let fx;

  beforeEach(async function () {
    const usdc = await ethers.deployContract("MockERC20", ["USDC", "USDC", 6]);
    fx = await deployDiamondWithUsdc(await usdc.getAddress(), ethers.parseUnits("100", 6));
    fx.usdc = usdc;
  });

  it("getConfig returns admin and USDC from DiamondInit", async function () {
    const cfg = await fx.config.getConfig();
    expect(cfg.admin).to.equal(fx.deployer.address);
    expect(cfg.usdcToken).to.equal(await fx.usdc.getAddress());
    expect(cfg.paused).to.equal(false);
  });

  it("pausePlatform / unpausePlatform (admin only)", async function () {
    await fx.config.pausePlatform();
    expect((await fx.config.getConfig()).paused).to.equal(true);
    await expect(
      fx.config.connect(fx.other).unpausePlatform()
    ).to.be.revertedWith("Not admin");
    await fx.config.unpausePlatform();
    expect((await fx.config.getConfig()).paused).to.equal(false);
  });

  it("setMinMerchantStake", async function () {
    const n = ethers.parseUnits("200", 6);
    await fx.config.setMinMerchantStake(n);
    expect((await fx.config.getConfig()).minMerchantStakeUsdc).to.equal(n);
  });

  it("transferPlatformAdmin", async function () {
    await fx.config.transferPlatformAdmin(fx.other.address);
    expect((await fx.config.getConfig()).admin).to.equal(fx.other.address);
    await expect(
      fx.config.pausePlatform()
    ).to.be.revertedWith("Not admin");
    await fx.config.connect(fx.other).pausePlatform();
    expect((await fx.config.getConfig()).paused).to.equal(true);
  });
});

describe("MerchantFacet — flows", function () {
  let fx;

  beforeEach(async function () {
    const usdc = await ethers.deployContract("MockERC20", ["USDC", "USDC", 6]);
    const minStake = ethers.parseUnits("100", 6);
    fx = await deployDiamondWithUsdc(await usdc.getAddress(), minStake);
    fx.usdc = usdc;
    fx.minStake = minStake;
    await fx.usdc.mint(fx.merchant.address, ethers.parseUnits("10000", 6));
    await fx.usdc.connect(fx.merchant).approve(fx.diamondAddress, ethers.MaxUint256);
  });

  async function registerAndAddApprovedChannel() {
    const m = fx.merchants.connect(fx.merchant);
    await m.registerMerchant(fx.minStake, "merchantTG");
    await m.addPaymentChannel("TestBank", "1234", "u@pay", "main");
    const chs0 = await m.getMyChannels();
    const channelId = chs0[0].channelId;
    await fx.merchants.connect(fx.deployer).approveChannel(channelId);
    return { m, channelId };
  }

  it("registerMerchant + getMyProfile + getAllMerchants", async function () {
    const m = fx.merchants.connect(fx.merchant);
    await m.registerMerchant(fx.minStake, "tg1");
    const p = await m.getMyProfile();
    expect(p.telegramUsername).to.equal("tg1");
    expect(p.accountStatus).to.equal(MerchantAccountStatus.ACTIVE);
    const all = await fx.merchants.getAllMerchants();
    expect(all).to.include(fx.merchant.address);
  });

  it("depositStake increases liquidity and respects pause", async function () {
    const m = fx.merchants.connect(fx.merchant);
    await m.registerMerchant(fx.minStake, "tg");
    const extra = ethers.parseUnits("50", 6);
    await m.depositStake(extra);
    const p = await m.getMyProfile();
    expect(p.usdcLiquidity).to.equal(fx.minStake + extra);
    await fx.config.pausePlatform();
    await expect(m.depositStake(1)).to.be.revertedWith("Platform is paused");
  });

  it("goOnline / goOffline", async function () {
    const m = fx.merchants.connect(fx.merchant);
    await m.registerMerchant(fx.minStake, "tg");
    await m.goOffline();
    let p = await m.getMyProfile();
    expect(p.availability).to.equal(1); // OFFLINE
    await m.goOnline();
    p = await m.getMyProfile();
    expect(p.availability).to.equal(0); // ONLINE
  });

  it("pendingChannelIds: add two PENDING, approve one, queue length updates", async function () {
    const m = fx.merchants.connect(fx.merchant);
    await m.registerMerchant(fx.minStake, "tg");
    await m.addPaymentChannel("B1", "1111", "a@x", "c1");
    await m.addPaymentChannel("B2", "2222", "b@x", "c2");
    expect(await fx.merchants.getPendingChannelCount()).to.equal(2);
    const pending = await fx.merchants.getPendingChannels();
    expect(pending.length).to.equal(2);
    await fx.merchants.connect(fx.deployer).approveChannel(pending[0]);
    expect(await fx.merchants.getPendingChannelCount()).to.equal(1);
  });

  it("rejectChannel removes from pending queue", async function () {
    const m = fx.merchants.connect(fx.merchant);
    await m.registerMerchant(fx.minStake, "tg");
    await m.addPaymentChannel("B1", "3333", "c@x", "c1");
    const pending = await fx.merchants.getPendingChannels();
    await fx.merchants.connect(fx.deployer).rejectChannel(pending[0]);
    expect(await fx.merchants.getPendingChannelCount()).to.equal(0);
  });

  it("withdrawStake deactivates APPROVED channel availability", async function () {
    const { m, channelId } = await registerAndAddApprovedChannel();
    let ch = await fx.merchants.getChannel(channelId);
    expect(ch.status).to.equal(ChannelStatus.APPROVED);
    expect(ch.availability).to.equal(ChannelAvailability.ACTIVE);
    await m.withdrawStake();
    ch = await fx.merchants.getChannel(channelId);
    expect(ch.availability).to.equal(ChannelAvailability.INACTIVE);
    const p = await m.getMyProfile();
    expect(p.accountStatus).to.equal(MerchantAccountStatus.INACTIVE);
    expect(p.unstakePending).to.equal(true);
  });

  it("CRITICAL: cannot withdrawStake while any channel fiat balance > 0", async function () {
    const { m, channelId } = await registerAndAddApprovedChannel();
    await fx.merchants
      .connect(fx.deployer)
      .creditChannelFiat(channelId, ethers.parseUnits("1", 6));
    expect(await fx.merchants.getMerchantTotalFiatBalance(fx.merchant.address)).to.be.gt(0);
    await expect(m.withdrawStake()).to.be.revertedWith("Fiat obligations");
  });

  it("approveMerchantUnstake leaves DORMANT (not ACTIVE) when liquidity hits zero", async function () {
    const m = fx.merchants.connect(fx.merchant);
    await m.registerMerchant(fx.minStake, "tg");
    await m.withdrawStake();
    await fx.merchants.connect(fx.deployer).approveMerchantUnstake(fx.merchant.address);
    const p = await m.getMyProfile();
    expect(p.usdcLiquidity).to.equal(0);
    expect(p.accountStatus).to.equal(MerchantAccountStatus.DORMANT);
    expect(p.unstakePending).to.equal(false);
  });

  it("rejectMerchantUnstake restores ACTIVE", async function () {
    const m = fx.merchants.connect(fx.merchant);
    await m.registerMerchant(fx.minStake, "tg");
    await m.withdrawStake();
    await fx.merchants.connect(fx.deployer).rejectMerchantUnstake(fx.merchant.address);
    const p = await m.getMyProfile();
    expect(p.accountStatus).to.equal(MerchantAccountStatus.ACTIVE);
    expect(p.unstakePending).to.equal(false);
  });

  it("depositStake from DORMANT restores ACTIVE when crossing min", async function () {
    const m = fx.merchants.connect(fx.merchant);
    await m.registerMerchant(fx.minStake, "tg");
    await m.withdrawStake();
    await fx.merchants.connect(fx.deployer).approveMerchantUnstake(fx.merchant.address);
    let p = await m.getMyProfile();
    expect(p.accountStatus).to.equal(MerchantAccountStatus.DORMANT);
    await fx.usdc.mint(fx.merchant.address, fx.minStake);
    await m.depositStake(fx.minStake);
    p = await m.getMyProfile();
    expect(p.accountStatus).to.equal(MerchantAccountStatus.ACTIVE);
  });

  it("setPaymentChannelActive/Inactive + migrateAndTerminate", async function () {
    const m = fx.merchants.connect(fx.merchant);
    await m.registerMerchant(fx.minStake, "tg");
    await m.addPaymentChannel("B1", "4444", "d@x", "c1");
    await m.addPaymentChannel("B2", "5555", "e@x", "c2");
    const chs = await m.getMyChannels();
    const id0 = chs[0].channelId;
    const id1 = chs[1].channelId;
    await fx.merchants.connect(fx.deployer).approveChannel(id0);
    await fx.merchants.connect(fx.deployer).approveChannel(id1);
    await m.setPaymentChannelInactive(id0);
    let c0 = await fx.merchants.getChannel(id0);
    expect(c0.availability).to.equal(ChannelAvailability.INACTIVE);
    await m.setPaymentChannelActive(id0);
    await fx.merchants.connect(fx.deployer).creditChannelFiat(id0, 1000);
    await m.migrateAndTerminate(id0, id1);
    const after0 = await fx.merchants.getChannel(id0);
    const after1 = await fx.merchants.getChannel(id1);
    expect(after0.status).to.equal(ChannelStatus.TERMINATED);
    expect(after0.fiatBalance).to.equal(0);
    expect(after1.fiatBalance).to.equal(1000);
  });

  it("blacklistMerchant + setMerchantDisputed + clearMerchantDispute", async function () {
    const m = fx.merchants.connect(fx.merchant);
    await m.registerMerchant(fx.minStake, "tg");
    await fx.merchants.connect(fx.deployer).setMerchantDisputed(fx.merchant.address);
    let p = await m.getMyProfile();
    expect(p.accountStatus).to.equal(MerchantAccountStatus.DISPUTED);
    await fx.merchants.connect(fx.deployer).clearMerchantDispute(fx.merchant.address);
    p = await m.getMyProfile();
    expect(p.accountStatus).to.equal(MerchantAccountStatus.ACTIVE);
    await fx.merchants.connect(fx.deployer).blacklistMerchant(fx.merchant.address);
    p = await m.getMyProfile();
    expect(p.accountStatus).to.equal(MerchantAccountStatus.BLACKLISTED);
  });

  it("creditChannelFiat (admin)", async function () {
    const { channelId } = await registerAndAddApprovedChannel();
    await fx.merchants.connect(fx.deployer).creditChannelFiat(channelId, 42);
    const ch = await fx.merchants.getChannel(channelId);
    expect(ch.fiatBalance).to.equal(42);
  });
});

describe("Channel volume limits", function () {
  const DAY = 24 * 60 * 60;
  const MONTH = 30 * DAY;
  let fx;

  beforeEach(async function () {
    const usdc = await ethers.deployContract("MockERC20", ["USDC", "USDC", 6]);
    fx = await deployDiamondWithUsdc(await usdc.getAddress(), ethers.parseUnits("300", 6));
    await usdc.mint(fx.merchant.address, ethers.parseUnits("10000", 6));
    await usdc
      .connect(fx.merchant)
      .approve(fx.diamondAddress, ethers.parseUnits("10000", 6));
  });

  async function newApprovedChannel() {
    await fx.merchants
      .connect(fx.merchant)
      .registerMerchant(ethers.parseUnits("300", 6), "tg");
    await fx.merchants
      .connect(fx.merchant)
      .addPaymentChannel("SBI", "1234", "u@upi", "primary");
    const [id] = await fx.merchants.connect(fx.merchant).getMyChannels();
    const channelId = id.channelId;
    await fx.merchants.connect(fx.deployer).approveChannel(channelId);
    return channelId;
  }

  it("DiamondInit seeds the platform defaults from init args", async function () {
    const [dailyUsdc, monthlyUsdc] = await fx.config.getChannelLimitDefaults();
    expect(dailyUsdc).to.equal(ethers.parseUnits("600", 6));
    expect(monthlyUsdc).to.equal(ethers.parseUnits("6200", 6));
  });

  it("admin can update platform defaults", async function () {
    await fx.config
      .connect(fx.deployer)
      .setDefaultChannelLimits(ethers.parseUnits("1000", 6), ethers.parseUnits("20000", 6));
    const [dailyUsdc, monthlyUsdc] = await fx.config.getChannelLimitDefaults();
    expect(dailyUsdc).to.equal(ethers.parseUnits("1000", 6));
    expect(monthlyUsdc).to.equal(ethers.parseUnits("20000", 6));
  });

  it("non-admin cannot update platform defaults", async function () {
    await expect(
      fx.config.connect(fx.other).setDefaultChannelLimits(1, 2)
    ).to.be.revertedWith("Not admin");
  });

  it("rejects monthly < daily on the platform default setter", async function () {
    await expect(
      fx.config.connect(fx.deployer).setDefaultChannelLimits(1000, 500)
    ).to.be.revertedWith("Monthly < daily");
  });

  it("new channel returns platform defaults via getChannelLimits", async function () {
    const channelId = await newApprovedChannel();
    const lim = await fx.merchants.getChannelLimits(channelId);
    expect(lim.dailyLimitUsdc).to.equal(ethers.parseUnits("600", 6));
    expect(lim.monthlyLimitUsdc).to.equal(ethers.parseUnits("6200", 6));
    expect(lim.dailyVolumeUsed).to.equal(0);
    expect(lim.monthlyVolumeUsed).to.equal(0);
  });

  it("channel picks up new platform defaults immediately (no per-channel state)", async function () {
    const channelId = await newApprovedChannel();
    await fx.config
      .connect(fx.deployer)
      .setDefaultChannelLimits(ethers.parseUnits("1500", 6), ethers.parseUnits("20000", 6));
    const lim = await fx.merchants.getChannelLimits(channelId);
    expect(lim.dailyLimitUsdc).to.equal(ethers.parseUnits("1500", 6));
    expect(lim.monthlyLimitUsdc).to.equal(ethers.parseUnits("20000", 6));
  });

  it("windowStatus resetsAt advances after a day passes", async function () {
    const channelId = await newApprovedChannel();
    const before = await fx.merchants.getChannelLimits(channelId);
    // dailyResetsAt when no consumption is now + 1 day
    expect(before.dailyResetsAt).to.be.gt(0);

    await ethers.provider.send("evm_increaseTime", [DAY + 1]);
    await ethers.provider.send("evm_mine", []);

    const after = await fx.merchants.getChannelLimits(channelId);
    expect(after.dailyResetsAt).to.be.gt(before.dailyResetsAt);
    expect(after.monthlyResetsAt).to.be.gt(before.monthlyResetsAt);
  });
});

describe("Security", function () {
  it("registerMerchant blocks reentrancy via malicious ERC20", async function () {
    const token = await ethers.deployContract("ReentrantMaliciousERC20", []);
    const diamondFx = await deployDiamondWithUsdc(
      await token.getAddress(),
      ethers.parseUnits("1", 6)
    );
    const attacker = await ethers.deployContract("ReentrancyAttacker", [
      diamondFx.diamondAddress,
      await token.getAddress(),
    ]);
    await token.setCallee(await attacker.getAddress());

    const min = ethers.parseUnits("1", 6);
    await token.mint(await attacker.getAddress(), min);
    await expect(attacker.attack(min, "tg")).to.be.revertedWith(
      "ReentrancyGuard: reentrant call"
    );
  });

  it("SafeERC20: BadReturnERC20 transferFrom causes registerMerchant to revert", async function () {
    const bad = await ethers.deployContract("BadReturnERC20", []);
    const [deployer] = await ethers.getSigners();
    const fx = await deployDiamondWithUsdc(await bad.getAddress(), 100n);
    await bad.mint(deployer.address, 10n ** 18n);
    await bad.connect(deployer).approve(fx.diamondAddress, ethers.MaxUint256);
    await expect(
      fx.merchants.connect(deployer).registerMerchant(100, "x")
    ).to.be.reverted;
  });
});
