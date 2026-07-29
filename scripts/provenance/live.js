"use strict";

const { Interface, getAddress, id, isAddress, keccak256 } = require("ethers");
const { AA6_READ_ABI } = require("./aa6-read-abi");
const {
  AA6_FUNCTION_SIGNATURES,
  CHAIN_ID,
  DIAMOND_ADDRESS,
  ROUTED_BASELINE,
  BASELINE_CONTRACTS,
} = require("./constants");
const {
  RpcClient,
  mapConcurrent,
  pinBlock,
  resolveRpcConfig,
} = require("./rpc");
const { invariant, normalizeHex } = require("./utils");

const ERC20_READ_ABI = AA6_READ_ABI.ERC20;

function sameAddress(left, right) {
  return left.toLowerCase() === right.toLowerCase();
}

function normalizeAddress(value, context) {
  invariant(
    isAddress(value),
    "BAD_ADDRESS_RESPONSE",
    `${context} returned an invalid address`
  );
  return getAddress(value);
}

function resolveDiamond(argument) {
  const supplied = argument || DIAMOND_ADDRESS;
  invariant(
    isAddress(supplied),
    "WRONG_TARGET",
    "--diamond is not a valid address"
  );
  const normalized = getAddress(supplied);
  invariant(
    sameAddress(normalized, DIAMOND_ADDRESS),
    "WRONG_TARGET",
    `Target must be the authorized Base Sepolia Diamond ${DIAMOND_ADDRESS}`
  );
  return getAddress(DIAMOND_ADDRESS);
}

function facetSelectors(entry) {
  const signatures = AA6_FUNCTION_SIGNATURES[entry.contractName];
  invariant(
    signatures,
    "AA6_SIGNATURES_MISSING",
    `${entry.contractName} signatures are missing`
  );
  return signatures
    .map((signature) => id(signature).slice(0, 10).toLowerCase())
    .sort();
}

async function ethCall(rpc, blockTag, target, iface, functionName, args = []) {
  const data = iface.encodeFunctionData(functionName, args);
  const raw = await rpc.request("eth_call", [{ data, to: target }, blockTag]);
  invariant(
    typeof raw === "string" && /^0x[0-9a-fA-F]*$/.test(raw),
    "BAD_CALL_RESPONSE",
    `${functionName} returned invalid call data`
  );
  try {
    return iface.decodeFunctionResult(functionName, raw);
  } catch {
    invariant(
      false,
      "ABI_DECODE_FAILED",
      `${functionName} did not match the exact aa6 ABI`
    );
  }
}

async function verifyLiveBaseline(options = {}) {
  const diamond = resolveDiamond(options.diamond);
  const rpcConfig = resolveRpcConfig();
  const rpc = new RpcClient(rpcConfig.endpoint, {
    timeoutMs: options.timeoutMs,
  });

  const chainHex = await rpc.request("eth_chainId");
  invariant(
    typeof chainHex === "string" && /^0x[0-9a-fA-F]+$/.test(chainHex),
    "BAD_CHAIN_RESPONSE",
    "RPC returned an invalid chain ID"
  );
  const chainId = BigInt(chainHex);
  invariant(
    chainId === CHAIN_ID,
    "WRONG_CHAIN",
    `RPC chain ID must be ${CHAIN_ID.toString()}`
  );

  const block = await pinBlock(rpc, options.block);
  const loupeInterface = new Interface(AA6_READ_ABI.DiamondLoupeFacet);
  const facetsResult = await ethCall(
    rpc,
    block.tag,
    diamond,
    loupeInterface,
    "facets"
  );
  const liveFacets = facetsResult[0];
  invariant(
    liveFacets.length === ROUTED_BASELINE.length,
    "LIVE_FACET_COUNT_MISMATCH",
    `Live Diamond must expose ${ROUTED_BASELINE.length} facets`
  );

  const liveByAddress = new Map();
  for (const facet of liveFacets) {
    const address = normalizeAddress(
      facet.facetAddress || facet[0],
      "facets()"
    );
    const selectors = [...(facet.functionSelectors || facet[1])]
      .map(normalizeHex)
      .sort();
    invariant(
      !liveByAddress.has(address.toLowerCase()),
      "DUPLICATE_LIVE_FACET",
      "Live loupe returned a duplicate facet address"
    );
    liveByAddress.set(address.toLowerCase(), { address, selectors });
  }

  const expectedAddresses = new Set(
    ROUTED_BASELINE.map((entry) => entry.address.toLowerCase())
  );
  for (const address of liveByAddress.keys()) {
    invariant(
      expectedAddresses.has(address),
      "UNEXPECTED_LIVE_FACET",
      "Live Diamond exposes a facet address outside the exact aa6 baseline"
    );
  }

  const codeTargets = BASELINE_CONTRACTS.map((entry) => ({
    address: entry.address,
    contractName: entry.contractName,
    expectedHash: entry.runtimeHash,
  }));
  const codeResults = await mapConcurrent(codeTargets, 4, async (entry) => {
    const code = await rpc.request("eth_getCode", [entry.address, block.tag]);
    const normalizedCode = normalizeHex(code);
    invariant(
      normalizedCode !== "0x",
      "MISSING_LIVE_CODE",
      `${entry.contractName} has no runtime code`
    );
    const runtimeHash = keccak256(normalizedCode);
    invariant(
      runtimeHash === entry.expectedHash,
      "LIVE_RUNTIME_HASH_MISMATCH",
      `${entry.contractName} runtime hash does not match the exact aa6 baseline`
    );
    return {
      address: getAddress(entry.address),
      contractName: entry.contractName,
      runtimeBytes: (normalizedCode.length - 2) / 2,
      runtimeHash,
    };
  });

  const verifiedFacets = [];
  for (const expected of ROUTED_BASELINE) {
    const live = liveByAddress.get(expected.address.toLowerCase());
    invariant(
      live,
      "MISSING_LIVE_FACET",
      `${expected.contractName} is not routed live`
    );
    const expectedSelectors = facetSelectors(expected);
    invariant(
      JSON.stringify(live.selectors) === JSON.stringify(expectedSelectors),
      "LIVE_SELECTOR_MISMATCH",
      `${expected.contractName} selectors do not match the exact aa6 ABI`
    );
    invariant(
      live.selectors.length === expected.selectorCount,
      "LIVE_SELECTOR_COUNT_MISMATCH",
      `${expected.contractName} live selector count is incorrect`
    );
    verifiedFacets.push({
      address: live.address,
      contractName: expected.contractName,
      runtimeHash: expected.runtimeHash,
      selectorCount: live.selectors.length,
      selectors: live.selectors,
    });
  }

  return {
    block,
    chainId,
    code: codeResults,
    diamond,
    facets: verifiedFacets,
    rpc,
    rpcSource: rpcConfig.source,
  };
}

