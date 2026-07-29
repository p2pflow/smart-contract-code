const { artifacts, ethers } = require("hardhat");
const { expect } = require("chai");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const {
  INIT_VALUES,
  deployBaselineDiamond,
  getSelectors,
  mappingEntrySlot,
  dynamicArrayDataSlot,
  setStorageWord,
  getStorageBigInt,
} = require("./helpers");

const APP_STORAGE_PREFIX = [
  ["config", "0", 0, "struct PlatformConfig"],
  ["merchants", "4", 0, "mapping(address => struct Merchant)"],
  ["merchantList", "5", 0, "address[]"],
  ["channels", "6", 0, "mapping(bytes32 => struct PaymentChannel)"],
  ["channelDuplicateGuard", "7", 0, "mapping(bytes32 => bool)"],
  ["_reentrancyStatus", "8", 0, "uint256"],
  ["defaultChannelDailyLimitUsdc", "9", 0, "uint256"],
  ["defaultChannelMonthlyLimitUsdc", "10", 0, "uint256"],
  ["buyPriceInrPerUsdc", "11", 0, "uint256"],
  ["sellPriceInrPerUsdc", "12", 0, "uint256"],
  ["disputeWindowSeconds", "13", 0, "uint256"],
  ["orderNonce", "14", 0, "uint256"],
  ["orders", "15", 0, "mapping(bytes32 => struct Order)"],
  ["orderIds", "16", 0, "bytes32[]"],
  ["userOrderIds", "17", 0, "mapping(address => bytes32[])"],
  ["merchantOrderIds", "18", 0, "mapping(address => bytes32[])"],
  [
    "orderAssignmentIndex",
    "19",
    0,
    "mapping(bytes32 => mapping(address => bool))",
  ],
  ["eligibleMerchants", "20", 0, "address[]"],
  ["eligibleMerchantIndex", "21", 0, "mapping(address => uint256)"],
];

const LEGACY_STRUCTS = {
  "struct PlatformConfig": {
    bytes: "128",
    members: [
      ["admin", "0", 0, "address"],
      ["usdcToken", "1", 0, "address"],
      ["paused", "1", 20, "bool"],
      ["minMerchantStakeUsdc", "2", 0, "uint256"],
      ["initialized", "3", 0, "bool"],
    ],
  },
  "struct Merchant": {
    bytes: "288",
    members: [
      ["wallet", "0", 0, "address"],
      ["accountStatus", "0", 20, "enum MerchantAccountStatus"],
      ["availability", "0", 21, "enum MerchantAvailability"],
      ["usdcLiquidity", "1", 0, "uint256"],
      ["unstakePending", "2", 0, "bool"],
      ["unstakeRequestedAmount", "3", 0, "uint256"],
      ["telegramUsername", "4", 0, "string"],
      ["registeredAt", "5", 0, "uint256"],
      ["channelIds", "6", 0, "bytes32[]"],
      ["reservedUsdc", "7", 0, "uint256"],
      ["riskUsdc", "8", 0, "uint256"],
    ],
  },
  "struct PaymentChannel": {
    bytes: "544",
    members: [
      ["channelId", "0", 0, "bytes32"],
      ["merchant", "1", 0, "address"],
      ["bankName", "2", 0, "string"],
      ["accountLast4", "3", 0, "string"],
      ["upiId", "4", 0, "string"],
      ["label", "5", 0, "string"],
      ["status", "6", 0, "enum ChannelStatus"],
      ["availability", "6", 1, "enum ChannelAvailability"],
      ["fiatBalance", "7", 0, "uint256"],
      ["appliedAt", "8", 0, "uint256"],
      ["reviewedAt", "9", 0, "uint256"],
      ["__deprecated_dailyLimitUsdc", "10", 0, "uint256"],
      ["__deprecated_monthlyLimitUsdc", "11", 0, "uint256"],
      ["dailyVolumeUsed", "12", 0, "uint256"],
      ["dailyWindowStart", "13", 0, "uint256"],
      ["monthlyVolumeUsed", "14", 0, "uint256"],
      ["monthlyWindowStart", "15", 0, "uint256"],
      ["reservedFiat", "16", 0, "uint256"],
    ],
  },
  "struct Order": {
    bytes: "512",
    members: [
      ["orderId", "0", 0, "bytes32"],
      ["orderType", "1", 0, "enum OrderType"],
      ["status", "1", 1, "enum OrderStatus"],
      ["user", "1", 2, "address"],
      ["merchant", "2", 0, "address"],
      ["channelId", "3", 0, "bytes32"],
      ["usdcAmount", "4", 0, "uint256"],
      ["fiatAmount", "5", 0, "uint256"],
      ["price", "6", 0, "uint256"],
      ["createdAt", "7", 0, "uint256"],
      ["acceptedAt", "8", 0, "uint256"],
      ["paidAt", "9", 0, "uint256"],
      ["completedAt", "10", 0, "uint256"],
      ["cancelledAt", "11", 0, "uint256"],
      ["disputeExpiresAt", "12", 0, "uint256"],
      ["disputeStatus", "13", 0, "enum DisputeStatus"],
      ["disputeResolver", "13", 1, "address"],
      ["disputeResult", "13", 21, "enum DisputeResult"],
      ["assignedMerchants", "14", 0, "address[]"],
      ["riskReleased", "15", 0, "bool"],
    ],
  },
};

