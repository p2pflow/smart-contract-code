const path = require("path");
const fs = require("fs");
const { artifacts, ethers } = require("hardhat");
const { expect } = require("chai");

const FACETS = [
  {
    name: "DiamondCutFacet",
    source: "contracts/facets/DiamondCutFacet.sol",
    liveAddress: "0x13E3B3C63362B1cad5430c3745dC96130E7a5117",
    entries: [
      ["diamondCut((address,uint8,bytes4[])[],address,bytes)", "0x1f931c1c"],
    ],
  },
  {
    name: "DiamondLoupeFacet",
    source: "contracts/facets/DiamondLoupeFacet.sol",
    liveAddress: "0x3D50E8DF96e7F43a8570A9e54C42F8b559fffB58",
    entries: [
      ["facetAddress(bytes4)", "0xcdffacc6"],
      ["facetAddresses()", "0x52ef6b2c"],
      ["facetFunctionSelectors(address)", "0xadfca15e"],
      ["facets()", "0x7a0ed627"],
      ["supportsInterface(bytes4)", "0x01ffc9a7"],
    ],
  },
  {
    name: "OwnershipFacet",
    source: "contracts/facets/OwnershipFacet.sol",
    liveAddress: "0x2c63a6234D1a587D7b160FF96fF703c1097f7b30",
    entries: [
      ["owner()", "0x8da5cb5b"],
      ["transferOwnership(address)", "0xf2fde38b"],
    ],
  },
  {
    name: "ConfigFacet",
    source: "contracts/facets/ConfigFacet.sol",
    liveAddress: "0xcF9510e42511014FaB632238Dbf5250562C61D83",
    entries: [
      ["addEligibleMerchant(address)", "0x09ec0f24"],
      ["clearEligibleMerchants()", "0x3551ac6c"],
      ["getChannelLimitDefaults()", "0xbf284d84"],
      ["getConfig()", "0xc3f909d4"],
      ["getEligibleMerchants()", "0x2f583d4b"],
      ["getOrderPricing()", "0xab211bd9"],
      ["isEligibleMerchant(address)", "0x903eadc0"],
      ["pausePlatform()", "0x6b78c29b"],
      ["removeEligibleMerchant(address)", "0x6a96f84d"],
      ["setDefaultChannelLimits(uint256,uint256)", "0x892b8a9c"],
      ["setDisputeWindow(uint256)", "0x332226d0"],
      ["setMinMerchantStake(uint256)", "0x64ec2ceb"],
      ["setOrderPricing(uint256,uint256)", "0xf7260e6e"],
      ["transferPlatformAdmin(address)", "0x3397d9a2"],
      ["unpausePlatform()", "0x1a9ba7eb"],
    ],
  },
  {
    name: "MerchantFacet",
    source: "contracts/facets/MerchantFacet.sol",
    liveAddress: "0x2C1e028064c18aD316Fa8Fa69d1B328cC219E97D",
    entries: [
      ["addPaymentChannel(string,string,string,string)", "0x1fee2a96"],
      ["approveChannel(bytes32)", "0x3d58ff4a"],
      ["approveMerchantUnstake(address)", "0xbb634d55"],
      ["blacklistMerchant(address)", "0x30321dcc"],
      ["clearMerchantDispute(address)", "0xd91b0a8d"],
      ["depositStake(uint256)", "0xcb82cc8f"],
      ["getAllMerchants()", "0x8ce2df51"],
      ["getChannel(bytes32)", "0x831c2b82"],
      ["getChannelLimits(bytes32)", "0x5b020623"],
      ["getMerchant(address)", "0xb2734eaf"],
      ["getMerchantChannels(address)", "0xb4de411c"],
      ["getMyChannels()", "0xae180328"],
      ["getMyProfile()", "0x21527e50"],
      ["getPendingChannels()", "0x8307d08b"],
      ["goOffline()", "0xa6485ccd"],
      ["goOnline()", "0x6e5b676b"],
      ["migrateAndTerminate(bytes32,bytes32)", "0x0586296c"],
      ["registerMerchant(uint256,string)", "0xb00c52b0"],
      ["rejectChannel(bytes32)", "0x38a9f5df"],
      ["rejectMerchantUnstake(address)", "0x66d3b61c"],
      ["setMerchantDisputed(address)", "0x8e0540de"],
      ["setPaymentChannelActive(bytes32)", "0xb7889c93"],
      ["setPaymentChannelInactive(bytes32)", "0x1dcad144"],
      ["withdrawStake()", "0xbed9d861"],
    ],
  },
  {
    name: "OrderFacet",
    source: "contracts/facets/OrderFacet.sol",
    liveAddress: "0xCCA73B72b83FDccfBFe4294224c32ccc305df4Fb",
    entries: [
      ["acceptOrder(bytes32,bytes32)", "0xd6039a61"],
      ["cancelOrder(bytes32)", "0x7489ec23"],
      ["confirmPayment(bytes32)", "0x3611d088"],
      ["createBuyOrder(uint256)", "0x84ce1bfc"],
      ["createSellOrder(uint256)", "0x3c81c4b8"],
      ["getAssignedMerchants(bytes32)", "0x7372f2f1"],
      ["getChannelFiat(bytes32)", "0x1e3e148d"],
      ["getMerchantBalances(address)", "0xeb0817c5"],
      ["getMerchantOrders(address)", "0x4ebac543"],
      ["getOrder(bytes32)", "0x5778472a"],
      ["getOrderIds()", "0x9e0acf8f"],
      ["getUserOrders(address)", "0x63c69f08"],
      ["markPaymentSent(bytes32)", "0x3af1b286"],
      ["raiseDispute(bytes32)", "0xe14f5b7d"],
      ["resolveDispute(bytes32,uint8)", "0xb641237c"],
      ["settleOrder(bytes32)", "0x49085d8c"],
    ],
  },
];

