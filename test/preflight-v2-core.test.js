const { expect } = require("chai");
const fs = require("node:fs");
const path = require("node:path");

describe("v2 read-only preflight decision core", function () {
  let core;
  let manifest;

  before(async function () {
    core = await import("../scripts/preflight-v2-core.mjs");
    manifest = JSON.parse(fs.readFileSync(path.join(
      __dirname,
      "..",
      "packages",
      "protocol",
      "artifacts",
      "local-base-sepolia.manifest.json",
    ), "utf8"));
    // The pure decision harness exercises runtime evidence independently of the
    // local fixture's deliberate non-deployed marker.
    manifest = {
      ...manifest,
      kind: "base-sepolia-deployment",
      deployed: true,
      safeForSharedEnvironment: true,
      network: "base-sepolia",
      diamond: {
        ...manifest.diamond,
        deploymentBlock: 100,
        startBlock: 100,
        deploymentTransactionHash: `0x${"11".repeat(32)}`,
      },
      initialization: {
        ...manifest.initialization,
        initialized: true,
        block: 101,
        transactionHash: `0x${"22".repeat(32)}`,
      },
      usdc: { ...manifest.usdc, codeHash: `0x${"33".repeat(32)}` },
      createdAt: "2026-01-01T00:00:00.000Z",
    };
  });

  const envelope = () => ({
    chainId: 84_532n,
    deploymentReceipt: {
      status: 1,
      blockNumber: 100,
      contractAddress: manifest.diamond.address,
    },
    deploymentCreatedAt: manifest.createdAt,
    initializationReceipt: { status: 1, blockNumber: 101 },
    initializationTransaction: {
      to: manifest.diamond.address,
      from: manifest.diamond.owner,
      value: 0n,
    },
  });

  it("rejects wrong chain and fresh-deployment/initialization receipt mismatches", function () {
    expect(() => core.assertChainAndReceipts(manifest, { ...envelope(), chainId: 1n }))
      .to.throw(/chain id/u);
    expect(() => core.assertChainAndReceipts(manifest, {
      ...envelope(),
      deploymentReceipt: { ...envelope().deploymentReceipt, contractAddress: manifest.diamond.owner },
    })).to.throw(/creation receipt/u);
    expect(() => core.assertChainAndReceipts(manifest, {
      ...envelope(),
      initializationReceipt: { status: 0, blockNumber: 101 },
    })).to.throw(/initialization receipt/u);
    expect(() => core.assertChainAndReceipts(manifest, {
      ...envelope(),
      initializationTransaction: { ...envelope().initializationTransaction, from: manifest.roles.OPERATOR_ROLE.expectedAddress },
    })).to.throw(/authority/u);
  });

  it("rejects official-token decimals and runtime code-hash mismatches", function () {
    const valid = {
      diamondCodeHash: manifest.diamond.codeHash,
      usdcAddress: manifest.usdc.address,
      usdcCodeHash: manifest.usdc.codeHash,
      usdcDecimals: 6n,
      initializerCodeHash: manifest.initialization.initializerCodeHash,
    };
    expect(() => core.assertCodeAndToken(manifest, valid)).not.to.throw();
    expect(() => core.assertCodeAndToken(manifest, { ...valid, usdcDecimals: 18n })).to.throw(/decimals/u);
    expect(() => core.assertCodeAndToken(manifest, { ...valid, diamondCodeHash: `0x${"00".repeat(32)}` }))
      .to.throw(/Diamond code/u);
  });

  it("rejects protocol identity, custody token, paused-state and owner mismatch", function () {
    const valid = {
      initialized: true,
      protocolId: manifest.protocolId,
      protocolVersion: manifest.protocolVersion,
      layoutVersion: manifest.layoutVersion,
      storageNamespace: manifest.storageNamespace,
      usdcToken: manifest.usdc.address,
      paused: true,
      owner: manifest.diamond.owner,
    };
    expect(() => core.assertProtocolIdentity(manifest, valid)).not.to.throw();
    expect(() => core.assertProtocolIdentity(manifest, { ...valid, protocolVersion: 1 })).to.throw(/version/u);
    expect(() => core.assertProtocolIdentity(manifest, { ...valid, paused: false })).to.throw(/paused/u);
    expect(() => core.assertProtocolIdentity(manifest, { ...valid, owner: manifest.roles.OPERATOR_ROLE.expectedAddress }))
      .to.throw(/owner/u);
  });

  it("rejects role id/count/address and exclusivity mismatches", function () {
    const roles = Object.fromEntries(Object.entries(manifest.roles).map(([name, role]) => [name, {
      id: role.id,
      memberCount: 1n,
      expectedAuthorized: true,
    }]));
    const valid = { roles, ownerRoleCount: 0, expectedAddressRoleCounts: Array(7).fill(1) };
    expect(() => core.assertAuthorities(manifest, valid)).not.to.throw();
    expect(() => core.assertAuthorities(manifest, {
      ...valid,
      roles: { ...roles, OPERATOR_ROLE: { ...roles.OPERATOR_ROLE, memberCount: 2n } },
    })).to.throw(/member count/u);
    expect(() => core.assertAuthorities(manifest, {
      ...valid,
      roles: { ...roles, PAUSER_ROLE: { ...roles.PAUSER_ROLE, expectedAuthorized: false } },
    })).to.throw(/expected address/u);
    expect(() => core.assertAuthorities(manifest, { ...valid, ownerRoleCount: 1 })).to.throw(/owner/u);
  });

  it("rejects loupe facet/selector/code/ownership drift", function () {
    const facets = Object.fromEntries(manifest.facets.map((facet) => [facet.name, {
      address: facet.address,
      codeHash: facet.codeHash,
      selectors: facet.functionSelectors,
      selectorOwnersMatch: true,
    }]));
    const valid = { facets, facetAddresses: manifest.facets.map(({ address }) => address) };
    expect(() => core.assertLoupe(manifest, valid)).not.to.throw();
    expect(() => core.assertLoupe(manifest, {
      ...valid,
      facets: {
        ...facets,
        OrderFacet: { ...facets.OrderFacet, selectorOwnersMatch: false },
      },
    })).to.throw(/selector ownership/u);
    expect(() => core.assertLoupe(manifest, { ...valid, facetAddresses: valid.facetAddresses.slice(1) }))
      .to.throw(/facet-address/u);
  });

  it("rejects initializer target/calldata, cut, and bootstrap-event proof drift", function () {
    const valid = {
      initializerAddress: manifest.initialization.initializerAddress,
      calldataHash: manifest.initialization.calldataHash,
      cutMatches: true,
      protocolInitializedMatches: true,
      roleEventsMatch: true,
      configEventsMatch: true,
    };
    expect(() => core.assertInitializationEvidence(manifest, valid)).not.to.throw();
    expect(() => core.assertInitializationEvidence(manifest, { ...valid, cutMatches: false })).to.throw(/cut/u);
    expect(() => core.assertInitializationEvidence(manifest, { ...valid, protocolInitializedMatches: false }))
      .to.throw(/ProtocolInitialized/u);
    expect(() => core.assertInitializationEvidence(manifest, { ...valid, configEventsMatch: false }))
      .to.throw(/config/u);
  });
});
