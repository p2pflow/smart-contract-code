const { expect } = require("chai");
const { artifacts, ethers } = require("hardhat");

const {
  FacetCutAction,
  deployV2,
  getSelectors,
} = require("./helpers/v2-fixture");

describe("v2 fresh layout and access control", function () {
  it("initializes only a fresh namespaced Diamond and reports stored v2 identity", async function () {
    const fixture = await deployV2({ leavePaused: true });
    expect(await fixture.config.isProtocolInitialized()).to.equal(true);
    expect(await fixture.config.protocolVersion()).to.equal(2n);
    expect(await fixture.config.storageLayoutVersion()).to.equal(2n);
    expect(await fixture.config.protocolId()).to.equal(
      ethers.id("P2PFLOW_BASE_SEPOLIA_MARKETPLACE_V2"),
    );
    expect(await fixture.config.storageNamespace()).to.equal(ethers.id("p2pflow.app.storage.v2"));
    expect((await fixture.config.getConfig()).paused).to.equal(true);
    expect(fixture.initReceipt.logs.some((log) => {
      try {
        return fixture.config.interface.parseLog(log)?.name === "PlatformPaused";
      } catch {
        return false;
      }
    })).to.equal(true);

    await expect(
      fixture.diamondCut.connect(fixture.upgrader).diamondCut(
        [],
        await fixture.initializer.getAddress(),
        fixture.initCalldata,
      ),
    ).to.be.revertedWithCustomError(fixture.initializer, "ProtocolAlreadyInitialized");
  });

  it("keeps legacy roots empty and locks the namespaced v2 storage/ABI layout", async function () {
    const fixture = await deployV2({ leavePaused: true });
    for (let slot = 0; slot < 5; slot += 1) {
      expect(await ethers.provider.getStorage(fixture.diamondAddress, slot)).to.equal(ethers.ZeroHash);
    }

    const namespace = BigInt(ethers.id("p2pflow.app.storage.v2"));
    const storageAt = (offset) => ethers.provider.getStorage(
      fixture.diamondAddress,
      ethers.toBeHex(namespace + BigInt(offset), 32),
    );
    expect(await storageAt(0)).to.equal(ethers.id("p2pflow.app.storage.v2.initialized"));
    expect(await storageAt(1)).to.equal(ethers.id("P2PFLOW_BASE_SEPOLIA_MARKETPLACE_V2"));
    expect(BigInt(await storageAt(2))).to.equal(2n);
    expect(BigInt(await storageAt(3))).to.equal(2n);
    expect(BigInt(await storageAt(4))).to.equal(
      BigInt(await fixture.usdc.getAddress()) + (1n << 160n),
    );
    expect(BigInt(await storageAt(5))).to.equal(100n * 1_000_000n);
    expect(BigInt(await storageAt(6))).to.equal(600n);
    expect(BigInt(await storageAt(10))).to.equal(1n);

    const specs = [
      ["ConfigFacet", "getConfig"],
      ["PricingFacet", "getLatestPriceRound"],
      ["MerchantFacet", "getMerchant"],
      ["MerchantFacet", "getChannel"],
      ["OrderFacet", "getOrder"],
      ["AssignmentFacet", "getAssignment"],
      ["DisputeFacet", "getDispute"],
    ];
    const trim = (parameter) => ({
      name: parameter.name,
      type: parameter.type,
      ...(parameter.components ? { components: parameter.components.map(trim) } : {}),
    });
    const layoutSurface = [];
    for (const [contract, fn] of specs) {
      const artifact = await artifacts.readArtifact(contract);
      const item = artifact.abi.find((entry) => entry.type === "function" && entry.name === fn);
      layoutSurface.push({ contract, function: fn, outputs: item.outputs.map(trim) });
    }
    expect(ethers.sha256(ethers.toUtf8Bytes(JSON.stringify(layoutSurface)))).to.equal(
      "0xdc3a040497291c9ee74e606fd28357099c6dfac6614f68ff4779fa201ba8bce4",
    );
  });

  it("refuses the PII-bearing legacy slot-zero layout explicitly", async function () {
    const fixture = await deployV2({ initialize: false });
    const seeder = await ethers.deployContract("LegacyV1StateSeeder");
    const seed = seeder.interface.encodeFunctionData("seedLegacyState", [fixture.owner.address]);
    await fixture.diamondCut.connect(fixture.owner).diamondCut([], await seeder.getAddress(), seed);

    await expect(
      fixture.diamondCut.connect(fixture.owner).diamondCut(
        [],
        await fixture.initializer.getAddress(),
        fixture.initCalldata,
      ),
    ).to.be.revertedWithCustomError(fixture.initializer, "LegacyV1StateDetected");
    expect(await fixture.config.isProtocolInitialized()).to.equal(false);
  });

  it("cannot attest protocol identity when selectors are installed but init did not run", async function () {
    const fixture = await deployV2({ initialize: false });
    expect(await fixture.config.isProtocolInitialized()).to.equal(false);
    await expect(fixture.config.protocolVersion()).to.be.revertedWithCustomError(
      fixture.config,
      "ProtocolNotInitialized",
    );
    await expect(fixture.config.protocolId()).to.be.revertedWithCustomError(
      fixture.config,
      "ProtocolNotInitialized",
    );
  });

  it("rejects direct calls and invalid token, policy, safety, or role initialization atomically", async function () {
    const fixture = await deployV2({ initialize: false });
    await expect(fixture.initializer.initV2(fixture.initInput))
      .to.be.revertedWithCustomError(fixture.initializer, "InvalidDiamondContext");

    const attempt = (input) => fixture.diamondCut.connect(fixture.owner).diamondCut(
      [],
      fixture.initializer.getAddress(),
      fixture.initializer.interface.encodeFunctionData("initV2", [input]),
    );
    await expect(attempt({ ...fixture.initInput, usdcToken: fixture.other.address }))
      .to.be.revertedWithCustomError(fixture.initializer, "InvalidToken");
    const eighteenDecimals = await ethers.deployContract("MockERC20", ["Wrong", "WRONG", 18]);
    await expect(attempt({ ...fixture.initInput, usdcToken: await eighteenDecimals.getAddress() }))
      .to.be.revertedWithCustomError(fixture.initializer, "InvalidTokenDecimals");
    await expect(attempt({
      ...fixture.initInput,
      safety: { ...fixture.initInput.safety, orderLifetimeSeconds: 1 },
    })).to.be.revertedWithCustomError(fixture.initializer, "InvalidConfiguration");
    await expect(attempt({
      ...fixture.initInput,
      pricePolicy: { ...fixture.initInput.pricePolicy, sourceQuorum: 1 },
    })).to.be.revertedWithCustomError(fixture.initializer, "InvalidPricePolicy");
    await expect(attempt({
      ...fixture.initInput,
      roles: { ...fixture.initInput.roles, operator: ethers.ZeroAddress },
    })).to.be.revertedWithCustomError(fixture.initializer, "InvalidAddress");
    expect(await fixture.config.isProtocolInitialized()).to.equal(false);
    for (let slot = 0; slot < 5; slot += 1) {
      expect(await ethers.provider.getStorage(fixture.diamondAddress, slot)).to.equal(ethers.ZeroHash);
    }
  });

  it("installs seven mutually exclusive roles distinct from Diamond ownership", async function () {
    const fixture = await deployV2();
    const expected = [
      [await fixture.access.DEFAULT_ADMIN_ROLE(), fixture.admin],
      [await fixture.access.OPERATOR_ROLE(), fixture.operator],
      [await fixture.access.UPGRADER_ROLE(), fixture.upgrader],
      [await fixture.access.PAUSER_ROLE(), fixture.pauser],
      [await fixture.access.PRICE_UPDATER_ROLE(), fixture.priceUpdater],
      [await fixture.access.ORDER_ASSIGNER_ROLE(), fixture.orderAssigner],
      [await fixture.access.DISPUTE_RESOLVER_ROLE(), fixture.disputeResolver],
    ];
    for (const [role, signer] of expected) {
      expect(await fixture.access.hasRole(role, signer.address)).to.equal(true);
      expect(await fixture.access.getRoleMemberCount(role)).to.equal(1n);
      expect(await fixture.access.hasRole(role, fixture.owner.address)).to.equal(false);
    }
    expect(await fixture.ownership.owner()).to.equal(fixture.owner.address);
  });

  it("rejects zero, owner overlap, cross-role overlap and duplicate initialization identities", async function () {
    const fixture = await deployV2();
    const operatorRole = await fixture.access.OPERATOR_ROLE();
    const adminRole = await fixture.access.DEFAULT_ADMIN_ROLE();
    await expect(
      fixture.access.connect(fixture.admin).grantRole(operatorRole, ethers.ZeroAddress),
    ).to.be.revertedWithCustomError(fixture.access, "InvalidAddress");
    await expect(
      fixture.access.connect(fixture.admin).grantRole(operatorRole, fixture.owner.address),
    ).to.be.revertedWithCustomError(fixture.access, "RoleAccountIsDiamondOwner");
    await expect(
      fixture.access.connect(fixture.admin).grantRole(adminRole, fixture.operator.address),
    ).to.be.revertedWithCustomError(fixture.access, "RoleAccountAlreadyAssigned");

    await expect(deployV2({ roles: { operator: fixture.admin.address } })).to.be.rejected;
  });

  it("supports idempotent grants, safe rotation and last-admin protection", async function () {
    const fixture = await deployV2();
    const adminRole = await fixture.access.DEFAULT_ADMIN_ROLE();
    await expect(
      fixture.access.connect(fixture.admin).grantRole(adminRole, fixture.newAdmin.address),
    ).to.emit(fixture.access, "RoleGranted");
    await fixture.access.connect(fixture.admin).grantRole(adminRole, fixture.newAdmin.address);
    expect(await fixture.access.getRoleMemberCount(adminRole)).to.equal(2n);

    await fixture.access.connect(fixture.admin).revokeRole(adminRole, fixture.admin.address);
    expect(await fixture.access.hasRole(adminRole, fixture.admin.address)).to.equal(false);
    await expect(
      fixture.access.connect(fixture.newAdmin).renounceRole(adminRole, fixture.newAdmin.address),
    ).to.be.revertedWithCustomError(fixture.access, "LastDefaultAdmin");
    await expect(
      fixture.access.connect(fixture.other).renounceRole(adminRole, fixture.newAdmin.address),
    ).to.be.revertedWithCustomError(fixture.access, "UnauthorizedRoleRenounce");
  });

  it("moves cut authority from bootstrap owner to revocable UPGRADER", async function () {
    const fixture = await deployV2();
    await expect(
      fixture.diamondCut.connect(fixture.owner).diamondCut([], ethers.ZeroAddress, "0x"),
    ).to.be.revertedWithCustomError(fixture.access, "MissingRole");

    const testFacet = await ethers.deployContract("TestFacetV2");
    await fixture.diamondCut.connect(fixture.upgrader).diamondCut([
      {
        facetAddress: await testFacet.getAddress(),
        action: FacetCutAction.Add,
        functionSelectors: getSelectors(testFacet),
      },
    ], ethers.ZeroAddress, "0x");
    const testAtDiamond = await ethers.getContractAt("TestFacetV2", fixture.diamondAddress);
    expect(await testAtDiamond.v2TestPing()).to.equal(ethers.id("P2PFLOW_V2_TEST_PING"));

    const role = await fixture.access.UPGRADER_ROLE();
    await fixture.access.connect(fixture.admin).revokeRole(role, fixture.upgrader.address);
    await expect(
      fixture.diamondCut.connect(fixture.upgrader).diamondCut([], ethers.ZeroAddress, "0x"),
    ).to.be.revertedWithCustomError(fixture.access, "MissingRole");
    await fixture.access.connect(fixture.admin).grantRole(role, fixture.other.address);
    await expect(
      fixture.diamondCut.connect(fixture.other).diamondCut([], ethers.ZeroAddress, "0x"),
    ).not.to.be.reverted;
  });

  it("preserves owner/app-role separation during ownership rotation", async function () {
    const fixture = await deployV2();
    await expect(
      fixture.ownership.connect(fixture.owner).transferOwnership(ethers.ZeroAddress),
    ).to.be.revertedWithCustomError(fixture.ownership, "InvalidAddress");
    await expect(
      fixture.ownership.connect(fixture.owner).transferOwnership(fixture.operator.address),
    ).to.be.revertedWithCustomError(fixture.ownership, "RoleAccountAlreadyAssigned");
    await fixture.ownership.connect(fixture.owner).transferOwnership(fixture.newOwner.address);
    expect(await fixture.ownership.owner()).to.equal(fixture.newOwner.address);
  });

  it("rejects invalid constructor authority, facet and native ETH", async function () {
    const [owner, eoa] = await ethers.getSigners();
    const cutFacet = await ethers.deployContract("DiamondCutFacet");
    const factory = await ethers.getContractFactory("Diamond");
    await expect(factory.deploy(ethers.ZeroAddress, await cutFacet.getAddress()))
      .to.be.revertedWithCustomError(factory, "InvalidAddress");
    await expect(factory.deploy(owner.address, eoa.address))
      .to.be.revertedWithCustomError(factory, "InvalidFacetAddress");

    const fixture = await deployV2();
    await expect(owner.sendTransaction({ to: fixture.diamondAddress, value: 1n })).to.be.reverted;
  });

  it("enforces PAUSER authority and idempotent pause state", async function () {
    const fixture = await deployV2();
    await expect(fixture.config.connect(fixture.other).pausePlatform())
      .to.be.revertedWithCustomError(fixture.access, "MissingRole");
    await expect(fixture.config.connect(fixture.pauser).pausePlatform())
      .to.emit(fixture.config, "PlatformPaused");
    await expect(fixture.config.connect(fixture.pauser).pausePlatform())
      .to.be.revertedWithCustomError(fixture.config, "PlatformIsPaused");
    await expect(fixture.config.connect(fixture.pauser).unpausePlatform())
      .to.emit(fixture.config, "PlatformUnpaused");
    await expect(fixture.config.connect(fixture.pauser).unpausePlatform())
      .to.be.revertedWithCustomError(fixture.config, "PlatformIsNotPaused");
  });
});
