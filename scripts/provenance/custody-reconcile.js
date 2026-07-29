#!/usr/bin/env node
"use strict";

const {
  EventFragment,
  FunctionFragment,
  Interface,
  ZeroAddress,
  ZeroHash,
  getAddress,
  isAddress,
  keccak256,
  toUtf8Bytes,
} = require("ethers");
const { AA6_READ_ABI } = require("./aa6-read-abi");
const {
  ERC20_READ_ABI,
  confirmPinnedBlock,
  ethCall,
  verifyLiveBaseline,
} = require("./live");
const { mapConcurrent } = require("./rpc");
const {
  controlledFailure,
  invariant,
  normalizeHex,
  outputJson,
  parseArgs,
  stableStringify,
} = require("./utils");

const ORDER_TYPES = ["BUY", "SELL"];
const ORDER_STATUSES = [
  "CREATED",
  "ACCEPTED",
  "PAID",
  "COMPLETED",
  "CANCELLED",
];
const MERCHANT_STATUSES = ["ACTIVE", "INACTIVE", "BLACKLISTED", "DISPUTED"];
const MERCHANT_AVAILABILITY = ["ONLINE", "OFFLINE"];
const CHANNEL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "TERMINATED"];
const CHANNEL_AVAILABILITY = ["ACTIVE", "INACTIVE"];
const DISPUTE_STATUSES = ["NONE", "OPEN", "SETTLED"];
const DISPUTE_RESULTS = ["NONE", "USER_WINS", "MERCHANT_WINS"];

function usage() {
  return [
    "Usage: node scripts/provenance/custody-reconcile.js [--block NUMBER] [--diamond ADDRESS] [--out FILE]",
    "",
    "Reconciles configured ERC-20 custody against aa6 merchant liquidity plus",
    "uncompleted SELL escrow, and cross-checks stored/derived reservation ledgers.",
    "The live chain, target, facet selectors, runtime hashes, and exact aa6 tuple",
    "shapes are mandatory gates. Payment strings and RPC URLs are never output.",
    "A reconciliation mismatch is emitted as JSON and exits with status 2.",
  ].join("\n");
}

function fragmentShape(fragment) {
  return fragment.inputs.map((input) => input.name);
}

function assertExactAa6Abi() {
  const merchantInterface = new Interface(AA6_READ_ABI.MerchantFacet);
  const orderInterface = new Interface(AA6_READ_ABI.OrderFacet);

  const expected = [
    {
      actual: FunctionFragment.from(orderInterface.getFunction("getOrder"))
        .outputs[0].components,
      context: "Order",
      names: [
        "orderId",
        "orderType",
        "status",
        "user",
        "merchant",
        "channelId",
        "usdcAmount",
        "fiatAmount",
        "price",
        "createdAt",
        "acceptedAt",
        "paidAt",
        "completedAt",
        "cancelledAt",
        "disputeExpiresAt",
        "disputeStatus",
        "disputeResolver",
        "disputeResult",
        "assignedMerchants",
        "riskReleased",
      ],
    },
    {
      actual: FunctionFragment.from(
        merchantInterface.getFunction("getMerchant")
      ).outputs[0].components,
      context: "Merchant",
      names: [
        "wallet",
        "accountStatus",
        "availability",
        "usdcLiquidity",
        "unstakePending",
        "unstakeRequestedAmount",
        "telegramUsername",
        "registeredAt",
        "channelIds",
        "reservedUsdc",
        "riskUsdc",
      ],
    },
    {
      actual: FunctionFragment.from(merchantInterface.getFunction("getChannel"))
        .outputs[0].components,
      context: "PaymentChannel",
      names: [
        "channelId",
        "merchant",
        "bankName",
        "accountLast4",
        "upiId",
        "label",
        "status",
        "availability",
        "fiatBalance",
        "appliedAt",
        "reviewedAt",
        "__deprecated_dailyLimitUsdc",
        "__deprecated_monthlyLimitUsdc",
        "dailyVolumeUsed",
        "dailyWindowStart",
        "monthlyVolumeUsed",
        "monthlyWindowStart",
        "reservedFiat",
      ],
    },
  ];

  for (const item of expected) {
    invariant(
      item.actual &&
        JSON.stringify(item.actual.map((component) => component.name)) ===
          JSON.stringify(item.names),
      "AA6_ABI_SHAPE_MISMATCH",
      `${item.context} tuple does not match the exact aa6 layout`
    );
  }

  const created = EventFragment.from(orderInterface.getEvent("OrderCreated"));
  invariant(
    JSON.stringify(fragmentShape(created)) ===
      JSON.stringify([
        "orderId",
        "user",
        "orderType",
        "usdcAmount",
        "fiatAmount",
        "price",
        "createdAt",
      ]),
    "AA6_ABI_SHAPE_MISMATCH",
    "OrderCreated event does not match exact aa6 (orderNumber must be absent)"
  );

  return {
    embeddedMerchantReadAbiHash: keccak256(
      toUtf8Bytes(stableStringify(AA6_READ_ABI.MerchantFacet).trimEnd())
    ),
    embeddedOrderReadAbiHash: keccak256(
      toUtf8Bytes(stableStringify(AA6_READ_ABI.OrderFacet).trimEnd())
    ),
    exactAa6FullMerchantArtifactAbiHash:
      "0x62f815e60687413407a371e9947be56fc57907eaec5881fb32e2d687d9fad5a1",
    exactAa6FullOrderArtifactAbiHash:
      "0x63d7d7b5e3407db23c38f23bb3794287e8916a99e0e279be0b3f45df6030292d",
    orderCreatedInputCount: created.inputs.length,
    orderTupleFieldCount: expected[0].actual.length,
    paymentChannelTupleFieldCount: expected[2].actual.length,
    merchantTupleFieldCount: expected[1].actual.length,
  };
}