function findType(layout, label) {
  const match = Object.values(layout.types).find((type) => type.label === label);
  expect(match, `${label} layout type`).to.not.equal(undefined);
  return match;
}

function normalizedMembers(layout, type) {
  return type.members.map((member) => [
    member.label,
    member.slot,
    member.offset,
    layout.types[member.type].label,
  ]);
}

function assertAppendOnlyAppStorage(members) {
  expect(members.slice(0, APP_STORAGE_PREFIX.length)).to.deep.equal(
    APP_STORAGE_PREFIX
  );
  for (const member of members.slice(APP_STORAGE_PREFIX.length)) {
    expect(
      BigInt(member[1]),
      `${member[0]} must be appended after slot 21`
    ).to.be.gte(22n);
  }
}

function parseEvent(contract, receipt, eventName) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === eventName) return parsed;
    } catch {
      // The receipt also contains logs from other contracts.
    }
  }
  throw new Error(`${eventName} not found`);
}

async function seedRepresentativeState() {
  const fixture = await deployBaselineDiamond();
  const { merchant, user, owner, usdc, diamondAddress, merchants, orders, config } =
    fixture;
  const merchantLiquidity = 500_000_000n;
  const orderUsdc = 10_000_000n;

  await (await usdc.mint(merchant.address, merchantLiquidity)).wait();
  await (
    await usdc.connect(merchant).approve(diamondAddress, ethers.MaxUint256)
  ).wait();
  await (
    await merchants
      .connect(merchant)
      .registerMerchant(merchantLiquidity, "merchant-one")
  ).wait();
  await (
    await merchants
      .connect(merchant)
      .addPaymentChannel("TestBank", "1234", "m@upi", "primary")
  ).wait();

  const [channel] = await merchants.connect(merchant).getMyChannels();
  const channelId = channel.channelId;
  await (await merchants.connect(owner).approveChannel(channelId)).wait();
  await (await config.connect(owner).addEligibleMerchant(merchant.address)).wait();

  const createReceipt = await (
    await orders.connect(user).createBuyOrder(orderUsdc)
  ).wait();
  const orderId = parseEvent(orders, createReceipt, "OrderCreated").args.orderId;
  await (await orders.connect(merchant).acceptOrder(orderId, channelId)).wait();

  // Exercise both packed enum bytes without changing any terminal accounting.
  await (
    await merchants.connect(merchant).setPaymentChannelInactive(channelId)
  ).wait();
  await (
    await merchants.connect(owner).setMerchantDisputed(merchant.address)
  ).wait();
  await (await config.connect(owner).pausePlatform()).wait();

  return {
    ...fixture,
    merchantLiquidity,
    orderUsdc,
    channelId,
    orderId,
  };
}

