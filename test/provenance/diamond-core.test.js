const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const { expect } = require("chai");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const {
  FacetCutAction,
  deploy,
  deployBaselineDiamond,
  getSelectors,
} = require("./helpers");

const DECIMALS_SELECTOR = ethers.id("decimals()").slice(0, 10);
const UNKNOWN_SELECTOR = "0xdeadbeef";

function oneSelectorCut(facetAddress, action, selector = DECIMALS_SELECTOR) {
  return [
    {
      facetAddress,
      action,
      functionSelectors: [selector],
    },
  ];
}

describe("Provenance — Diamond cut and initializer regressions", function () {
  it("deploys the exact 1/5/2/15/24/16 local routing shape and never routes DiamondInit", async function () {
    const fx = await loadFixture(deployBaselineDiamond);
    const expectedFacets = [
      fx.diamondCutFacet,
      fx.diamondLoupeFacet,
      fx.ownershipFacet,
      fx.configFacet,
      fx.merchantFacet,
      fx.orderFacet,
    ];
    const addresses = await fx.loupe.facetAddresses();

    expect(addresses).to.deep.equal(
      await Promise.all(expectedFacets.map((facet) => facet.getAddress()))
    );
    expect(
      await Promise.all(
        addresses.map(async (address) => [
          ...(await fx.loupe.facetFunctionSelectors(address)),
        ])
      )
    ).to.deep.equal(expectedFacets.map((facet) => getSelectors(facet)));
    expect(expectedFacets.map((facet) => getSelectors(facet).length)).to.deep.equal(
      [1, 5, 2, 15, 24, 16]
    );

    const initSelector = fx.diamondInit.interface.getFunction("init").selector;
    expect(await fx.loupe.facetAddress(initSelector)).to.equal(
      ethers.ZeroAddress
    );
    expect(addresses).to.not.include(await fx.diamondInit.getAddress());
  });

  it("runs the original DiamondInit exactly once and rejects a second valid init call", async function () {
    const fx = await loadFixture(deployBaselineDiamond);
    const configBefore = await fx.config.getConfig();
    const facetsBefore = await fx.loupe.facets();

    await expect(
      fx.diamondCut.diamondCut(
        [],
        await fx.diamondInit.getAddress(),
        fx.initCalldata
      )
    ).to.be.revertedWith("Already initialized");

    const configAfter = await fx.config.getConfig();
    const facetsAfter = await fx.loupe.facets();
    expect(configAfter).to.deep.equal(configBefore);
    expect(facetsAfter).to.deep.equal(facetsBefore);
  });

  it("never references the original DiamondInit from an upgrade script", function () {
    const upgradeScripts = [
      "upgrade.js",
      "upgradeMerchantFacet.js",
      "setChannelDefaults.js",
    ];
    const exactOriginalInitializer = /[\"']DiamondInit[\"']/;

    for (const script of upgradeScripts) {
      const source = fs.readFileSync(
        path.join(__dirname, "../../scripts", script),
        "utf8"
      );
      expect(source, script).to.not.match(exactOriginalInitializer);
    }
  });

  it("adds, replaces, and removes a selector with correct loupe and delegatecall behavior", async function () {
    const fx = await loadFixture(deployBaselineDiamond);
    const sixDecimals = await deploy("MockERC20", ["Six", "SIX", 6]);
    const eighteenDecimals = await deploy("MockERC20", [
      "Eighteen",
      "E18",
      18,
    ]);
    const routed = new ethers.Contract(
      fx.diamondAddress,
      ["function decimals() view returns (uint8)"],
      fx.owner
    );

    await (
      await fx.diamondCut.diamondCut(
        oneSelectorCut(
          await sixDecimals.getAddress(),
          FacetCutAction.Add
        ),
        ethers.ZeroAddress,
        "0x"
      )
    ).wait();
    expect(await fx.loupe.facetAddress(DECIMALS_SELECTOR)).to.equal(
      await sixDecimals.getAddress()
    );
    expect(await routed.decimals()).to.equal(6n);
    expect((await fx.loupe.facetAddresses()).length).to.equal(7);

    await (
      await fx.diamondCut.diamondCut(
        oneSelectorCut(
          await eighteenDecimals.getAddress(),
          FacetCutAction.Replace
        ),
        ethers.ZeroAddress,
        "0x"
      )
    ).wait();
    expect(await fx.loupe.facetAddress(DECIMALS_SELECTOR)).to.equal(
      await eighteenDecimals.getAddress()
    );
    expect(await routed.decimals()).to.equal(18n);
    expect(await fx.loupe.facetFunctionSelectors(await sixDecimals.getAddress()))
      .to.deep.equal([]);
    expect((await fx.loupe.facetAddresses()).length).to.equal(7);

    await (
      await fx.diamondCut.diamondCut(
        oneSelectorCut(
          ethers.ZeroAddress,
          FacetCutAction.Remove
        ),
        ethers.ZeroAddress,
        "0x"
      )
    ).wait();
    expect(await fx.loupe.facetAddress(DECIMALS_SELECTOR)).to.equal(
      ethers.ZeroAddress
    );
    expect((await fx.loupe.facetAddresses()).length).to.equal(6);
    await expect(routed.decimals()).to.be.revertedWith(
      "Diamond: Function does not exist"
    );
  });

  it("rejects unauthorized, empty, zero-code, zero-address, and colliding adds", async function () {
    const fx = await loadFixture(deployBaselineDiamond);
    const facet = await deploy("MockERC20", ["Facet", "F", 6]);
    const facetAddress = await facet.getAddress();
    const validAdd = oneSelectorCut(facetAddress, FacetCutAction.Add);

    await expect(
      fx.diamondCut
        .connect(fx.other)
        .diamondCut(validAdd, ethers.ZeroAddress, "0x")
    ).to.be.revertedWith("LibDiamond: Must be contract owner");
    await expect(
      fx.diamondCut.diamondCut(
        [{ facetAddress, action: FacetCutAction.Add, functionSelectors: [] }],
        ethers.ZeroAddress,
        "0x"
      )
    ).to.be.revertedWith("LibDiamondCut: No selectors in facet to cut");
    await expect(
      fx.diamondCut.diamondCut(
        oneSelectorCut(ethers.ZeroAddress, FacetCutAction.Add),
        ethers.ZeroAddress,
        "0x"
      )
    ).to.be.revertedWith("LibDiamondCut: Add facet can't be address(0)");
    await expect(
      fx.diamondCut.diamondCut(
        oneSelectorCut(fx.other.address, FacetCutAction.Add),
        ethers.ZeroAddress,
        "0x"
      )
    ).to.be.revertedWith("LibDiamondCut: New facet has no code");

    await (
      await fx.diamondCut.diamondCut(
        validAdd,
        ethers.ZeroAddress,
        "0x"
      )
    ).wait();
    const secondFacet = await deploy("MockERC20", ["Second", "S", 18]);
    await expect(
      fx.diamondCut.diamondCut(
        oneSelectorCut(
          await secondFacet.getAddress(),
          FacetCutAction.Add
        ),
        ethers.ZeroAddress,
        "0x"
      )
    ).to.be.revertedWith(
      "LibDiamondCut: Can't add function that already exists"
    );
    expect(await fx.loupe.facetAddress(DECIMALS_SELECTOR)).to.equal(facetAddress);
  });

  it("rejects empty, zero-address, same-facet, and nonexistent replacements", async function () {
    const fx = await loadFixture(deployBaselineDiamond);
    const facet = await deploy("MockERC20", ["Facet", "F", 6]);
    const facetAddress = await facet.getAddress();
    await (
      await fx.diamondCut.diamondCut(
        oneSelectorCut(facetAddress, FacetCutAction.Add),
        ethers.ZeroAddress,
        "0x"
      )
    ).wait();

    await expect(
      fx.diamondCut.diamondCut(
        [
          {
            facetAddress,
            action: FacetCutAction.Replace,
            functionSelectors: [],
          },
        ],
        ethers.ZeroAddress,
        "0x"
      )
    ).to.be.revertedWith("LibDiamondCut: No selectors in facet to cut");
    await expect(
      fx.diamondCut.diamondCut(
        oneSelectorCut(ethers.ZeroAddress, FacetCutAction.Replace),
        ethers.ZeroAddress,
        "0x"
      )
    ).to.be.revertedWith("LibDiamondCut: Add facet can't be address(0)");
    await expect(
      fx.diamondCut.diamondCut(
        oneSelectorCut(facetAddress, FacetCutAction.Replace),
        ethers.ZeroAddress,
        "0x"
      )
    ).to.be.revertedWith(
      "LibDiamondCut: Can't replace function with same function"
    );

    const replacement = await deploy("MockERC20", ["Replacement", "R", 18]);
    await expect(
      fx.diamondCut.diamondCut(
        oneSelectorCut(
          await replacement.getAddress(),
          FacetCutAction.Replace,
          UNKNOWN_SELECTOR
        ),
        ethers.ZeroAddress,
        "0x"
      )
    ).to.be.revertedWith(
      "LibDiamondCut: Can't remove function that doesn't exist"
    );
    expect(await fx.loupe.facetAddress(UNKNOWN_SELECTOR)).to.equal(
      ethers.ZeroAddress
    );
  });

  it("rejects empty, nonzero-facet, and nonexistent removals without changing routing", async function () {
    const fx = await loadFixture(deployBaselineDiamond);
    const facet = await deploy("MockERC20", ["Facet", "F", 6]);
    const facetAddress = await facet.getAddress();
    await (
      await fx.diamondCut.diamondCut(
        oneSelectorCut(facetAddress, FacetCutAction.Add),
        ethers.ZeroAddress,
        "0x"
      )
    ).wait();

    await expect(
      fx.diamondCut.diamondCut(
        [
          {
            facetAddress: ethers.ZeroAddress,
            action: FacetCutAction.Remove,
            functionSelectors: [],
          },
        ],
        ethers.ZeroAddress,
        "0x"
      )
    ).to.be.revertedWith("LibDiamondCut: No selectors in facet to cut");
    await expect(
      fx.diamondCut.diamondCut(
        oneSelectorCut(facetAddress, FacetCutAction.Remove),
        ethers.ZeroAddress,
        "0x"
      )
    ).to.be.revertedWith(
      "LibDiamondCut: Remove facet address must be address(0)"
    );
    await expect(
      fx.diamondCut.diamondCut(
        oneSelectorCut(
          ethers.ZeroAddress,
          FacetCutAction.Remove,
          UNKNOWN_SELECTOR
        ),
        ethers.ZeroAddress,
        "0x"
      )
    ).to.be.revertedWith(
      "LibDiamondCut: Can't remove function that doesn't exist"
    );
    expect(await fx.loupe.facetAddress(DECIMALS_SELECTOR)).to.equal(facetAddress);
  });

  it("rejects initializer EOAs, bubbles reasoned failures, and exposes reasonless failures as the custom error", async function () {
    const fx = await loadFixture(deployBaselineDiamond);
    const cutAsFacet = await ethers.getContractAt(
      "DiamondCutFacet",
      fx.diamondAddress
    );

    await expect(
      fx.diamondCut.diamondCut([], fx.other.address, "0x")
    ).to.be.revertedWith("LibDiamondCut: _init address has no code");
    await expect(
      fx.diamondCut.diamondCut(
        [],
        await fx.diamondInit.getAddress(),
        fx.initCalldata
      )
    ).to.be.revertedWith("Already initialized");
    await expect(
      cutAsFacet.diamondCut([], await fx.diamondInit.getAddress(), "0x")
    )
      .to.be.revertedWithCustomError(
        cutAsFacet,
        "InitializationFunctionReverted"
      )
      .withArgs(await fx.diamondInit.getAddress(), "0x");
  });

  it("rolls back selector routing atomically when the initializer fails", async function () {
    const fx = await loadFixture(deployBaselineDiamond);
    const facet = await deploy("MockERC20", ["Rollback", "RB", 9]);
    const addressesBefore = await fx.loupe.facetAddresses();

    await expect(
      fx.diamondCut.diamondCut(
        oneSelectorCut(await facet.getAddress(), FacetCutAction.Add),
        await fx.diamondInit.getAddress(),
        fx.initCalldata
      )
    ).to.be.revertedWith("Already initialized");

    expect(await fx.loupe.facetAddress(DECIMALS_SELECTOR)).to.equal(
      ethers.ZeroAddress
    );
    expect(await fx.loupe.facetAddresses()).to.deep.equal(addressesBefore);
  });
});