function enumValue(value, labels, context) {
  const number = Number(value);
  invariant(
    Number.isSafeInteger(number) && number >= 0 && number < labels.length,
    "ENUM_OUT_OF_RANGE",
    `${context} enum value is outside the exact aa6 range`
  );
  return { name: labels[number], value: number };
}

function bytes32(value, context) {
  const normalized = normalizeHex(value);
  invariant(
    /^0x[0-9a-f]{64}$/.test(normalized),
    "BAD_BYTES32_RESPONSE",
    `${context} is not bytes32`
  );
  return normalized;
}

function address(value, context) {
  invariant(
    isAddress(value),
    "BAD_ADDRESS_RESPONSE",
    `${context} is not an address`
  );
  return getAddress(value);
}

function sum(items, selector) {
  return items.reduce((total, item) => total + selector(item), 0n);
}

function addTo(map, key, value) {
  map.set(key, (map.get(key) || 0n) + value);
}

function equalityAnomalies(records, storedField, derivedMap, identityField) {
  return records
    .filter(
      (record) =>
        record[storedField] !==
        (derivedMap.get(record[identityField].toLowerCase()) || 0n)
    )
    .map((record) => ({
      actual: record[storedField],
      expected: derivedMap.get(record[identityField].toLowerCase()) || 0n,
      id: record[identityField],
    }));
}