describe("Provenance — aa6f802 AppStorage roots and packing", function () {
  let layout;

  before(async function () {
    const buildInfo = await artifacts.getBuildInfo(
      "contracts/facets/OrderFacet.sol:OrderFacet"
    );
    layout =
      buildInfo.output.contracts["contracts/facets/OrderFacet.sol"].OrderFacet
        .storageLayout;
  });

  it("locks the exact AppStorage prefix through final live slot 21 and permits only later appends", function () {
    const appStorage = findType(layout, "struct AppStorage");
    const members = normalizedMembers(layout, appStorage);

    assertAppendOnlyAppStorage(members);
  });

  it("accepts a root appended at slot 22 but rejects inserted or moved legacy roots", function () {
    const appStorage = findType(layout, "struct AppStorage");
    const baseline = normalizedMembers(layout, appStorage);

    const appended = [
      ...baseline,
      ["v2Sentinel", "22", 0, "uint256"],
    ];
    expect(() => assertAppendOnlyAppStorage(appended)).to.not.throw();

    const inserted = baseline.map((member) => [...member]);
    inserted.splice(12, 0, ["unsafeInsertion", "15", 0, "uint256"]);
    expect(() => assertAppendOnlyAppStorage(inserted)).to.throw();

    const moved = baseline.map((member) => [...member]);
    moved[12][1] = "16";
    expect(() => assertAppendOnlyAppStorage(moved)).to.throw();
  });

  it("locks all legacy nested struct slots, offsets, sizes, and enum packing", function () {
    for (const [label, expected] of Object.entries(LEGACY_STRUCTS)) {
      const type = findType(layout, label);
      expect(type.numberOfBytes, `${label} byte span`).to.equal(expected.bytes);
      expect(normalizedMembers(layout, type), label).to.deep.equal(
        expected.members
      );
    }
  });

  it("reproduces local root words 0 through 21 with live-shaped sentinels", async function () {
    const fx = await loadFixture(seedRepresentativeState);
    const token = BigInt(await fx.usdc.getAddress());
    const admin = BigInt(fx.owner.address);
    const expected = [
      admin,
      token | (1n << 160n), // usdcToken + paused=true
      INIT_VALUES.minStake,
      1n,
      0n,
      1n,
      0n,
      0n,
      1n,
      INIT_VALUES.dailyLimit,
      INIT_VALUES.monthlyLimit,
      INIT_VALUES.buyPrice,
      INIT_VALUES.sellPrice,
      INIT_VALUES.disputeWindow,
      1n,
      0n,
      1n,
      0n,
      0n,
      0n,
      1n,
      0n,
    ];

    const actual = [];
    for (let slot = 0n; slot <= 21n; slot++) {
      actual.push(await getStorageBigInt(fx.diamondAddress, slot));
    }
    expect(actual).to.deep.equal(expected);
  });

  it("matches actual merchant/channel/order mapping roots, packed words, arrays, and nested indexes", async function () {
    const fx = await loadFixture(seedRepresentativeState);
    const network = await ethers.provider.getNetwork();
    const merchantAddress = BigInt(fx.merchant.address);
    const userAddress = BigInt(fx.user.address);

    const expectedChannelId = ethers.keccak256(
      ethers.solidityPacked(
        ["string", "address", "uint256", "uint256"],
        ["CHANNEL", fx.merchant.address, 0n, network.chainId]
      )
    );
    const expectedOrderId = ethers.keccak256(
      ethers.solidityPacked(
        ["string", "address", "uint256", "uint256"],
        ["ORDER", fx.user.address, 1n, network.chainId]
      )
    );
    expect(fx.channelId).to.equal(expectedChannelId);
    expect(fx.orderId).to.equal(expectedOrderId);

    const merchantRoot = mappingEntrySlot(
      "address",
      fx.merchant.address,
      4n
    );
    const merchantView = await fx.merchants.getMerchant(fx.merchant.address);
    expect(await getStorageBigInt(fx.diamondAddress, merchantRoot)).to.equal(
      merchantAddress | (3n << 160n) | (1n << 168n)
    );
    expect(
      await getStorageBigInt(fx.diamondAddress, merchantRoot + 1n)
    ).to.equal(fx.merchantLiquidity);
    expect(
      await getStorageBigInt(fx.diamondAddress, merchantRoot + 5n)
    ).to.equal(merchantView.registeredAt);
    expect(
      await getStorageBigInt(fx.diamondAddress, merchantRoot + 6n)
    ).to.equal(1n);
    expect(
      await getStorageBigInt(fx.diamondAddress, merchantRoot + 7n)
    ).to.equal(fx.orderUsdc);
    expect(
      await getStorageBigInt(
        fx.diamondAddress,
        dynamicArrayDataSlot(merchantRoot + 6n)
      )
    ).to.equal(BigInt(fx.channelId));

    const channelRoot = mappingEntrySlot("bytes32", fx.channelId, 6n);
    const channelView = await fx.merchants.getChannel(fx.channelId);
    expect(await getStorageBigInt(fx.diamondAddress, channelRoot)).to.equal(
      BigInt(fx.channelId)
    );
    expect(
      await getStorageBigInt(fx.diamondAddress, channelRoot + 1n)
    ).to.equal(merchantAddress);
    expect(
      await getStorageBigInt(fx.diamondAddress, channelRoot + 6n)
    ).to.equal(1n | (1n << 8n));
    expect(
      await getStorageBigInt(fx.diamondAddress, channelRoot + 8n)
    ).to.equal(channelView.appliedAt);
    expect(
      await getStorageBigInt(fx.diamondAddress, channelRoot + 9n)
    ).to.equal(channelView.reviewedAt);

    const orderRoot = mappingEntrySlot("bytes32", fx.orderId, 15n);
    const orderView = await fx.orders.getOrder(fx.orderId);
    expect(await getStorageBigInt(fx.diamondAddress, orderRoot)).to.equal(
      BigInt(fx.orderId)
    );
    expect(
      await getStorageBigInt(fx.diamondAddress, orderRoot + 1n)
    ).to.equal((userAddress << 16n) | (1n << 8n));
    expect(
      await getStorageBigInt(fx.diamondAddress, orderRoot + 2n)
    ).to.equal(merchantAddress);
    expect(
      await getStorageBigInt(fx.diamondAddress, orderRoot + 3n)
    ).to.equal(BigInt(fx.channelId));
    expect(
      await getStorageBigInt(fx.diamondAddress, orderRoot + 4n)
    ).to.equal(fx.orderUsdc);
    expect(
      await getStorageBigInt(fx.diamondAddress, orderRoot + 5n)
    ).to.equal(fx.orderUsdc * INIT_VALUES.buyPrice);
    expect(
      await getStorageBigInt(fx.diamondAddress, orderRoot + 7n)
    ).to.equal(orderView.createdAt);
    expect(
      await getStorageBigInt(fx.diamondAddress, orderRoot + 8n)
    ).to.equal(orderView.acceptedAt);
    expect(
      await getStorageBigInt(fx.diamondAddress, orderRoot + 14n)
    ).to.equal(1n);
    expect(
      await getStorageBigInt(
        fx.diamondAddress,
        dynamicArrayDataSlot(orderRoot + 14n)
      )
    ).to.equal(merchantAddress);

    const assignmentOuter = mappingEntrySlot("bytes32", fx.orderId, 19n);
    const assignmentEntry = mappingEntrySlot(
      "address",
      fx.merchant.address,
      assignmentOuter
    );
    expect(
      await getStorageBigInt(fx.diamondAddress, assignmentEntry)
    ).to.equal(1n);

    const userOrders = mappingEntrySlot("address", fx.user.address, 17n);
    const merchantOrders = mappingEntrySlot(
      "address",
      fx.merchant.address,
      18n
    );
    expect(await getStorageBigInt(fx.diamondAddress, userOrders)).to.equal(1n);
    expect(await getStorageBigInt(fx.diamondAddress, merchantOrders)).to.equal(
      1n
    );
    expect(
      await getStorageBigInt(
        fx.diamondAddress,
        dynamicArrayDataSlot(userOrders)
      )
    ).to.equal(BigInt(fx.orderId));
    expect(
      await getStorageBigInt(
        fx.diamondAddress,
        dynamicArrayDataSlot(merchantOrders)
      )
    ).to.equal(BigInt(fx.orderId));

    expect(
      await getStorageBigInt(
        fx.diamondAddress,
        mappingEntrySlot("address", fx.merchant.address, 21n)
      )
    ).to.equal(1n);
    expect(
      await getStorageBigInt(fx.diamondAddress, dynamicArrayDataSlot(5n))
    ).to.equal(merchantAddress);
    expect(
      await getStorageBigInt(fx.diamondAddress, dynamicArrayDataSlot(16n))
    ).to.equal(BigInt(fx.orderId));
    expect(
      await getStorageBigInt(fx.diamondAddress, dynamicArrayDataSlot(20n))
    ).to.equal(merchantAddress);

    const duplicateKey = ethers.keccak256(
      ethers.concat([
        ethers.getBytes(fx.merchant.address),
        ethers.toUtf8Bytes("testbank"),
        ethers.toUtf8Bytes("1234"),
      ])
    );
    expect(
      await getStorageBigInt(
        fx.diamondAddress,
        mappingEntrySlot("bytes32", duplicateKey, 7n)
      )
    ).to.equal(1n);
  });

  it("round-trips nonzero synthetic sentinels through all three legacy mapping structs", async function () {
    const fx = await loadFixture(deployBaselineDiamond);
    const merchantKey = fx.other.address;
    const merchantRoot = mappingEntrySlot("address", merchantKey, 4n);
    const channelA = ethers.keccak256(ethers.toUtf8Bytes("channel-a"));
    const channelB = ethers.keccak256(ethers.toUtf8Bytes("channel-b"));

    await setStorageWord(
      fx.diamondAddress,
      merchantRoot,
      BigInt(merchantKey) | (2n << 160n) | (1n << 168n)
    );
    await setStorageWord(fx.diamondAddress, merchantRoot + 1n, 111n);
    await setStorageWord(fx.diamondAddress, merchantRoot + 2n, 1n);
    await setStorageWord(fx.diamondAddress, merchantRoot + 3n, 222n);
    await setStorageWord(fx.diamondAddress, merchantRoot + 5n, 333n);
    await setStorageWord(fx.diamondAddress, merchantRoot + 6n, 2n);
    await setStorageWord(fx.diamondAddress, merchantRoot + 7n, 44n);
    await setStorageWord(fx.diamondAddress, merchantRoot + 8n, 55n);
    const channelArrayRoot = dynamicArrayDataSlot(merchantRoot + 6n);
    await setStorageWord(fx.diamondAddress, channelArrayRoot, channelA);
    await setStorageWord(fx.diamondAddress, channelArrayRoot + 1n, channelB);

    const merchant = await fx.merchants.getMerchant(merchantKey);
    expect(merchant.wallet).to.equal(merchantKey);
    expect(merchant.accountStatus).to.equal(2n);
    expect(merchant.availability).to.equal(1n);
    expect(merchant.usdcLiquidity).to.equal(111n);
    expect(merchant.unstakePending).to.equal(true);
    expect(merchant.unstakeRequestedAmount).to.equal(222n);
    expect(merchant.telegramUsername).to.equal("");
    expect(merchant.registeredAt).to.equal(333n);
    expect([...merchant.channelIds]).to.deep.equal([channelA, channelB]);
    expect(merchant.reservedUsdc).to.equal(44n);
    expect(merchant.riskUsdc).to.equal(55n);

    const channelRoot = mappingEntrySlot("bytes32", channelA, 6n);
    await setStorageWord(fx.diamondAddress, channelRoot, channelA);
    await setStorageWord(fx.diamondAddress, channelRoot + 1n, merchantKey);
    await setStorageWord(
      fx.diamondAddress,
      channelRoot + 6n,
      3n | (1n << 8n)
    );
    for (let offset = 7n; offset <= 16n; offset++) {
      await setStorageWord(fx.diamondAddress, channelRoot + offset, offset * 100n);
    }

    const channel = await fx.merchants.getChannel(channelA);
    expect(channel.channelId).to.equal(channelA);
    expect(channel.merchant).to.equal(merchantKey);
    expect(channel.status).to.equal(3n);
    expect(channel.availability).to.equal(1n);
    expect(channel.fiatBalance).to.equal(700n);
    expect(channel.appliedAt).to.equal(800n);
    expect(channel.reviewedAt).to.equal(900n);
    expect(channel.__deprecated_dailyLimitUsdc).to.equal(1000n);
    expect(channel.__deprecated_monthlyLimitUsdc).to.equal(1100n);
    expect(channel.dailyVolumeUsed).to.equal(1200n);
    expect(channel.dailyWindowStart).to.equal(1300n);
    expect(channel.monthlyVolumeUsed).to.equal(1400n);
    expect(channel.monthlyWindowStart).to.equal(1500n);
    expect(channel.reservedFiat).to.equal(1600n);

    const orderId = ethers.keccak256(ethers.toUtf8Bytes("synthetic-order"));
    const orderRoot = mappingEntrySlot("bytes32", orderId, 15n);
    const packedOrderHead =
      1n | (4n << 8n) | (BigInt(fx.user.address) << 16n);
    const packedDispute =
      2n | (BigInt(fx.owner.address) << 8n) | (2n << 168n);
    await setStorageWord(fx.diamondAddress, orderRoot, orderId);
    await setStorageWord(fx.diamondAddress, orderRoot + 1n, packedOrderHead);
    await setStorageWord(fx.diamondAddress, orderRoot + 2n, merchantKey);
    await setStorageWord(fx.diamondAddress, orderRoot + 3n, channelA);
    for (let offset = 4n; offset <= 12n; offset++) {
      await setStorageWord(fx.diamondAddress, orderRoot + offset, offset * 10n);
    }
    await setStorageWord(fx.diamondAddress, orderRoot + 13n, packedDispute);
    await setStorageWord(fx.diamondAddress, orderRoot + 14n, 2n);
    await setStorageWord(fx.diamondAddress, orderRoot + 15n, 1n);
    const assignedRoot = dynamicArrayDataSlot(orderRoot + 14n);
    await setStorageWord(fx.diamondAddress, assignedRoot, fx.merchant.address);
    await setStorageWord(fx.diamondAddress, assignedRoot + 1n, fx.other.address);

    const order = await fx.orders.getOrder(orderId);
    expect(order.orderId).to.equal(orderId);
    expect(order.orderType).to.equal(1n);
    expect(order.status).to.equal(4n);
    expect(order.user).to.equal(fx.user.address);
    expect(order.merchant).to.equal(merchantKey);
    expect(order.channelId).to.equal(channelA);
    expect(order.usdcAmount).to.equal(40n);
    expect(order.fiatAmount).to.equal(50n);
    expect(order.price).to.equal(60n);
    expect(order.createdAt).to.equal(70n);
    expect(order.acceptedAt).to.equal(80n);
    expect(order.paidAt).to.equal(90n);
    expect(order.completedAt).to.equal(100n);
    expect(order.cancelledAt).to.equal(110n);
    expect(order.disputeExpiresAt).to.equal(120n);
    expect(order.disputeStatus).to.equal(2n);
    expect(order.disputeResolver).to.equal(fx.owner.address);
    expect(order.disputeResult).to.equal(2n);
    expect([...order.assignedMerchants]).to.deep.equal([
      fx.merchant.address,
      fx.other.address,
    ]);
    expect(order.riskReleased).to.equal(true);
    expect(Object.keys(order).includes("orderNumber")).to.equal(false);
  });

  it("locks the local Diamond storage root, facet array, and selector-position words", async function () {
    const fx = await loadFixture(deployBaselineDiamond);
    const diamondStorageRoot = BigInt(
      ethers.keccak256(
        ethers.toUtf8Bytes("diamond.standard.diamond.storage")
      )
    );
    expect(ethers.toBeHex(diamondStorageRoot, 32)).to.equal(
      "0xc8fcad8db84d3cc18b4c41d551ea0ee66dd599cde068d998e57d5e09332c131c"
    );

    expect(
      await getStorageBigInt(fx.diamondAddress, diamondStorageRoot)
    ).to.equal(0n);
    expect(
      await getStorageBigInt(fx.diamondAddress, diamondStorageRoot + 1n)
    ).to.equal(0n);
    expect(
      await getStorageBigInt(fx.diamondAddress, diamondStorageRoot + 2n)
    ).to.equal(6n);
    expect(
      await getStorageBigInt(fx.diamondAddress, diamondStorageRoot + 3n)
    ).to.equal(0n);
    expect(
      await getStorageBigInt(fx.diamondAddress, diamondStorageRoot + 4n)
    ).to.equal(BigInt(fx.owner.address));

    const facets = [
      fx.diamondCutFacet,
      fx.diamondLoupeFacet,
      fx.ownershipFacet,
      fx.configFacet,
      fx.merchantFacet,
      fx.orderFacet,
    ];
    const facetArrayRoot = dynamicArrayDataSlot(diamondStorageRoot + 2n);
    for (let index = 0; index < facets.length; index++) {
      const facetAddress = BigInt(await facets[index].getAddress());
      expect(
        await getStorageBigInt(
          fx.diamondAddress,
          facetArrayRoot + BigInt(index)
        )
      ).to.equal(facetAddress);

      const selectors = getSelectors(facets[index]);
      for (let position = 0; position < selectors.length; position++) {
        const selectorSlot = mappingEntrySlot(
          "bytes4",
          selectors[position],
          diamondStorageRoot
        );
        expect(
          await getStorageBigInt(fx.diamondAddress, selectorSlot)
        ).to.equal(facetAddress | (BigInt(position) << 160n));
      }
    }
  });
});