const RUNTIMES = [
  {
    name: "Diamond",
    source: "contracts/Diamond.sol",
    size: 250,
    hash: "0x054daffcd2719790d6adf588677a3d33d1fed526c9f7df652982639c082fb2ac",
    cborHash:
      "0x4535c878a16129f2ac1307661bc33041f59ac1fdaeff011a83cc74e9485b0cf5",
  },
  {
    name: "DiamondCutFacet",
    source: "contracts/facets/DiamondCutFacet.sol",
    size: 4950,
    hash: "0x2424f646578e3de36e604b7e34216ce8897386fa839098c3c5b3ea673bc45882",
    cborHash:
      "0xdf6a1111b1b3e7213a554727266ccc829ffac30bfbcbe94f2d269e98729460d9",
  },
  {
    name: "DiamondLoupeFacet",
    source: "contracts/facets/DiamondLoupeFacet.sol",
    size: 1630,
    hash: "0x5014f72ae8c67eb0e572ea963fb29fa738ac907030beb07fc05ec4a2ae9d9fa2",
    cborHash:
      "0x737d321907b5fdb2440c11591f3d5ce4464d8639365322a15e1416fa4ad0436d",
  },
  {
    name: "OwnershipFacet",
    source: "contracts/facets/OwnershipFacet.sol",
    size: 584,
    hash: "0x17ec3cbff6f1fc9cee7a73c2088afd37c239942643991f82bf5c915983e2cca9",
    cborHash:
      "0x6ac070cedb80fdc1ae82ccc25e81f77b77e59a1abce4411da2bb4cc303a38f66",
  },
  {
    name: "ConfigFacet",
    source: "contracts/facets/ConfigFacet.sol",
    size: 3150,
    hash: "0xcfcc9996adf72d0bebab17b5695c21a14aa325057a3255ad4764b3242dde5a27",
    cborHash:
      "0xfb5b3d7b07bdae29f3b692b8e86cd2c2ffafb7e2ce0a3513eb40c8c71f531a38",
  },
  {
    name: "MerchantFacet",
    source: "contracts/facets/MerchantFacet.sol",
    size: 15997,
    hash: "0x30cc890cbb1341416dd68abfdf11802579ababd6a56ffdd0601dc96d0cfa2541",
    cborHash:
      "0xc29626e207c3706c7877e2391b21536da94566a3678f6a01e58bf6a69f2d882a",
  },
  {
    name: "OrderFacet",
    source: "contracts/facets/OrderFacet.sol",
    size: 11297,
    hash: "0xa31a0fef91f6d951ef4aff395a1273e6331248aff54bdd82342570168df354a6",
    cborHash:
      "0xfea11ff5a84e43d6d89558b1035605cc18b3059eb5acdc3a1f8d7300ca108db5",
  },
];