async function fetchState(verified) {
  const merchantInterface = new Interface(AA6_READ_ABI.MerchantFacet);
  const orderInterface = new Interface(AA6_READ_ABI.OrderFacet);
  const configInterface = new Interface(AA6_READ_ABI.ConfigFacet);
  const tokenInterface = new Interface(ERC20_READ_ABI);
  const { block, diamond, rpc } = verified;

  const [configResult, merchantListResult, orderIdsResult] = await Promise.all([
    ethCall(rpc, block.tag, diamond, configInterface, "getConfig"),
    ethCall(rpc, block.tag, diamond, merchantInterface, "getAllMerchants"),
    ethCall(rpc, block.tag, diamond, orderInterface, "getOrderIds"),
  ]);

  const configTuple = configResult[0];
  const token = address(
    configTuple.usdcToken ?? configTuple[1],
    "configured token"
  );
  const merchantAddresses = [...merchantListResult[0]].map((item) =>
    address(item, "merchant list item")
  );
  const orderIds = [...orderIdsResult[0]].map((item) =>
    bytes32(item, "order ID")
  );

  const merchantTuples = await mapConcurrent(
    merchantAddresses,
    8,
    async (wallet) => {
      const result = await ethCall(
        rpc,
        block.tag,
        diamond,
        merchantInterface,
        "getMerchant",
        [wallet]
      );
      return result[0];
    }
  );

  const merchants = merchantTuples.map((tuple, index) => {
    const wallet = address(tuple.wallet ?? tuple[0], "merchant wallet");
    const channelIds = [...(tuple.channelIds ?? tuple[8])].map((item) =>
      bytes32(item, "merchant channel ID")
    );
    return {
      accountStatus: enumValue(
        tuple.accountStatus ?? tuple[1],
        MERCHANT_STATUSES,
        "merchant account status"
      ),
      availability: enumValue(
        tuple.availability ?? tuple[2],
        MERCHANT_AVAILABILITY,
        "merchant availability"
      ),
      channelIds,
      listedAddress: merchantAddresses[index],
      registeredAt: tuple.registeredAt ?? tuple[7],
      reservedUsdc: tuple.reservedUsdc ?? tuple[9],
      riskUsdc: tuple.riskUsdc ?? tuple[10],
      unreservedUsdc:
        (tuple.usdcLiquidity ?? tuple[3]) -
        (tuple.reservedUsdc ?? tuple[9]) -
        (tuple.riskUsdc ?? tuple[10]),
      unstakePending: Boolean(tuple.unstakePending ?? tuple[4]),
      unstakeRequestedAmount: tuple.unstakeRequestedAmount ?? tuple[5],
      usdcLiquidity: tuple.usdcLiquidity ?? tuple[3],
      wallet,
    };
  });

  const channelReferences = merchants.flatMap((merchant) =>
    merchant.channelIds.map((channelId) => ({
      channelId,
      listedMerchant: merchant.wallet,
    }))
  );
  const uniqueChannelIds = [
    ...new Set(channelReferences.map((item) => item.channelId)),
  ].sort();
  const channelTuples = await mapConcurrent(
    uniqueChannelIds,
    8,
    async (channelId) => {
      const result = await ethCall(
        rpc,
        block.tag,
        diamond,
        merchantInterface,
        "getChannel",
        [channelId]
      );
      return result[0];
    }
  );

  // Deliberately omit decoded bankName, accountLast4, upiId, and label.
  const channels = channelTuples.map((tuple, index) => ({
    appliedAt: tuple.appliedAt ?? tuple[9],
    availability: enumValue(
      tuple.availability ?? tuple[7],
      CHANNEL_AVAILABILITY,
      "channel availability"
    ),
    channelId: bytes32(tuple.channelId ?? tuple[0], "channel record ID"),
    dailyVolumeUsed: tuple.dailyVolumeUsed ?? tuple[13],
    fiatBalance: tuple.fiatBalance ?? tuple[8],
    listedChannelId: uniqueChannelIds[index],
    merchant: address(tuple.merchant ?? tuple[1], "channel merchant"),
    monthlyVolumeUsed: tuple.monthlyVolumeUsed ?? tuple[15],
    reservedFiat: tuple.reservedFiat ?? tuple[17],
    reviewedAt: tuple.reviewedAt ?? tuple[10],
    status: enumValue(
      tuple.status ?? tuple[6],
      CHANNEL_STATUSES,
      "channel status"
    ),
    unreservedFiat:
      (tuple.fiatBalance ?? tuple[8]) - (tuple.reservedFiat ?? tuple[17]),
  }));

  const orderTuples = await mapConcurrent(orderIds, 8, async (orderId) => {
    const result = await ethCall(
      rpc,
      block.tag,
      diamond,
      orderInterface,
      "getOrder",
      [orderId]
    );
    return result[0];
  });

  const orders = orderTuples.map((tuple, index) => ({
    channelId: bytes32(tuple.channelId ?? tuple[5], "order channel ID"),
    disputeResult: enumValue(
      tuple.disputeResult ?? tuple[17],
      DISPUTE_RESULTS,
      "dispute result"
    ),
    disputeStatus: enumValue(
      tuple.disputeStatus ?? tuple[15],
      DISPUTE_STATUSES,
      "dispute status"
    ),
    fiatAmount: tuple.fiatAmount ?? tuple[7],
    listedOrderId: orderIds[index],
    merchant: address(tuple.merchant ?? tuple[4], "order merchant"),
    orderId: bytes32(tuple.orderId ?? tuple[0], "order record ID"),
    orderType: enumValue(
      tuple.orderType ?? tuple[1],
      ORDER_TYPES,
      "order type"
    ),
    price: tuple.price ?? tuple[8],
    riskReleased: Boolean(tuple.riskReleased ?? tuple[19]),
    status: enumValue(tuple.status ?? tuple[2], ORDER_STATUSES, "order status"),
    usdcAmount: tuple.usdcAmount ?? tuple[6],
  }));

  const tokenCode = normalizeHex(
    await rpc.request("eth_getCode", [token, block.tag])
  );
  invariant(
    tokenCode !== "0x",
    "TOKEN_CODE_MISSING",
    "Configured token has no runtime code"
  );
  const balanceResult = await ethCall(
    rpc,
    block.tag,
    token,
    tokenInterface,
    "balanceOf",
    [diamond]
  );

  return {
    channels,
    config: {
      admin: address(configTuple.admin ?? configTuple[0], "config admin"),
      initialized: Boolean(configTuple.initialized ?? configTuple[4]),
      minMerchantStakeUsdc: configTuple.minMerchantStakeUsdc ?? configTuple[3],
      paused: Boolean(configTuple.paused ?? configTuple[2]),
      token,
    },
    merchantAddresses,
    merchants,
    orders,
    token: {
      actualBalance: balanceResult[0],
      address: token,
      runtimeHash: keccak256(tokenCode),
    },
    channelReferences,
  };
}