async function readPublicState(verified) {
  const { block, diamond, rpc } = verified;
  const configInterface = new Interface(AA6_READ_ABI.ConfigFacet);
  const merchantInterface = new Interface(AA6_READ_ABI.MerchantFacet);
  const orderInterface = new Interface(AA6_READ_ABI.OrderFacet);
  const ownershipInterface = new Interface(AA6_READ_ABI.OwnershipFacet);
  const tokenInterface = new Interface(ERC20_READ_ABI);

  const [
    ownerResult,
    configResult,
    limitsResult,
    pricingResult,
    eligibleResult,
    merchantResult,
    orderResult,
  ] = await Promise.all([
    ethCall(rpc, block.tag, diamond, ownershipInterface, "owner"),
    ethCall(rpc, block.tag, diamond, configInterface, "getConfig"),
    ethCall(
      rpc,
      block.tag,
      diamond,
      configInterface,
      "getChannelLimitDefaults"
    ),
    ethCall(rpc, block.tag, diamond, configInterface, "getOrderPricing"),
    ethCall(rpc, block.tag, diamond, configInterface, "getEligibleMerchants"),
    ethCall(rpc, block.tag, diamond, merchantInterface, "getAllMerchants"),
    ethCall(rpc, block.tag, diamond, orderInterface, "getOrderIds"),
  ]);

  const config = configResult[0];
  const token = normalizeAddress(config.usdcToken || config[1], "getConfig()");
  const tokenCode = normalizeHex(
    await rpc.request("eth_getCode", [token, block.tag])
  );
  invariant(
    tokenCode !== "0x",
    "TOKEN_CODE_MISSING",
    "Configured USDC token has no runtime code"
  );
  const tokenBalanceResult = await ethCall(
    rpc,
    block.tag,
    token,
    tokenInterface,
    "balanceOf",
    [diamond]
  );

  return {
    channelLimits: {
      dailyUsdc: limitsResult.dailyUsdc ?? limitsResult[0],
      monthlyUsdc: limitsResult.monthlyUsdc ?? limitsResult[1],
    },
    config: {
      admin: normalizeAddress(config.admin || config[0], "getConfig()"),
      initialized: Boolean(config.initialized ?? config[4]),
      minMerchantStakeUsdc: config.minMerchantStakeUsdc ?? config[3],
      paused: Boolean(config.paused ?? config[2]),
      usdcToken: token,
    },
    counts: {
      eligibleMerchants: eligibleResult[0].length,
      merchants: merchantResult[0].length,
      orders: orderResult[0].length,
    },
    owner: normalizeAddress(ownerResult.owner_ || ownerResult[0], "owner()"),
    pricing: {
      buyPriceInrPerUsdc: pricingResult.buyPriceInrPerUsdc ?? pricingResult[0],
      disputeWindowSeconds:
        pricingResult.disputeWindowSeconds ?? pricingResult[2],
      sellPriceInrPerUsdc:
        pricingResult.sellPriceInrPerUsdc ?? pricingResult[1],
    },
    tokenCustody: {
      balanceAtDiamond: tokenBalanceResult[0],
      runtimeHash: keccak256(tokenCode),
      token,
    },
  };
}

async function confirmPinnedBlock(verified) {
  const block = await verified.rpc.request("eth_getBlockByNumber", [
    verified.block.tag,
    false,
  ]);
  invariant(
    block &&
      typeof block.hash === "string" &&
      block.hash.toLowerCase() === verified.block.hash,
    "PINNED_BLOCK_REORGED",
    "Pinned block hash changed during the snapshot"
  );
}

module.exports = {
  ERC20_READ_ABI,
  confirmPinnedBlock,
  ethCall,
  readPublicState,
  resolveDiamond,
  verifyLiveBaseline,
};