const TUPLES = {
  PlatformConfig: [
    ["admin", "address"],
    ["usdcToken", "address"],
    ["paused", "bool"],
    ["minMerchantStakeUsdc", "uint256"],
    ["initialized", "bool"],
  ],
  Merchant: [
    ["wallet", "address"],
    ["accountStatus", "uint8"],
    ["availability", "uint8"],
    ["usdcLiquidity", "uint256"],
    ["unstakePending", "bool"],
    ["unstakeRequestedAmount", "uint256"],
    ["telegramUsername", "string"],
    ["registeredAt", "uint256"],
    ["channelIds", "bytes32[]"],
    ["reservedUsdc", "uint256"],
    ["riskUsdc", "uint256"],
  ],
  PaymentChannel: [
    ["channelId", "bytes32"],
    ["merchant", "address"],
    ["bankName", "string"],
    ["accountLast4", "string"],
    ["upiId", "string"],
    ["label", "string"],
    ["status", "uint8"],
    ["availability", "uint8"],
    ["fiatBalance", "uint256"],
    ["appliedAt", "uint256"],
    ["reviewedAt", "uint256"],
    ["__deprecated_dailyLimitUsdc", "uint256"],
    ["__deprecated_monthlyLimitUsdc", "uint256"],
    ["dailyVolumeUsed", "uint256"],
    ["dailyWindowStart", "uint256"],
    ["monthlyVolumeUsed", "uint256"],
    ["monthlyWindowStart", "uint256"],
    ["reservedFiat", "uint256"],
  ],
  Order: [
    ["orderId", "bytes32"],
    ["orderType", "uint8"],
    ["status", "uint8"],
    ["user", "address"],
    ["merchant", "address"],
    ["channelId", "bytes32"],
    ["usdcAmount", "uint256"],
    ["fiatAmount", "uint256"],
    ["price", "uint256"],
    ["createdAt", "uint256"],
    ["acceptedAt", "uint256"],
    ["paidAt", "uint256"],
    ["completedAt", "uint256"],
    ["cancelledAt", "uint256"],
    ["disputeExpiresAt", "uint256"],
    ["disputeStatus", "uint8"],
    ["disputeResolver", "address"],
    ["disputeResult", "uint8"],
    ["assignedMerchants", "address[]"],
    ["riskReleased", "bool"],
  ],
};

const ENUMS = {
  MerchantAccountStatus: ["ACTIVE", "INACTIVE", "BLACKLISTED", "DISPUTED"],
  MerchantAvailability: ["ONLINE", "OFFLINE"],
  ChannelStatus: ["PENDING", "APPROVED", "REJECTED", "TERMINATED"],
  ChannelAvailability: ["ACTIVE", "INACTIVE"],
  OrderType: ["BUY", "SELL"],
  OrderStatus: ["CREATED", "ACCEPTED", "PAID", "COMPLETED", "CANCELLED"],
  DisputeStatus: ["NONE", "OPEN", "SETTLED"],
  DisputeResult: ["NONE", "USER_WINS", "MERCHANT_WINS"],
};

function fqn(source, name) {
  return `${source}:${name}`;
}