function reconcile(state) {
  const findings = [];
  const addFinding = (id, ok, details = {}) =>
    findings.push({ id, ok, ...details });

  const listedMerchantSet = new Set(
    state.merchantAddresses.map((item) => item.toLowerCase())
  );
  addFinding(
    "merchant-list-unique",
    listedMerchantSet.size === state.merchantAddresses.length,
    {
      actualUnique: listedMerchantSet.size,
      expectedUnique: state.merchantAddresses.length,
    }
  );

  const walletMismatches = state.merchants
    .filter(
      (merchant) =>
        merchant.wallet.toLowerCase() !== merchant.listedAddress.toLowerCase()
    )
    .map((merchant) => ({
      listed: merchant.listedAddress,
      stored: merchant.wallet,
    }));
  addFinding("merchant-wallet-integrity", walletMismatches.length === 0, {
    anomalies: walletMismatches,
  });

  const merchantPartitionAnomalies = state.merchants
    .filter(
      (merchant) =>
        merchant.reservedUsdc + merchant.riskUsdc > merchant.usdcLiquidity ||
        merchant.unreservedUsdc < 0n
    )
    .map((merchant) => ({
      reservedUsdc: merchant.reservedUsdc,
      riskUsdc: merchant.riskUsdc,
      usdcLiquidity: merchant.usdcLiquidity,
      wallet: merchant.wallet,
    }));
  addFinding(
    "merchant-usdc-partitions",
    merchantPartitionAnomalies.length === 0,
    {
      anomalies: merchantPartitionAnomalies,
    }
  );

  const channelReferenceSet = new Set(
    state.channelReferences.map((reference) => reference.channelId)
  );
  addFinding(
    "channel-list-unique",
    channelReferenceSet.size === state.channelReferences.length,
    {
      actualUnique: channelReferenceSet.size,
      expectedUnique: state.channelReferences.length,
    }
  );

  const referenceOwner = new Map();
  for (const reference of state.channelReferences) {
    if (!referenceOwner.has(reference.channelId)) {
      referenceOwner.set(reference.channelId, reference.listedMerchant);
    }
  }
  const channelRecordAnomalies = state.channels
    .filter(
      (channel) =>
        channel.channelId !== channel.listedChannelId ||
        !referenceOwner.has(channel.listedChannelId) ||
        channel.merchant.toLowerCase() !==
          referenceOwner.get(channel.listedChannelId).toLowerCase()
    )
    .map((channel) => ({
      channelId: channel.listedChannelId,
      expectedMerchant: referenceOwner.get(channel.listedChannelId),
      storedChannelId: channel.channelId,
      storedMerchant: channel.merchant,
    }));
  addFinding("channel-record-integrity", channelRecordAnomalies.length === 0, {
    anomalies: channelRecordAnomalies,
  });

  const channelPartitionAnomalies = state.channels
    .filter(
      (channel) =>
        channel.reservedFiat > channel.fiatBalance ||
        channel.unreservedFiat < 0n
    )
    .map((channel) => ({
      channelId: channel.channelId,
      fiatBalance: channel.fiatBalance,
      reservedFiat: channel.reservedFiat,
    }));
  addFinding(
    "channel-fiat-partitions",
    channelPartitionAnomalies.length === 0,
    {
      anomalies: channelPartitionAnomalies,
    }
  );

  const listedOrderIds = state.orders.map((order) => order.listedOrderId);
  const listedOrderSet = new Set(listedOrderIds);
  addFinding(
    "order-list-unique",
    listedOrderSet.size === listedOrderIds.length,
    {
      actualUnique: listedOrderSet.size,
      expectedUnique: listedOrderIds.length,
    }
  );

  const orderIdAnomalies = state.orders
    .filter((order) => order.orderId !== order.listedOrderId)
    .map((order) => ({
      listed: order.listedOrderId,
      stored: order.orderId,
    }));
  addFinding("order-id-integrity", orderIdAnomalies.length === 0, {
    anomalies: orderIdAnomalies,
  });

  const knownMerchant = new Set(
    state.merchants.map((merchant) => merchant.wallet.toLowerCase())
  );
  const knownChannel = new Map(
    state.channels.map((channel) => [
      channel.channelId,
      channel.merchant.toLowerCase(),
    ])
  );
  const relationshipAnomalies = state.orders
    .filter((order) => {
      if (order.status.value === 0 || order.status.value === 4) return false;
      return (
        order.merchant === ZeroAddress ||
        order.channelId === ZeroHash ||
        !knownMerchant.has(order.merchant.toLowerCase()) ||
        knownChannel.get(order.channelId) !== order.merchant.toLowerCase()
      );
    })
    .map((order) => ({
      channelId: order.channelId,
      merchant: order.merchant,
      orderId: order.orderId,
      status: order.status.name,
    }));
  addFinding("active-order-relationships", relationshipAnomalies.length === 0, {
    anomalies: relationshipAnomalies,
  });

  const derivedReservedUsdc = new Map();
  const derivedRiskUsdc = new Map();
  const derivedReservedFiat = new Map();
  let outstandingSellEscrow = 0n;
  const openSellEscrows = [];

  for (const order of state.orders) {
    if (
      order.orderType.value === 0 &&
      (order.status.value === 1 || order.status.value === 2)
    ) {
      addTo(
        derivedReservedUsdc,
        order.merchant.toLowerCase(),
        order.usdcAmount
      );
    }
    if (
      order.orderType.value === 1 &&
      order.status.value === 3 &&
      !order.riskReleased
    ) {
      addTo(derivedRiskUsdc, order.merchant.toLowerCase(), order.usdcAmount);
    }
    if (
      order.orderType.value === 1 &&
      (order.status.value === 1 || order.status.value === 2)
    ) {
      addTo(derivedReservedFiat, order.channelId, order.fiatAmount);
    }
    if (order.orderType.value === 1 && order.status.value <= 2) {
      outstandingSellEscrow += order.usdcAmount;
      openSellEscrows.push({
        orderId: order.orderId,
        status: order.status.name,
        usdcAmount: order.usdcAmount,
      });
    }
  }

  const reservedMismatches = equalityAnomalies(
    state.merchants,
    "reservedUsdc",
    derivedReservedUsdc,
    "wallet"
  );
  addFinding(
    "merchant-reserved-usdc-derived",
    reservedMismatches.length === 0,
    {
      anomalies: reservedMismatches,
    }
  );

  const riskMismatches = equalityAnomalies(
    state.merchants,
    "riskUsdc",
    derivedRiskUsdc,
    "wallet"
  );
  addFinding("merchant-risk-usdc-derived", riskMismatches.length === 0, {
    anomalies: riskMismatches,
  });

  const fiatMismatches = state.channels
    .filter(
      (channel) =>
        channel.reservedFiat !==
        (derivedReservedFiat.get(channel.channelId) || 0n)
    )
    .map((channel) => ({
      actual: channel.reservedFiat,
      channelId: channel.channelId,
      expected: derivedReservedFiat.get(channel.channelId) || 0n,
    }));
  addFinding("channel-reserved-fiat-derived", fiatMismatches.length === 0, {
    anomalies: fiatMismatches,
  });

  const merchantLiquidity = sum(
    state.merchants,
    (merchant) => merchant.usdcLiquidity
  );
  const expectedTokenBalance = merchantLiquidity + outstandingSellEscrow;
  const custodyDelta = state.token.actualBalance - expectedTokenBalance;
  addFinding("erc20-custody", custodyDelta === 0n, {
    actual: state.token.actualBalance,
    delta: custodyDelta,
    expected: expectedTokenBalance,
    merchantLiquidity,
    outstandingSellEscrow,
  });

  const orderSummary = {};
  for (const orderType of ORDER_TYPES) {
    orderSummary[orderType] = {};
    for (const status of ORDER_STATUSES) {
      const matching = state.orders.filter(
        (order) =>
          order.orderType.name === orderType && order.status.name === status
      );
      orderSummary[orderType][status] = {
        count: matching.length,
        fiatAmount: sum(matching, (order) => order.fiatAmount),
        usdcAmount: sum(matching, (order) => order.usdcAmount),
      };
    }
  }

  return {
    aggregates: {
      channelCount: state.channels.length,
      fiatBalance: sum(state.channels, (channel) => channel.fiatBalance),
      merchantCount: state.merchants.length,
      merchantLiquidity,
      orderCount: state.orders.length,
      outstandingSellEscrow,
      reservedFiat: sum(state.channels, (channel) => channel.reservedFiat),
      reservedUsdc: sum(state.merchants, (merchant) => merchant.reservedUsdc),
      riskUsdc: sum(state.merchants, (merchant) => merchant.riskUsdc),
    },
    custody: {
      actualTokenBalance: state.token.actualBalance,
      delta: custodyDelta,
      expectedTokenBalance,
      merchantLiquidity,
      outstandingSellEscrow,
    },
    findings,
    ok: findings.every((finding) => finding.ok),
    openSellEscrows,
    orderSummary,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    boolean: ["help"],
    value: ["block", "diamond", "out"],
  });
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const abiAttestation = assertExactAa6Abi();
  const verified = await verifyLiveBaseline({
    block: args.block,
    diamond: args.diamond,
  });
  const state = await fetchState(verified);
  await confirmPinnedBlock(verified);
  const reconciliation = reconcile(state);
  outputJson(
    {
      abiAttestation,
      baseline: "aa6f802",
      block: {
        hash: verified.block.hash,
        number: verified.block.number,
        timestamp: verified.block.timestamp,
      },
      chainId: verified.chainId,
      config: state.config,
      diamond: verified.diamond,
      kind: "p2pflow-aa6-custody-reconciliation",
      paymentStringsIncluded: false,
      reconciliation,
      rpcSource: verified.rpcSource,
      runtimeAttestations: verified.code,
      sanitized: true,
      schemaVersion: 1,
      token: state.token,
    },
    args.out
  );
  if (!reconciliation.ok) process.exitCode = 2;
}

main().catch(controlledFailure);