function artifactFunctionEntries(artifact) {
  return new ethers.Interface(artifact.abi).fragments
    .filter((fragment) => fragment.type === "function")
    .map((fragment) => {
      const signature = fragment.format("sighash");
      return [signature, ethers.id(signature).slice(0, 10)];
    });
}

function tupleComponents(artifact, functionName) {
  const item = artifact.abi.find(
    (entry) => entry.type === "function" && entry.name === functionName
  );
  expect(item, `${functionName} ABI entry`).to.not.equal(undefined);
  expect(item.outputs).to.have.length(1);
  expect(item.outputs[0].type).to.equal("tuple");
  return item.outputs[0].components.map(({ name, type }) => [name, type]);
}

function enumDefinitions(ast) {
  const definitions = {};
  function visit(node) {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    if (node.nodeType === "EnumDefinition") {
      definitions[node.name] = node.members.map((member) => member.name);
      return;
    }
    for (const child of Object.values(node)) visit(child);
  }
  visit(ast);
  return definitions;
}

function splitCborMetadata(bytecode) {
  const hex = bytecode.slice(2);
  const cborLengthBytes = Number.parseInt(hex.slice(-4), 16);
  const cborStart = hex.length - 4 - cborLengthBytes * 2;
  if (cborStart < 0) {
    throw new Error("Invalid Solidity CBOR length suffix");
  }
  return {
    cborLengthBytes,
    cbor: `0x${hex.slice(cborStart, hex.length - 4)}`,
    stripped: `0x${hex.slice(0, cborStart)}`,
  };
}

describe("Provenance — exact aa6f802 live-era artifacts", function () {
  let buildInfo;
  const artifactCache = new Map();

  before(async function () {
    buildInfo = await artifacts.getBuildInfo(
      "contracts/facets/OrderFacet.sol:OrderFacet"
    );
    expect(buildInfo, "OrderFacet build info").to.not.equal(undefined);

    for (const runtime of RUNTIMES) {
      artifactCache.set(
        runtime.name,
        await artifacts.readArtifact(fqn(runtime.source, runtime.name))
      );
    }
  });

  it("pins compiler, optimizer, EVM target, output selection, and dependency", function () {
    expect(buildInfo.solcVersion).to.equal("0.8.24");
    expect(buildInfo.solcLongVersion).to.equal(
      "0.8.24+commit.e11b9ed9"
    );
    expect(buildInfo.input.settings.optimizer).to.deep.equal({
      enabled: true,
      runs: 200,
    });
    expect(buildInfo.input.settings.evmVersion).to.equal("paris");
    expect(buildInfo.input.settings.outputSelection).to.deep.equal({
      "*": {
        "*": [
          "abi",
          "evm.bytecode",
          "evm.deployedBytecode",
          "evm.methodIdentifiers",
          "metadata",
          "storageLayout",
        ],
        "": ["ast"],
      },
    });

    const lockfile = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../package-lock.json"), "utf8")
    );
    expect(
      lockfile.packages["node_modules/@openzeppelin/contracts"].version
    ).to.equal("5.6.1");
  });

  it("matches proxy and all six facet runtime hashes including CBOR metadata", async function () {
    for (const expected of RUNTIMES) {
      const artifact = artifactCache.get(expected.name);
      const runtime = artifact.deployedBytecode;
      const metadata = splitCborMetadata(runtime);
      const compilerObject =
        buildInfo.output.contracts[expected.source][expected.name].evm
          .deployedBytecode.object;

      expect((runtime.length - 2) / 2, `${expected.name} runtime bytes`).to.equal(
        expected.size
      );
      expect(
        ethers.keccak256(runtime),
        `${expected.name} full runtime hash`
      ).to.equal(expected.hash);
      expect(metadata.cborLengthBytes, `${expected.name} CBOR bytes`).to.equal(
        51
      );
      expect(
        ethers.keccak256(metadata.cbor),
        `${expected.name} CBOR hash`
      ).to.equal(expected.cborHash);
      expect(runtime.toLowerCase()).to.equal(`0x${compilerObject}`.toLowerCase());
    }
  });

  it("matches the exact live selector/signature order and 1/5/2/15/24/16 totals", async function () {
    expect(FACETS).to.have.length(6);
    expect(FACETS.map((facet) => facet.entries.length)).to.deep.equal([
      1, 5, 2, 15, 24, 16,
    ]);

    for (const facet of FACETS) {
      expect(ethers.isAddress(facet.liveAddress)).to.equal(true);
      const artifact = await artifacts.readArtifact(fqn(facet.source, facet.name));
      expect(artifactFunctionEntries(artifact), facet.name).to.deep.equal(
        facet.entries
      );
    }
  });

  it("has exactly 63 collision-free selectors and every signature hashes to its recorded selector", function () {
    const ownerBySelector = new Map();
    for (const facet of FACETS) {
      for (const [signature, selector] of facet.entries) {
        expect(ethers.id(signature).slice(0, 10), signature).to.equal(selector);
        expect(
          ownerBySelector.has(selector),
          `${selector} collides between ${ownerBySelector.get(selector)} and ${facet.name}`
        ).to.equal(false);
        ownerBySelector.set(selector, facet.name);
      }
    }
    expect(ownerBySelector.size).to.equal(63);
  });

  it("preserves PlatformConfig(5), Merchant(11), PaymentChannel(18), and Order(20) ABI component order", async function () {
    const config = artifactCache.get("ConfigFacet");
    const merchant = artifactCache.get("MerchantFacet");
    const order = artifactCache.get("OrderFacet");

    expect(tupleComponents(config, "getConfig")).to.deep.equal(
      TUPLES.PlatformConfig
    );
    expect(tupleComponents(merchant, "getMerchant")).to.deep.equal(
      TUPLES.Merchant
    );
    expect(tupleComponents(merchant, "getChannel")).to.deep.equal(
      TUPLES.PaymentChannel
    );
    expect(tupleComponents(order, "getOrder")).to.deep.equal(TUPLES.Order);
  });

  it("locks the aa6 OrderCreated event and rejects the later orderNumber ABI generation", function () {
    const orderArtifact = artifactCache.get("OrderFacet");
    const event = orderArtifact.abi.find(
      (entry) => entry.type === "event" && entry.name === "OrderCreated"
    );
    expect(
      event.inputs.map(({ name, type, indexed }) => [name, type, indexed])
    ).to.deep.equal([
      ["orderId", "bytes32", true],
      ["user", "address", true],
      ["orderType", "uint8", false],
      ["usdcAmount", "uint256", false],
      ["fiatAmount", "uint256", false],
      ["price", "uint256", false],
      ["createdAt", "uint256", false],
    ]);
    expect(event.inputs.some((input) => input.name === "orderNumber")).to.equal(
      false
    );
    expect(
      tupleComponents(orderArtifact, "getOrder").some(
        ([name]) => name === "orderNumber"
      )
    ).to.equal(false);
  });

  it("locks every legacy enum ordinal, including FacetCutAction", async function () {
    const appStorageAst =
      buildInfo.output.sources["contracts/shared/AppStorage.sol"].ast;
    const actual = enumDefinitions(appStorageAst);

    for (const [enumName, members] of Object.entries(ENUMS)) {
      expect(actual[enumName], enumName).to.deep.equal(members);
      expect(
        Object.fromEntries(members.map((member, ordinal) => [member, ordinal])),
        `${enumName} ordinals`
      ).to.deep.equal(
        Object.fromEntries(
          actual[enumName].map((member, ordinal) => [member, ordinal])
        )
      );
    }

    const cutBuildInfo = await artifacts.getBuildInfo(
      "contracts/facets/DiamondCutFacet.sol:DiamondCutFacet"
    );
    const cutEnums = enumDefinitions(
      cutBuildInfo.output.sources["contracts/interfaces/IDiamondCut.sol"].ast
    );
    expect(cutEnums.FacetCutAction).to.deep.equal([
      "Add",
      "Replace",
      "Remove",
    ]);
  });
});
